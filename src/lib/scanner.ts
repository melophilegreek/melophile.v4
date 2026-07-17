import type { Song } from '../types';
import { AUDIO_EXTENSIONS } from '../types';
import { saveSongsBatch, getAllSongs, getFile, updateSongArt } from './db';
import type { WorkerRequest, WorkerResponse } from './import.worker';
import { extractMeta, type Meta } from './metadataParser';

// `finalizing: true` marks the phase after every file has been parsed, while
// the last (sub-batch-size) group of songs is still being committed to
// IndexedDB. Without this the UI has no way to distinguish "still parsing"
// from "done parsing, now writing" -- it just looks frozen at N/N.
export interface ImportProgress { current: number; total: number; fileName: string; finalizing?: boolean; }

function isAudioFile(f: File): boolean {
  return AUDIO_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext));
}

function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    a.addEventListener('loadedmetadata', () => {
      const dur = isFinite(a.duration) ? a.duration : 0;
      URL.revokeObjectURL(url); resolve(dur);
    });
    a.addEventListener('error', () => { URL.revokeObjectURL(url); resolve(0); });
    a.preload = 'metadata'; a.src = url;
  });
}

// -- Folder-level cover art fallback ------------------------------------------
// Change (album art): when a track has no *embedded* art, check for a
// cover/folder/album image sitting next to it in the same imported folder
// before giving up. `webkitRelativePath` (set on every File when a <input
// webkitdirectory> selection is made) gives us the folder structure without
// needing the File System Access API.
const FOLDER_ART_NAMES = /^(cover|folder|album)\.(jpe?g|png)$/i;

function folderOf(file: File): string {
  const rel = (file as unknown as { webkitRelativePath?: string }).webkitRelativePath;
  if (!rel) return '';
  const parts = rel.split('/');
  return parts.slice(0, -1).join('/');
}

function mimeForImageName(name: string): string {
  return name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
}

/** Builds folder-path -> cover-image-File map once per import, from every
 *  selected file (not just the audio ones), so lookups during import are O(1). */
function buildFolderArtIndex(allFiles: File[]): Map<string, File> {
  const index = new Map<string, File>();
  for (const f of allFiles) {
    if (FOLDER_ART_NAMES.test(f.name)) index.set(folderOf(f), f);
  }
  return index;
}

// -- Worker pool for parallel metadata parsing --------------------------------
// Parsing (ID3/Vorbis/MP4-atom/etc. byte-crunching) is the CPU-bound part of
// import; running it on the main thread was the biggest contributor to slow,
// janky folder imports. Spreading it across a small pool of workers lets
// multiple files get parsed at the same time on multi-core machines, while
// the main thread stays free to keep the progress bar and rest of the UI
// responsive. Each worker pulls the next unparsed file as soon as it
// finishes the previous one, so faster/slower files self-balance across
// the pool instead of being split into fixed-size chunks up front.
const POOL_SIZE = Math.max(2, Math.min(navigator.hardwareConcurrency || 4, 8));

// Batches now flush in the background (see flushPromises below) instead of
// blocking per-file progress, so the main cost of a *larger* batch size is
// no longer transaction overhead -- it's the size of the one leftover batch
// that's still visible to the user as "Saving to library..." after every
// file has been parsed. Keeping this smaller shrinks that worst-case wait
// (previously up to 49 full audio files' worth of write time with zero
// batching benefit left to lose, since transactions were already amortized
// well below this size).
const DB_BATCH_SIZE = 20;

