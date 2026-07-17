import { openDB as idbOpen, type IDBPDatabase } from 'idb';
import type { Song, Playlist, Preferences, HistoryEntry } from '../types';
import { DEFAULT_ACCENT } from '../types';

interface MelophileDB {
  songs: { key: string; value: Song };
  files: { key: string; value: Blob };
  'liked-songs': { key: string; value: string };
  'pinned-songs': { key: string; value: string };
  playlists: { key: string; value: Playlist };
  preferences: { key: string; value: string };
  history: { key: string; value: HistoryEntry };
}

let _db: IDBPDatabase<MelophileDB> | null = null;

async function getDB(): Promise<IDBPDatabase<MelophileDB>> {
  if (_db) return _db;
  // Bumped 3 -> 4 to add the 'pinned-songs' store (Pin/Unpin feature).
  // Mirrors 'liked-songs' exactly: a store of songId -> songId, so
  // getAllKeys() doubles as both the id list and the membership check.
  _db = await idbOpen<MelophileDB>('melophile', 4, {
    upgrade(db, oldVersion) {
      if (!db.objectStoreNames.contains('songs')) {
        const s = db.createObjectStore('songs', { keyPath: 'id' });
        s.createIndex('addedAt' as never, 'addedAt' as never);
      }
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      if (!db.objectStoreNames.contains('liked-songs')) db.createObjectStore('liked-songs');
      if (!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('preferences')) db.createObjectStore('preferences');
      if (oldVersion < 3 && !db.objectStoreNames.contains('history')) {
        const h = db.createObjectStore('history', { keyPath: 'id' });
        h.createIndex('playedAt' as never, 'playedAt' as never);
      }
      if (oldVersion < 4 && !db.objectStoreNames.contains('pinned-songs')) {
        db.createObjectStore('pinned-songs');
      }
    },
  });
  return _db;
}

// ── Songs ─────────────────────────────────────────────────────────────────────
export async function getAllSongs(): Promise<Song[]> {
  const db = await getDB();
  const all = await db.getAll('songs');
  return all.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}
export async function saveSong(song: Song): Promise<void> { const db = await getDB(); await db.put('songs', song); }

// Performance (folder import): writes many songs + their file blobs in a
// single readwrite transaction instead of one `db.put` transaction per file.
// Each `db.put` shorthand opens and commits its own transaction; for an
// import of hundreds of files, that per-file transaction overhead (not the
// actual byte writes) is what made import slow. Batching amortizes that
// overhead across every song in the batch.
export async function saveSongsBatch(items: { song: Song; file: File }[]): Promise<void> {
  if (items.length === 0) return;
  const db = await getDB();
  const tx = db.transaction(['songs', 'files'], 'readwrite');
  const songsStore = tx.objectStore('songs');
  const filesStore = tx.objectStore('files');
  for (const { song, file } of items) {
    songsStore.put(song);
    filesStore.put(file, song.fileKey);
  }
  await tx.done;
}
export async function updateSongArt(id: string, art?: ArrayBuffer, mime?: string): Promise<void> {
  const db = await getDB(); const s = await db.get('songs', id); if (!s) return;
  await db.put('songs', { ...s, albumArtData: art, albumArtMime: mime });
}
export async function deleteSong(id: string, fileKey: string): Promise<void> {
  const db = await getDB(); const tx = db.transaction(['songs', 'files'], 'readwrite');
  await Promise.all([tx.objectStore('songs').delete(id), tx.objectStore('files').delete(fileKey), tx.done]);
}
// Wipes the entire library: every song record, every stored audio blob, and
// every liked-song flag (a liked id pointing at a deleted song is orphaned
// data, so it's cleared alongside). Playlists themselves are left in place —
// the caller is responsible for emptying/updating their songIds — since
// whether to keep empty playlists around vs. delete them is a product
// decision, not a storage-layer one.
export async function clearAllSongs(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['songs', 'files', 'liked-songs', 'pinned-songs'], 'readwrite');
  await Promise.all([
    tx.objectStore('songs').clear(),
    tx.objectStore('files').clear(),
    tx.objectStore('liked-songs').clear(),
    tx.objectStore('pinned-songs').clear(),
    tx.done,
  ]);
}
export async function saveFile(key: string, blob: Blob): Promise<void> { const db = await getDB(); await db.put('files', blob, key); }
export async function getFile(key: string): Promise<Blob | undefined> { const db = await getDB(); return db.get('files', key); }