export async function importFiles(
  files: File[],
  onProgress: (p: ImportProgress) => void,
): Promise<{ added: number; skipped: number }> {
  const audioFiles = files.filter(isAudioFile);
  const total = audioFiles.length;
  const folderArtIndex = buildFolderArtIndex(files);
  const folderArtCache = new Map<string, { data: ArrayBuffer; mime: string } | null>();

  async function getFolderArt(file: File): Promise<{ data: ArrayBuffer; mime: string } | null> {
    const folder = folderOf(file);
    if (folderArtCache.has(folder)) return folderArtCache.get(folder)!;
    const artFile = folderArtIndex.get(folder);
    if (!artFile) { folderArtCache.set(folder, null); return null; }
    try {
      const data = await artFile.arrayBuffer();
      const result = { data, mime: mimeForImageName(artFile.name) };
      folderArtCache.set(folder, result);
      return result;
    } catch {
      folderArtCache.set(folder, null);
      return null;
    }
  }

  let added = 0;
  let completed = 0;
  let saved = 0;
  let pendingBatch: { song: Song; file: File }[] = [];
  // Batch writes used to be `await`-ed inline, which meant every 50th file's
  // progress tick blocked on a full IndexedDB transaction of audio blobs
  // committing -- and the *final* partial batch wrote entirely after the
  // counter already showed total/total, with no feedback at all (looked
  // hung). Now flushes fire in the background and overlap with parsing of
  // the next batch; we just track their promises so importFiles() can wait
  // for every write to actually land before it resolves.
  const flushPromises: Promise<void>[] = [];

  const flushBatch = async () => {
    if (pendingBatch.length === 0) return;
    // One IndexedDB transaction covering many songs/files instead of one
    // transaction per file -- this is what actually removes the import
    // bottleneck, since transaction setup/commit overhead (not the writes
    // themselves) dominates when importing hundreds of small files.
    const batch = pendingBatch;
    pendingBatch = [];
    await saveSongsBatch(batch);
    saved += batch.length;
    // Once every file has been parsed, `current`/`total` from the parse loop
    // are both pinned at `total` -- without this, the UI has no way to show
    // *any* movement while it waits out however many batches of full audio
    // blobs are still being written (parsing, being CPU-bound and spread
    // across a worker pool, regularly finishes well before writing, which is
    // I/O-bound and serialized to one IndexedDB transaction at a time, has
    // drained its backlog). Reporting `saved` here turns that wait from a
    // frozen "Saving to library..." spinner into a real, moving count.
    if (completed >= total) onProgress({ current: saved, total, fileName: '', finalizing: true });
  };

  const finalizeOne = async (file: File, meta: Meta) => {
    try {
      let artData = meta.artData;
      let artMime = meta.artMime;
      if (!artData) {
        const folderArt = await getFolderArt(file);
        if (folderArt) { artData = folderArt.data; artMime = folderArt.mime; }
        else {
          // Album art: log once per file so missing art is visible to the
          // user/dev instead of silently disappearing, without throwing or
          // aborting the import.
          console.warn(`Album art: no embedded art or folder cover image found for "${file.name}"`);
        }
      }
      const title = meta.title || file.name.replace(/\.[^/.]+$/, '');
      const artist = meta.artist || 'Unknown Artist';
      const id = `song-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const fileKey = `file-${id}`;
      let finalDuration = meta.duration ?? 0;
      let finalKbps = meta.kbps ?? null;
      if (finalDuration <= 0) finalDuration = await getAudioDuration(file);
      if (finalKbps == null && finalDuration > 0) finalKbps = Math.round((file.size * 8) / (finalDuration * 1000));
      const song: Song = {
        id, title, artist, album: meta.album,
        duration: finalDuration, kbps: finalKbps,
        albumArtData: artData, albumArtMime: artMime,
        fileKey, addedAt: Date.now(), fileName: file.name, fileSize: file.size,
        playCount: 0, lastPlayedAt: 0,
      };
      pendingBatch.push({ song, file });
      added++;
      // Fire-and-track rather than `await`: the pendingBatch/added
      // bookkeeping above already happened synchronously (no interleaving
      // possible before this line), so it's safe to let the actual write
      // run in the background while parsing continues, instead of stalling
      // this file's progress tick on a full transaction commit.
      if (pendingBatch.length >= DB_BATCH_SIZE) flushPromises.push(flushBatch());
    } catch (e) {
      console.warn('Failed to import', file.name, e);
    } finally {
      completed++;
      onProgress({ current: completed, total, fileName: file.name });
    }
  };

  await new Promise<void>((resolve) => {
    if (audioFiles.length === 0) { resolve(); return; }
    const workers = Array.from(
      { length: Math.min(POOL_SIZE, audioFiles.length) },
      () => new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' }),
    );
    let nextIndex = 0;
    let remaining = audioFiles.length;
    // BUG FIX (songs missing on large/mobile imports): tracks which file id
    // is currently in flight on each specific worker. onerror used to grab
    // `nextIndex - 1` instead, assuming that was always *this* worker's
    // file -- but with several workers dispatching concurrently, nextIndex
    // is shared and gets advanced by whichever worker happens to finish
    // next, from any of them. By the time one worker actually crashes, that
    // shared counter usually points at some *other* worker's in-flight (or
    // not-yet-dispatched) file instead of the one that failed. The result:
    // the file that actually crashed is silently dropped (never recovered,
    // never counted), while a different, perfectly fine file gets "rescued"
    // on the main thread and can end up double-processed once its own
    // worker also reports it normally. This is most likely to actually
    // trigger on a phone, where the OS/browser is far more willing to kill
    // a worker under memory pressure during a big folder import than a
    // desktop is.
    const inFlight = new Map<Worker, number>();

    const dispatchNext = (worker: Worker) => {
      if (nextIndex >= audioFiles.length) return;
      const id = nextIndex++;
      inFlight.set(worker, id);
      const req: WorkerRequest = { id, file: audioFiles[id] };
      worker.postMessage(req);
    };

    const settleIfDone = () => {
      if (remaining <= 0) { workers.forEach((w) => w.terminate()); resolve(); }
    };

    for (const worker of workers) {
      worker.onmessage = async (e: MessageEvent<WorkerResponse>) => {
        const { id, meta } = e.data;
        inFlight.delete(worker);
        await finalizeOne(audioFiles[id], meta);
        remaining--;
        settleIfDone();
        if (remaining > 0) dispatchNext(worker);
      };
      worker.onerror = async () => {
        // A worker crashing (or failing to start, e.g. under a strict CSP
        // that blocks module workers) shouldn't stall the whole import --
        // fall back to parsing this one file on the main thread instead.
        const id = inFlight.get(worker);
        inFlight.delete(worker);
        const file = id !== undefined ? audioFiles[id] : undefined;
        if (file) {
          const { extractMeta } = await import('./metadataParser');
          const meta = await extractMeta(file);
          await finalizeOne(file, meta);
        }
        remaining--;
        settleIfDone();
        if (remaining > 0) dispatchNext(worker);
      };
      dispatchNext(worker);
    }
  });

  // All files parsed. Parsing (CPU-bound, spread across a worker pool) very
  // often finishes well ahead of writing (I/O-bound, serialized to one
  // IndexedDB transaction at a time), so there can be a real backlog of
  // unwritten batches here, not just one small leftover one -- for a big
  // import this can take as long as the parse phase did. Report `saved`
  // (not `total`) so the bar reflects what's actually landed in the DB so
  // far, and each flushBatch() above keeps nudging it forward as the
  // backlog drains, instead of it jumping straight to 100% and sitting
  // there.
  onProgress({ current: saved, total, fileName: '', finalizing: true });
  flushPromises.push(flushBatch());
  await Promise.all(flushPromises);
  return { added, skipped: total - added };
}

/** Returns the set of song ids that share the same title+artist (case-
 *  insensitive) with at least one other song in the library -- used to show a
 *  non-blocking "possible duplicate" badge, since duplicates are now always
 *  imported rather than being blocked or silently skipped. */
export function getTitleArtistDuplicateIds(songs: Song[]): Set<string> {
  const counts = new Map<string, string[]>();
  for (const s of songs) {
    const key = `${s.title.trim().toLowerCase()}::${s.artist.trim().toLowerCase()}`;
    const ids = counts.get(key) ?? [];
    ids.push(s.id);
    counts.set(key, ids);
  }
  const dup = new Set<string>();
  for (const ids of counts.values()) {
    if (ids.length > 1) ids.forEach((id) => dup.add(id));
  }
  return dup;
}

export interface ArtRescanProgress { current: number; total: number; found: number; }

/** Re-parses embedded artwork for every already-imported song, using the
 *  audio blob already sitting in IndexedDB -- no need to re-select the
 *  original folder/files. This exists because art extraction has had
 *  several bug fixes over time (large ID3/FLAC/M4A tags pushing the cover
 *  art past the head-chunk read, and a UTF-16-description parsing bug that
 *  corrupted the image bytes themselves -- see extractMeta's and
 *  parseID3v2's comments above); those fixes only apply to *new* imports,
 *  so a song imported before a fix landed keeps showing a placeholder (or
 *  worse, a corrupted image that fails to decode) forever unless it's
 *  re-scanned like this.
 *
 *  Deliberately does NOT filter to `!song.albumArtData` first: the
 *  UTF-16-description bug didn't leave `albumArtData` empty, it left it
 *  populated with a corrupted-but-non-empty byte blob (real image bytes
 *  with a few leftover description bytes glued onto the front), which is
 *  exactly what made this bug so easy to miss -- a "missing art" filter
 *  skips right past songs that have *bad* art, not *no* art. So this
 *  re-parses every song's stored file and overwrites whatever bytes come
 *  out, which is idempotent for songs that were already fine. Folder-level
 *  cover.jpg/folder.jpg fallback art can't be retried here, since only the
 *  audio file itself (not its sibling files) is stored -- some songs may
 *  still come up empty if they never had embedded art to begin with. */
export async function rescanMissingArt(
  onProgress: (p: ArtRescanProgress) => void,
): Promise<{ scanned: number; fixed: number }> {
  const songs = await getAllSongs();
  const total = songs.length;
  let found = 0;
  onProgress({ current: 0, total, found });
  for (let i = 0; i < total; i++) {
    const song = songs[i];
    try {
      const blob = await getFile(song.fileKey);
      if (blob) {
        // Stored value is a File (structured-cloned as-is by saveSongsBatch)
        // but the store's type signature only guarantees Blob -- rewrap
        // defensively so extractMeta always gets a real File with `.name`.
        const file = blob instanceof File ? blob : new File([blob], song.fileName);
        const meta = await extractMeta(file);
        if (meta.artData) {
          // Byte-length is a cheap enough proxy for "did this actually
          // change" -- a corrupted-vs-fixed extraction almost always comes
          // out a different length (the fix either drops leftover
          // description bytes or, for songs with no stored art at all,
          // goes from undefined to a real length), and re-writing an
          // unchanged image is harmless either way, so it's fine if this
          // occasionally over- or under-counts by a byte-length collision.
          const changed = song.albumArtData?.byteLength !== meta.artData.byteLength;
          await updateSongArt(song.id, meta.artData, meta.artMime);
          if (changed) found++;
        }
      }
    } catch (e) {
      console.warn('Art rescan: failed for', song.fileName, e);
    }
    onProgress({ current: i + 1, total, found });
  }
  return { scanned: total, fixed: found };
}