// ── Liked Songs ───────────────────────────────────────────────────────────────
export async function getLikedIds(): Promise<Set<string>> { const db = await getDB(); const keys = await db.getAllKeys('liked-songs'); return new Set(keys as string[]); }
export async function setLiked(songId: string, liked: boolean): Promise<void> { const db = await getDB(); if (liked) await db.put('liked-songs', songId, songId); else await db.delete('liked-songs', songId); }

// ── Pinned Songs ──────────────────────────────────────────────────────────────
// FIX (pin order): the store's value used to just be the songId itself, so
// the only "order" available on reload was IndexedDB's default
// ascending-by-key sort -- which isn't "first pinned first" at all. The
// value is now the timestamp the song was pinned at, and getPinnedIds sorts
// by that before building the Set, so the Set's iteration order (which
// App.tsx relies on to lay out the Pinned section) reflects actual pin
// order, oldest pin first, and survives a reload.
export async function getPinnedIds(): Promise<Set<string>> {
  const db = await getDB();
  const keys = (await db.getAllKeys('pinned-songs')) as string[];
  const values = (await db.getAll('pinned-songs')) as number[];
  const withOrder = keys.map((key, i) => ({ key, order: values[i] ?? 0 }));
  withOrder.sort((a, b) => a.order - b.order);
  return new Set(withOrder.map((e) => e.key));
}
export async function setPinned(songId: string, pinned: boolean): Promise<void> { const db = await getDB(); if (pinned) await db.put('pinned-songs', Date.now(), songId); else await db.delete('pinned-songs', songId); }

// ── Playlists ─────────────────────────────────────────────────────────────────
export async function getPlaylists(): Promise<Playlist[]> { const db = await getDB(); const all = await db.getAll('playlists'); return all.sort((a, b) => a.createdAt - b.createdAt); }
export async function savePlaylist(p: Playlist): Promise<void> { const db = await getDB(); await db.put('playlists', p); }
export async function deletePlaylist(id: string): Promise<void> { const db = await getDB(); await db.delete('playlists', id); }

// ── Preferences ───────────────────────────────────────────────────────────────
export async function getPreferences(): Promise<Preferences> { const db = await getDB(); const color = await db.get('preferences', 'accentColor'); return { accentColor: (color as string | undefined) ?? DEFAULT_ACCENT }; }
export async function savePreferences(prefs: Preferences): Promise<void> { const db = await getDB(); await db.put('preferences', prefs.accentColor, 'accentColor'); }

// ── Play Count / History ──────────────────────────────────────────────────────
// TASK 3 (75%-threshold play counting): logging a "recently played" history
// entry and incrementing a song's play count used to happen together, both
// at the moment playback *started*. They're now two separate calls made at
// two separate moments — recordHistoryEntry() still fires on play start (so
// "Recently Played" reflects what you opened), while incrementPlayCount()
// only fires once playback has actually crossed 75% of the track's
// duration (see player.ts's onThresholdReached), so a song only counts
// toward "Top 10 Most Played" once someone has genuinely listened to it.

/** Logs a "recently played" entry. Fires immediately when a song starts playing. */
export async function recordHistoryEntry(songId: string): Promise<void> {
  const db = await getDB();
  const now = Date.now();
  const entry: HistoryEntry = { id: `${songId}-${now}`, songId, playedAt: now };
  await db.put('history', entry);
}

/** Increments a song's play count. Fires once per qualifying (>=75% listened) play. */
export async function incrementPlayCount(songId: string): Promise<void> {
  const db = await getDB();
  const song = await db.get('songs', songId);
  if (!song) return;
  const now = Date.now();
  await db.put('songs', { ...song, playCount: (song.playCount ?? 0) + 1, lastPlayedAt: now });
}

export async function getHistory(limit = 50): Promise<HistoryEntry[]> {
  const db = await getDB();
  const all = await db.getAll('history');
  return all.sort((a, b) => b.playedAt - a.playedAt).slice(0, limit);
}

export async function clearHistory(): Promise<void> {
  const db = await getDB();
  await db.clear('history');
}
