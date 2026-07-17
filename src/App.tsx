import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Search, X, FolderOpen, Loader as Loader2, Heart, Trash2, Menu, Music as MusicIcon, TrendingUp, RefreshCw, Plus } from 'lucide-react';

import { Onboarding } from './components/Onboarding';
import { Sidebar } from './components/Sidebar';
import { SongRow, invalidateArt } from './components/SongRow';
import { AlphaScrollBar } from './components/AlphaScrollBar';
import { VirtualList, type VirtualListHandle } from './components/VirtualList';
import { PlayerBar } from './components/PlayerBar';
import { SettingsPanel } from './components/SettingsPanel';
import { AlbumArtEditModal } from './components/AlbumArtEditModal';
import { QueuePanel } from './components/QueuePanel';
import { StatsScreen } from './components/StatsScreen';
import { AddSongsModal } from './components/AddSongsModal';

import { usePlayer } from './hooks/usePlayer';
import { player } from './lib/player';
import {
  getAllSongs, getLikedIds, setLiked as dbSetLiked,
  getPinnedIds, setPinned as dbSetPinned,
  getPlaylists, savePlaylist, deletePlaylist as dbDeletePlaylist,
  getPreferences, savePreferences,
  recordHistoryEntry, incrementPlayCount, getHistory, clearHistory,
  deleteSong as dbDeleteSong,
  clearAllSongs,
} from './lib/db';
import { importFiles, getTitleArtistDuplicateIds, rescanMissingArt, type ImportProgress, type ArtRescanProgress } from './lib/scanner';
import { useListeningStats } from './hooks/useListeningStats';
import type { AppView, HistoryEntry, LibraryRow, Playlist, Song } from './types';
import { DEFAULT_ACCENT, PINNED_HEADER_HEIGHT, ROW_HEIGHT } from './types';
import { getContrastText } from './lib/color';

const artUrlCache = new Map<string, string>();
function getCachedArtUrl(song: Song | null): string | null {
  if (!song?.albumArtData) return null;
  if (artUrlCache.has(song.id)) return artUrlCache.get(song.id)!;
  const url = URL.createObjectURL(new Blob([song.albumArtData], { type: song.albumArtMime || 'image/jpeg' }));
  artUrlCache.set(song.id, url);
  return url;
}

// FIX (inconsistent toast dismiss timing): this component used to own its
// own dismiss timer via `useEffect(() => setTimeout(onDone, 3000), [onDone])`.
// `onDone` was passed in as a fresh inline arrow function on every App
// render (`onDone={() => setToast(null)}`), so its identity changed on
// *any* unrelated App re-render (playback progress ticking, listening-stats
// updates, etc.) — not just when a new toast was shown. Every such render
// re-ran the effect, which cancelled the in-flight timer and started a new
// 3000ms one from scratch, so the real dismiss delay depended on how many
// unrelated renders happened to land during that window. The timer is now
// owned by App itself (see `showToast` below) using a ref that isn't tied
// to render identity, so it always fires exactly once at a fixed 1500ms
// and is cancelled/replaced cleanly if a new toast is triggered first. This
// component is now just a dumb, timer-free renderer.
function Toast({ message }: { message: string }) {
  return (
    // `bottom-24` (96px) was correct back when the mobile player bar was 80px
    // tall, leaving a clear gap above it. The bar is now 128px tall (see the
    // h-32 fix on the player bar container below), so at 96px the toast's
    // bottom edge sat *inside* the bar — this is what was rendering as the
    // toast overlapping/covering the song title, as seen in the screenshot.
    // Bumped to clear the taller bar on mobile; desktop's bar was never
    // resized, so its offset is unchanged.
    <div className="fixed bottom-36 md:bottom-24 left-1/2 -translate-x-1/2 z-50 animate-slide-up"
      style={{ background: 'rgba(30,30,30,0.97)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 999, padding: '10px 20px', color: 'white', fontSize: 13, boxShadow: '0 8px 32px rgba(0,0,0,0.5)', whiteSpace: 'nowrap' }}>
      {message}
    </div>
  );
}

function NewPlaylistModal({ accentColor, onCreated, onClose }: {
  accentColor: string; onCreated: (name: string) => void; onClose: () => void;
}) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
      onMouseDown={(e) => { if (e.currentTarget === e.target) onClose(); }}>
      <div className="w-80 rounded-2xl p-6 shadow-2xl animate-slide-up"
        style={{ background: 'rgba(28,28,28,0.97)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
        <h3 className="text-white font-bold text-lg mb-4">New Playlist</h3>
        <input ref={inputRef} type="text" placeholder="Playlist name" value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { onCreated(name.trim()); onClose(); } }}
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder-white/30 focus:outline-none focus:border-white/25 mb-4" />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 text-sm transition-colors">Cancel</button>
          <button onClick={() => { if (name.trim()) { onCreated(name.trim()); onClose(); } }} disabled={!name.trim()}
            className="flex-1 py-2.5 rounded-xl font-semibold text-sm transition-all hover:opacity-90 disabled:opacity-40"
            style={{ background: accentColor, color: getContrastText(accentColor) }}>Create</button>
        </div>
      </div>
    </div>
  );
}

// Feature (Playlist delete confirmation): mirrors SongRow.tsx's
// DeleteConfirmDialog exactly (same layout/styling/Escape-to-cancel
// behavior) so deleting a playlist gets the same "are you sure" guard that
// deleting a song already has, instead of the previous single-click
// straight-to-delete button.
function DeletePlaylistDialog({ playlist, onCancel, onConfirm }: {
  playlist: Playlist; onCancel: () => void; onConfirm: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
      onMouseDown={(e) => { if (e.currentTarget === e.target) onCancel(); }}
      onClick={(e) => e.stopPropagation()}>
      <div className="w-full max-w-sm rounded-2xl p-6 shadow-2xl animate-slide-up"
        style={{ background: 'rgba(28,28,28,0.97)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
        <h3 className="text-white font-bold text-lg mb-2">Delete playlist?</h3>
        <p className="text-white/50 text-sm mb-5 leading-snug">
          <span className="text-white/80 font-medium">{playlist.name}</span> ({playlist.songIds.length} {playlist.songIds.length === 1 ? 'song' : 'songs'}) will be permanently deleted. Your songs themselves won't be removed from your library. This can't be undone.
        </p>
        <div className="flex gap-2">
          <button onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 text-sm transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm}
            className="flex-1 py-2.5 rounded-xl bg-red-500/90 hover:bg-red-500 text-white font-semibold text-sm transition-colors">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const playerState = usePlayer();
  const listeningStats = useListeningStats();
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<AppView>('library');
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT);
  const [toast, setToast] = useState<string | null>(null);
  // FIX (inconsistent toast dismiss timing): a single ref-held timer, not
  // tied to any prop/render identity, guarantees a fixed 1500ms dismiss and
  // guarantees only one timer is ever running — a new toast always clears
  // the previous timer first, so overlapping toasts replace cleanly instead
  // of racing.
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string, durationMs = 1500) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, durationMs);
  }, []);
  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showQueueModal, setShowQueueModal] = useState(false);
  const [editSong, setEditSong] = useState<Song | null>(null);
  const [showNewPlaylist, setShowNewPlaylist] = useState(false);
  // Feature (Playlist delete confirmation): holds the playlist awaiting a
  // "are you sure?" before it's actually deleted. Set by requestDeletePlaylist
  // (wired to both the sidebar trash icon and the playlist toolbar's "Delete
  // playlist" button); cleared on cancel or after the dialog's own confirm.
  const [deletingPlaylist, setDeletingPlaylist] = useState<Playlist | null>(null);
  const [newPlaylistSong, setNewPlaylistSong] = useState<Song | null>(null);
  // Drives the AddSongsModal picker opened from the playlist detail
  // toolbar's "Add Songs" button (Task 1). A boolean is enough -- the modal
  // only ever targets whichever playlist is currently open (`currentPlaylist`).
  const [showAddSongs, setShowAddSongs] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const listRef = useRef<VirtualListHandle>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rescanInputRef = useRef<HTMLInputElement>(null);

  const loadAll = useCallback(async () => {
    const [allSongs, liked, pinned, pls, prefs, hist] = await Promise.all([
      getAllSongs(), getLikedIds(), getPinnedIds(), getPlaylists(), getPreferences(), getHistory(50),
    ]);
    setSongs(allSongs); setLikedIds(liked); setPinnedIds(pinned); setPlaylists(pls);
    setAccentColor(prefs.accentColor); setHistory(hist); setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => { document.documentElement.style.setProperty('--accent-color', accentColor); }, [accentColor]);

  // ── Listening time tracking: accumulate minutes while audio is actually playing ──
  useEffect(() => {
    if (playerState.isPlaying) {
      listeningStats.startSession();
    } else {
      listeningStats.stopSession();
    }
    // Make sure we don't leave a dangling open session if the tab/app closes mid-play.
    return () => { listeningStats.stopSession(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerState.isPlaying]);

  // ── "Recently Played" history: logged as soon as a song starts playing ──
  useEffect(() => {
    player.onPlayStart = async (song) => {
      await recordHistoryEntry(song.id);
      const entry: HistoryEntry = { id: `${song.id}-${Date.now()}`, songId: song.id, playedAt: Date.now() };
      setHistory((prev) => [entry, ...prev].slice(0, 50));
    };
    return () => { player.onPlayStart = null; };
  }, []);

  // ── Play count tracking (TASK 3): only counts once the listener has
  // actually heard at least 75% of the song, fired by player.ts's
  // onThresholdReached — see that file for the continuous-session guard
  // that stops scrubbing back/forward from double-counting a single listen. ──
  useEffect(() => {
    player.onThresholdReached = async (song) => {
      await incrementPlayCount(song.id);
      // Update local song state so UI (Stats, Library play-count badge,
      // Most Played view) reflects the new count immediately.
      setSongs((prev) => prev.map((s) => s.id === song.id
        ? { ...s, playCount: (s.playCount ?? 0) + 1, lastPlayedAt: Date.now() } : s));
    };
    return () => { player.onThresholdReached = null; };
  }, []);

  const getViewSongs = useCallback((): Song[] => {
    if (view === 'library') return songs;
    if (view === 'liked') return songs.filter((s) => likedIds.has(s.id));
    if (view === 'most-played') {
      return [...songs].filter((s) => (s.playCount ?? 0) > 0).sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0)).slice(0, 20);
    }
    if (view === 'queue') return []; // Queue view is handled separately
    if (view === 'stats') return []; // Stats view is handled separately
    if (typeof view === 'object' && view.type === 'playlist') {
      const pl = playlists.find((p) => p.id === view.id);
      if (!pl) return [];
      const idSet = new Set(pl.songIds);
      return songs.filter((s) => idSet.has(s.id));
    }
    return songs;
  }, [view, songs, likedIds, playlists]);

  const viewSongs = useMemo(() => getViewSongs(), [getViewSongs]);

  // Change (duplicate imports): duplicates are always imported now, so this
  // replaces the old import-time "N duplicates found" prompt with a
  // non-blocking signal shown inline per-row instead (see SongRow's
  // `isDuplicateTitleArtist` prop).
  const dupTitleArtistIds = useMemo(() => getTitleArtistDuplicateIds(songs), [songs]);

  const filtered = useMemo(() => {
    if (!query.trim()) return viewSongs;
    const q = query.toLowerCase();
    return viewSongs.filter((s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q));
  }, [viewSongs, query]);

  // Feature (Pin/Unpin): pinned songs float to the top of the Library and
  // Playlist views specifically (per spec), set off by a "Pinned" section
  // header row -- Liked Songs / Most Played keep their existing ordering
  // (this doesn't touch them; pinning still shows the pin badge there via
  // SongRow's isPinned prop, it just doesn't regroup those two views).
  // `rows` is what VirtualList actually renders (song rows + optional
  // header); `alphaSongs`/`alphaOffset` are the matching inputs for
  // AlphaScrollBar, which needs the same pinned-then-unpinned order plus
  // how many extra rows (the header) sit above the first song.
  const supportsPinnedGrouping = view === 'library' || (typeof view === 'object' && view.type === 'playlist');
  const { rows, alphaSongs, alphaOffset } = useMemo(() => {
    if (!supportsPinnedGrouping || pinnedIds.size === 0) {
      const songRows: LibraryRow[] = filtered.map((song, i) => ({ kind: 'song', song, displayIndex: i }));
      return { rows: songRows, alphaSongs: filtered, alphaOffset: 0 };
    }
    // FIX (pin order): don't derive the pinned list by filtering `filtered`
    // -- that just keeps them in whatever (alphabetical) order they already
    // had. Instead walk `pinnedIds` itself, whose iteration order is pin
    // order (oldest pin first, see db.ts's getPinnedIds/setPinned), and
    // look each song up. That's what makes "first pinned song is first".
    const filteredById = new Map(filtered.map((s) => [s.id, s] as const));
    const pinned = Array.from(pinnedIds)
      .map((id) => filteredById.get(id))
      .filter((s): s is Song => s !== undefined);
    const unpinned = filtered.filter((s) => !pinnedIds.has(s.id));
    const ordered = [...pinned, ...unpinned];
    const songRows: LibraryRow[] = ordered.map((song, i) => ({ kind: 'song', song, displayIndex: i }));
    const rows: LibraryRow[] = pinned.length > 0
      ? [{ kind: 'header', id: '__pinned-header__', label: 'Pinned' }, ...songRows]
      : songRows;
    return { rows, alphaSongs: ordered, alphaOffset: pinned.length > 0 ? 1 : 0 };
  }, [filtered, pinnedIds, supportsPinnedGrouping]);

  useEffect(() => {
    player.setLibrary(songs, viewSongs);
    if (songs.length > 0 && playerState.queue.length === 0) player.initQueue(songs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songs]);

  useEffect(() => {
    player.setLibrary(songs, viewSongs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewSongs]);

  const handlePlay = useCallback(async (song: Song) => { await player.playSong(song, filtered); }, [filtered]);

  const handleLike = useCallback(async (song: Song) => {
    const nowLiked = !likedIds.has(song.id);
    await dbSetLiked(song.id, nowLiked);
    setLikedIds((prev) => { const n = new Set(prev); if (nowLiked) n.add(song.id); else n.delete(song.id); return n; });
    showToast(nowLiked ? `Liked "${song.title}"` : `Removed from Liked Songs`);
  }, [likedIds]);

  // Pin/Unpin (3-dot menu). Mirrors handleLike's persist-then-update-state
  // shape exactly, using the same pattern as the existing Liked Songs
  // toggle -- a dedicated IndexedDB store (see lib/db.ts's 'pinned-songs')
  // plus local Set state. Updating pinnedIds re-derives `rows` below
  // immediately, so the song jumps to/from the Pinned section without a
  // restart.
  const handlePin = useCallback(async (song: Song) => {
    const nowPinned = !pinnedIds.has(song.id);
    await dbSetPinned(song.id, nowPinned);
    setPinnedIds((prev) => { const n = new Set(prev); if (nowPinned) n.add(song.id); else n.delete(song.id); return n; });
    showToast(nowPinned ? `Pinned "${song.title}"` : `Unpinned "${song.title}"`);
  }, [pinnedIds]);

  const handleQueue = useCallback((song: Song) => {
    player.addToQueue(song);
    showToast(`Queued "${song.title}"`);
  }, []);

  const handlePlayFromQueue = useCallback(async (song: Song, index: number) => {
    // BUG FIX (duplicates in queue): removeFromQueue now takes the row's
    // index rather than song.id, so jumping to one copy of a duplicated
    // song only removes that specific queue entry, not every copy of it.
    // (If `index` falls outside the user queue — i.e. this was one of the
    // auto-queued songs after it — removeFromQueue is a no-op, which is
    // correct: those aren't part of the user queue to begin with.)
    player.removeFromQueue(index);
    await player.loadSong(song, true);
    setShowQueueModal(false);
  }, []);

  const handleAddToPlaylist = useCallback(async (song: Song, playlistId: string) => {
    const pl = playlists.find((p) => p.id === playlistId);
    if (!pl || pl.songIds.includes(song.id)) { if (pl) showToast('Already in playlist'); return; }
    const updated = { ...pl, songIds: [...pl.songIds, song.id] };
    await savePlaylist(updated);
    setPlaylists((prev) => prev.map((p) => (p.id === playlistId ? updated : p)));
    showToast(`Added to "${pl.name}"`);
  }, [playlists]);

  // Task 1: bulk-add handler for the new "Add Songs" playlist-toolbar
  // button + AddSongsModal picker. Mirrors handleAddToPlaylist above but
  // takes multiple song ids and performs a single savePlaylist() write
  // instead of one per song -- consistent with the batching approach
  // already used elsewhere in this codebase (see saveSongsBatch in
  // lib/db.ts) to avoid one IndexedDB transaction per item.
  // Data model: persistence reuses the existing Playlist.songIds string[]
  // field and the existing savePlaylist()/IndexedDB 'playlists' store --
  // no new storage layer or dependency was needed since playlist-song
  // membership was already modeled and persisted this way.
  const handleAddSongsToPlaylist = useCallback(async (songIds: string[]) => {
    if (typeof view !== 'object' || view.type !== 'playlist') return;
    const pl = playlists.find((p) => p.id === view.id);
    if (!pl) return;
    // Edge case (duplicates): dedupe against a Set so a song can never
    // appear twice in songIds, even if it was somehow already added
    // (e.g. via the per-song context menu) between opening the picker
    // and confirming the selection.
    const existing = new Set(pl.songIds);
    const toAdd = songIds.filter((id) => !existing.has(id));
    if (toAdd.length === 0) return;
    const updated = { ...pl, songIds: [...pl.songIds, ...toAdd] };
    await savePlaylist(updated);
    setPlaylists((prev) => prev.map((p) => (p.id === pl.id ? updated : p)));
    showToast(`Added ${toAdd.length} song${toAdd.length !== 1 ? 's' : ''} to "${pl.name}"`);
  }, [view, playlists]);

  const handleCreatePlaylist = useCallback(async (name: string, forSong?: Song) => {
    const pl: Playlist = { id: `pl-${Date.now()}-${Math.random().toString(36).slice(2)}`, name, songIds: forSong ? [forSong.id] : [], createdAt: Date.now() };
    await savePlaylist(pl);
    setPlaylists((prev) => [...prev, pl]);
    showToast(`Created "${name}"`);
    return pl;
  }, []);

  const handleDeletePlaylist = useCallback(async (id: string) => {
    await dbDeletePlaylist(id);
    setPlaylists((prev) => prev.filter((p) => p.id !== id));
    if (typeof view === 'object' && view.type === 'playlist' && view.id === id) setView('library');
    showToast('Playlist deleted');
  }, [view]);

  // Feature (Playlist delete confirmation): the trash icon / toolbar button
  // now call this instead of handleDeletePlaylist directly -- it just opens
  // the confirm dialog. The dialog's onConfirm is what actually calls
  // handleDeletePlaylist.
  const requestDeletePlaylist = useCallback((id: string) => {
    const pl = playlists.find((p) => p.id === id);
    if (pl) setDeletingPlaylist(pl);
  }, [playlists]);

  const handleRemoveFromPlaylist = useCallback(async (song: Song) => {
    if (typeof view !== 'object' || view.type !== 'playlist') return;
    const pl = playlists.find((p) => p.id === view.id);
    if (!pl) return;
    const updated = { ...pl, songIds: pl.songIds.filter((id) => id !== song.id) };
    await savePlaylist(updated);
    setPlaylists((prev) => prev.map((p) => (p.id === view.id ? updated : p)));
  }, [view, playlists]);

  const handleDeleteSong = useCallback(async (song: Song) => {
    // Remove from IndexedDB (both the song record and its audio blob).
    await dbDeleteSong(song.id, song.fileKey);

    // Drop any cached album-art object URL so it doesn't leak.
    invalidateArt(song.id);
    artUrlCache.delete(song.id);

    // Update local state immediately so the row disappears without a reload.
    setSongs((prev) => prev.filter((s) => s.id !== song.id));

    if (likedIds.has(song.id)) {
      setLikedIds((prev) => { const n = new Set(prev); n.delete(song.id); return n; });
      await dbSetLiked(song.id, false);
    }
    if (pinnedIds.has(song.id)) {
      setPinnedIds((prev) => { const n = new Set(prev); n.delete(song.id); return n; });
      await dbSetPinned(song.id, false);
    }

    // Edge case: the song may still be referenced by one or more playlists.
    // Those stale ids would otherwise linger in storage forever (they're
    // already invisible in playlist views since we filter by the live
    // `songs` list, but we clean them up so the playlist data stays tidy).
    const affected = playlists.filter((p) => p.songIds.includes(song.id));
    if (affected.length > 0) {
      const updated = affected.map((p) => ({ ...p, songIds: p.songIds.filter((id) => id !== song.id) }));
      await Promise.all(updated.map((p) => savePlaylist(p)));
      setPlaylists((prev) => prev.map((p) => updated.find((u) => u.id === p.id) ?? p));
    }

    // Edge case: the song may be currently playing, queued, or up next —
    // player.removeSong() strips it out and advances playback if needed.
    player.removeSong(song.id);

    showToast(`Deleted "${song.title}"`);
  }, [likedIds, pinnedIds, playlists]);

  // "Delete all songs" (Settings → Danger Zone): mirrors handleDeleteSong's
  // cleanup above but for the whole library at once, instead of looping
  // handleDeleteSong per song (which would fire a separate player.removeSong
  // + toast + playlist save for every track — slow and visually noisy for a
  // library of any real size).
  const handleDeleteAllSongs = useCallback(async () => {
    await clearAllSongs();

    // Drop every cached album-art object URL so none of them leak.
    songs.forEach((s) => { invalidateArt(s.id); artUrlCache.delete(s.id); });

    setSongs([]);
    setLikedIds(new Set());
    setPinnedIds(new Set());

    // Playlists no longer reference any songs, but the playlists themselves
    // (their names) are left intact — same "keep the shell, drop the dead
    // ids" behavior as single-song delete.
    if (playlists.some((p) => p.songIds.length > 0)) {
      const updated = playlists.map((p) => ({ ...p, songIds: [] }));
      await Promise.all(updated.map((p) => savePlaylist(p)));
      setPlaylists(updated);
    }

    player.clearAll();
    showToast('Deleted all songs from your library');
  }, [songs, playlists]);

  // "Fix missing album art" (Settings → Library): re-parses the audio blob
  // already stored for every song, using the same extractMeta() import
  // uses. Covers songs imported before an art-parsing bug fix landed (the
  // UTF-16 description bug, the unsynchronisation bug -- see
  // metadataParser.ts's comments) -- those files never get a second look
  // otherwise, since importing only runs once per file. Deliberately scans
  // every song, not just ones with no art data at all: the UTF-16 bug left
  // `albumArtData` populated with corrupted-but-non-empty bytes, so a
  // "missing art" filter would skip right past exactly the songs that need
  // fixing (see rescanMissingArt's comments in scanner.ts).
  const [artRescan, setArtRescan] = useState<(ArtRescanProgress & { running: boolean }) | null>(null);
  const handleRescanArt = useCallback(async () => {
    setArtRescan({ current: 0, total: 0, found: 0, running: true });
    const result = await rescanMissingArt((p) => setArtRescan({ ...p, running: true }));
    // Re-pull from IndexedDB rather than patching state in place -- simplest
    // way to pick up every song rescanMissingArt touched without threading
    // per-song updates back out of it.
    const allSongs = await getAllSongs();
    songs.forEach((s) => { invalidateArt(s.id); artUrlCache.delete(s.id); });
    setSongs(allSongs);
    setArtRescan(null);
    showToast(result.fixed > 0
      ? `Fixed art for ${result.fixed} of ${result.scanned} song${result.scanned === 1 ? '' : 's'}`
      : result.scanned > 0 ? 'No art issues found' : 'Your library is empty');
  }, [songs]);

  // REMOVED (Task 2): the playlist-toolbar "Like all" bulk-like button and
  // its handler (previously `handleLikeAll`) have been removed per request.
  // This only touched the bulk control -- individual per-song like buttons
  // (SongRow's `onLike`/`handleLike`) are untouched, and the unrelated
  // "Add all to Liked Songs" library-view bulk button (`handleLikeAllInLibrary`
  // below) is also untouched, since the request was specifically about the
  // playlist view's bulk-like control.

  // Bulk-like every song in the full library. Reuses the existing
  // `likedIds` set / `dbSetLiked` model — no new data model needed.
  // Edge case (confirmed default): songs already liked are skipped rather
  // than re-toggled, so this is idempotent — running it twice in a row (or
  // after some songs were already liked individually) never unlikes anything.
  const handleLikeAllInLibrary = useCallback(async () => {
    const toLike = songs.filter((s) => !likedIds.has(s.id));
    if (toLike.length === 0) { showToast('All songs are already liked'); return; }
    const n = new Set(likedIds);
    for (const s of toLike) { await dbSetLiked(s.id, true); n.add(s.id); }
    setLikedIds(n);
    showToast(`Liked ${toLike.length} song${toLike.length !== 1 ? 's' : ''}`);
  }, [songs, likedIds]);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const fileArr = Array.from(files);

    // Duplicates (by file path) are always imported now -- no prompt, no
    // skipping. Tracks that share a title+artist with an existing track are
    // still surfaced to the user, just as a non-blocking badge in the list
    // (see dupTitleArtistIds below) instead of a confirm() dialog up front.
    setImportProgress({ current: 0, total: fileArr.length, fileName: '' });
    const result = await importFiles(fileArr, setImportProgress);
    setImportProgress(null);
    const allSongs = await getAllSongs();
    setSongs(allSongs);
    // BUG FIX (songs silently missing after import): this used to only ever
    // show `Added ${result.added} songs`, completely ignoring
    // `result.skipped`. Any per-file failure inside importFiles/finalizeOne
    // (a thrown error is caught there, not surfaced) meant a song could
    // just vanish from the import with zero indication -- no toast, no
    // error, nothing visible unless devtools happened to be open reading a
    // console.warn. Onboarding's first-run import screen already surfaced
    // this count; this button (the one used for every import after the
    // first) did not.
    showToast(
      `Added ${result.added} song${result.added !== 1 ? 's' : ''}` +
      (result.skipped > 0 ? `, ${result.skipped} file${result.skipped !== 1 ? 's' : ''} could not be imported` : '')
    );
    e.target.value = '';
  };

  // "Rescan folder" (toolbar, refresh icon): re-select the same folder you
  // originally imported and only the files that aren't in the library yet
  // get added -- everything already imported is skipped instead of being
  // duplicated, unlike the plain "Import folder" button above. There's no
  // way to remember *which* folder without the File System Access API
  // (which webkitdirectory doesn't give us, and isn't supported in every
  // browser this app targets), so this still means picking the folder
  // again each time -- it just makes doing that safe to repeat.
  //
  // Dedup key is `${fileName}|${fileSize}` rather than fileKey, since
  // fileKey is a random id generated fresh per import and was never meant
  // to be stable across separate import runs -- name+size is what actually
  // identifies "the same file on disk" when you reselect a folder.
  // TASK 2: tracks whether an in-progress `importProgress` update came from
  // the Rescan Library button specifically (vs. the plain "Import folder" /
  // "Import files" buttons, which also drive importProgress). Used to (a)
  // show the inline "Scanning… N found" status + spinner right next to the
  // Rescan button, and (b) disable that button while a scan is running so a
  // second scan can't be kicked off on top of it.
  const [rescanning, setRescanning] = useState(false);

  const handleRescanFolder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const existing = new Set(songs.map((s) => `${s.fileName}|${s.fileSize}`));
    const fileArr = Array.from(files).filter((f) => !existing.has(`${f.name}|${f.size}`));
    const skipped = files.length - fileArr.length;
    if (fileArr.length === 0) {
      showToast(`No new songs found (${skipped} already in library)`);
      e.target.value = '';
      return;
    }
    setRescanning(true);
    setImportProgress({ current: 0, total: fileArr.length, fileName: '' });
    try {
      const result = await importFiles(fileArr, setImportProgress);
      const allSongs = await getAllSongs();
      setSongs(allSongs);
      // Success message auto-dismisses after 3s (longer than the default
      // 1.5s toast) so it's easy to read after watching a scan run.
      showToast(
        result.added > 0
          ? `Library updated — ${allSongs.length} song${allSongs.length !== 1 ? 's' : ''} found`
          : `No new songs found (${skipped} already in library)`,
        3000,
      );
    } finally {
      setImportProgress(null);
      setRescanning(false);
      e.target.value = '';
    }
  };

  const handleSongUpdated = useCallback((updated: Song) => {
    invalidateArt(updated.id);
    artUrlCache.delete(updated.id);
    setSongs((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    player.patchCurrentSong(updated);
  }, []);

  const handleAccentChange = useCallback(async (color: string) => {
    setAccentColor(color);
    await savePreferences({ accentColor: color });
  }, []);

  const handleShuffleToggle = useCallback(() => {
    player.setShuffle(playerState.shuffleMode === 'off' ? 'view' : 'off');
  }, [playerState.shuffleMode]);

  const handleClearHistory = useCallback(async () => {
    await clearHistory();
    setHistory([]);
    showToast('History cleared');
  }, []);

  const artUrl = useMemo(() => getCachedArtUrl(playerState.currentSong),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playerState.currentSong?.id, playerState.currentSong?.albumArtData]);

  const currentPlaylist = typeof view === 'object' && view.type === 'playlist' ? playlists.find((p) => p.id === view.id) : null;
  const viewLabel = view === 'library' ? 'Library'
    : view === 'liked' ? 'Liked Songs'
    : view === 'most-played' ? 'Most Played'
    : view === 'stats' ? 'Stats'
    : view === 'queue' ? 'Queue'
    : currentPlaylist?.name ?? 'Playlist';

  const isSpecialView = view === 'stats' || view === 'queue';

  // Build the full upcoming list: manually-queued songs first, then the
  // rest of the playback queue after the current index.
  const upcomingSongs = useMemo(() => {
    const songMap = new Map(songs.map((s) => [s.id, s]));
    const userQ = playerState.userQueue.map((q) => songMap.get(q.id)).filter(Boolean) as Song[];
    const autoQ = playerState.queue
      .slice(playerState.currentIndex + 1)
      .map((q) => songMap.get(q.id))
      .filter(Boolean) as Song[];
    return [...userQ, ...autoQ];
  }, [playerState.userQueue, playerState.queue, playerState.currentIndex, songs]);

  // Songs that came from the manual userQueue (first N items) — these are
  // the only ones that can be removed/reordered via the panel.
  const userQueueLen = playerState.userQueue.length;
  const queuedIds = useMemo(() => new Set(playerState.userQueue.map((s) => s.id)), [playerState.userQueue]);

  if (!loading && songs.length === 0) {
    return (
      <>
        <style>{`:root { --accent-color: ${accentColor}; }`}</style>
        <Onboarding accentColor={accentColor} onComplete={loadAll} />
      </>
    );
  }

  return (
    <>
      <style>{`:root { --accent-color: ${accentColor}; }`}</style>

      <div className="h-full flex flex-col bg-[#121212] overflow-hidden">
        <div className="flex-1 min-h-0 flex overflow-hidden">

          {/* Mobile sidebar overlay */}
          {sidebarOpen && <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setSidebarOpen(false)} />}
          <div className={`fixed md:relative z-50 md:z-auto w-64 h-full md:h-auto shrink-0 transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
            <Sidebar
              currentView={view}
              onViewChange={(v) => { setView(v); setQuery(''); setSidebarOpen(false); }}
              playlists={playlists}
              likedCount={likedIds.size}
              accentColor={accentColor}
              queueCount={playerState.userQueue.length}
              onCreatePlaylist={() => setShowNewPlaylist(true)}
              onDeletePlaylist={requestDeletePlaylist}
              onOpenSettings={() => setShowSettings(true)}
            />
          </div>

          {/* Main content */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 px-3 md:px-4 pt-3 pb-2 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <button className="md:hidden btn-icon w-9 h-9 hover:bg-white/8 shrink-0" onClick={() => setSidebarOpen(true)}>
                <Menu size={20} className="text-white/60" />
              </button>
              <h2 className="text-white font-bold text-base md:text-lg truncate shrink-0 mr-1">{viewLabel}</h2>
              {!isSpecialView && (
                <div className="flex-1 relative max-w-xs ml-auto">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                  <input type="text" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)}
                    className="w-full rounded-full pl-8 pr-8 py-2 text-sm text-white placeholder-white/30 focus:outline-none transition-colors"
                    style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.09)' }}
                    onFocus={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)'; }}
                    onBlur={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.09)'; }} />
                  {query && <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"><X size={13} /></button>}
                </div>
              )}
              <div className={`${isSpecialView ? 'ml-auto' : ''} flex items-center gap-1`}>
                {/* Folder import */}
                <label className="btn-icon w-9 h-9 hover:bg-white/8 cursor-pointer shrink-0" title="Import folder">
                  <FolderOpen size={17} className="text-white/50" />
                  <input type="file" ref={folderInputRef}
                    // @ts-expect-error — webkitdirectory is non-standard but widely supported
                    webkitdirectory="" directory="" multiple accept="audio/*" className="hidden" onChange={handleImport} />
                </label>
                {/* Rescan folder: re-pick the same folder, only new files get added.
                    Disabled while a scan is already running (Task 2) so a second
                    scan can't be started on top of the first. */}
                <label
                  className={`btn-icon w-9 h-9 hover:bg-white/8 shrink-0 ${rescanning ? 'opacity-40 pointer-events-none cursor-not-allowed' : 'cursor-pointer'}`}
                  title={rescanning ? 'Scanning…' : 'Rescan library for new songs'}
                  aria-disabled={rescanning}>
                  {rescanning ? <Loader2 size={16} className="text-white/50 animate-spin" /> : <RefreshCw size={16} className="text-white/50" />}
                  <input type="file" ref={rescanInputRef} disabled={rescanning}
                    // @ts-expect-error — webkitdirectory is non-standard but widely supported
                    webkitdirectory="" directory="" multiple accept="audio/*" className="hidden" onChange={handleRescanFolder} />
                </label>
                {/* Inline scan status, adjacent to the Rescan button (Task 2) */}
                {rescanning && importProgress && (
                  <span className="hidden sm:inline text-white/50 text-xs whitespace-nowrap animate-fade-in">
                    Scanning… {importProgress.current} / {importProgress.total} found
                  </span>
                )}
                {/* Individual file import */}
                <label className="btn-icon w-9 h-9 hover:bg-white/8 cursor-pointer shrink-0" title="Import files">
                  <MusicIcon size={17} className="text-white/50" />
                  <input type="file" ref={fileInputRef} multiple accept="audio/*" className="hidden" onChange={handleImport} />
                </label>
              </div>
            </div>

            {/* Import progress */}
            {importProgress && (
              <div className="px-4 py-2 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="flex items-center gap-2 text-white/50 text-xs mb-1.5">
                  <Loader2 size={11} className="animate-spin" />
                  {importProgress.finalizing
                    ? `Saving ${importProgress.current} / ${importProgress.total}…`
                    : importProgress.fileName ? `Importing ${importProgress.current} / ${importProgress.total} — ${importProgress.fileName}` : `Importing ${importProgress.current} / ${importProgress.total}…`}
                </div>
                <div className="h-0.5 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${(importProgress.current / Math.max(importProgress.total, 1)) * 100}%`, background: accentColor }} />
                </div>
              </div>
            )}

            {/* ── STATS VIEW ── */}
            {view === 'stats' ? (
              <StatsScreen songs={songs} history={history} accentColor={accentColor} onClearHistory={handleClearHistory} onPlaySong={handlePlay} listeningStats={listeningStats.stats} sessions={listeningStats.sessions} />
            ) : view === 'queue' ? (
              /* ── QUEUE VIEW ── */
              <QueuePanel
                queue={upcomingSongs}
                userQueueLen={userQueueLen}
                currentSong={playerState.currentSong}
                accentColor={accentColor}
                onClose={() => setView('library')}
                onPlayFromQueue={handlePlayFromQueue}
                onRemoveFromQueue={(index) => player.removeFromQueue(index)}
                onReorderQueue={(from, to) => player.reorderQueue(from, to)}
                onClearQueue={() => { player.clearQueue(); showToast('Queue cleared'); }}
              />
            ) : (
              /* ── SONG LIST VIEWS ── */
              <>
                {/* Playlist toolbar */}
                {currentPlaylist && (
                  <div className="flex items-center gap-2 px-4 py-2 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    {/* Task 1: opens the AddSongsModal picker, scoped to
                        whichever playlist is currently open. Replaces the
                        old "Like all" bulk button in this same toolbar slot
                        (Task 2 removed it). */}
                    <button onClick={() => setShowAddSongs(true)}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 transition-colors" style={{ color: accentColor }}>
                      <Plus size={13} style={{ color: accentColor }} /> Add Songs
                    </button>
                    <button onClick={() => requestDeletePlaylist(currentPlaylist.id)}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-white/5 hover:bg-red-500/15 hover:text-red-400 text-white/50 transition-colors">
                      <Trash2 size={13} /> Delete playlist
                    </button>
                    <span className="text-white/30 text-xs ml-auto">{filtered.length} songs</span>
                  </div>
                )}

                {/* Most played header */}
                {view === 'most-played' && (
                  <div className="px-4 py-2 shrink-0 flex items-center gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <TrendingUp size={14} style={{ color: accentColor }} />
                    <span className="text-white/40 text-xs">Top 20 songs by play count</span>
                    <span className="text-white/30 text-xs ml-auto">{filtered.length} songs</span>
                  </div>
                )}

                {/* Song count (+ bulk action, Library view only) */}
                {!currentPlaylist && view !== 'most-played' && (
                  <div className="px-4 py-1.5 shrink-0 flex items-center gap-2">
                    <span className="text-white/25 text-xs">{filtered.length}{filtered.length !== viewSongs.length ? ` of ${viewSongs.length}` : ''} songs</span>
                    {/* Bulk-like only makes sense in the actual Library view
                        (not e.g. the Liked Songs view itself), and only once
                        there's something to like. Styled to match the
                        existing "Like all" playlist-toolbar button above. */}
                    {view === 'library' && songs.length > 0 && (
                      <button onClick={handleLikeAllInLibrary}
                        className="ml-auto flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 transition-colors" style={{ color: accentColor }}>
                        <Heart size={12} fill={accentColor} style={{ color: accentColor }} /> Add all to Liked Songs
                      </button>
                    )}
                  </div>
                )}

                {/* Song list + A-Z bar */}
                <div className="flex-1 min-h-0 flex overflow-hidden">
                  {loading ? (
                    <div className="flex-1 flex items-center justify-center"><Loader2 size={28} className="animate-spin text-white/20" /></div>
                  ) : filtered.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-white/25 gap-2">
                      {view === 'liked' ? (
                        <><Heart size={40} className="mb-2 text-white/15" /><p className="font-medium">No liked songs yet</p><p className="text-xs">Press the heart icon on any song</p></>
                      ) : view === 'most-played' ? (
                        <><TrendingUp size={40} className="mb-2 text-white/15" /><p className="font-medium">No plays yet</p><p className="text-xs">Play some music to build your stats</p></>
                      ) : (
                        <><FolderOpen size={40} className="mb-2 text-white/15" /><p className="font-medium">No songs found</p></>
                      )}
                    </div>
                  ) : (
                    <>
                      <VirtualList ref={listRef} items={rows} className="flex-1"
                        getItemHeight={(row) => row.kind === 'header' ? PINNED_HEADER_HEIGHT : ROW_HEIGHT}
                        renderItem={(row) => row.kind === 'header' ? (
                          <div key={row.id} className="h-full flex items-end px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/35"
                            style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                            {row.label}
                          </div>
                        ) : (
                          <SongRow key={row.song.id} song={row.song} index={row.displayIndex}
                            isCurrent={playerState.currentSong?.id === row.song.id}
                            isPlaying={playerState.isPlaying}
                            isLiked={likedIds.has(row.song.id)}
                            isPinned={pinnedIds.has(row.song.id)}
                            isQueued={queuedIds.has(row.song.id)}
                            accentColor={accentColor}
                            playlists={playlists}
                            isInPlaylist={!!currentPlaylist}
                            showPlayCount={view === 'most-played'}
                            isDuplicateTitleArtist={dupTitleArtistIds.has(row.song.id)}
                            onPlay={handlePlay}
                            onLike={handleLike}
                            onPin={handlePin}
                            onQueue={handleQueue}
                            onAddToPlaylist={handleAddToPlaylist}
                            onCreatePlaylist={(s) => { setNewPlaylistSong(s); setShowNewPlaylist(true); }}
                            onEditArt={setEditSong}
                            onDelete={handleDeleteSong}
                            onRemoveFromPlaylist={currentPlaylist ? handleRemoveFromPlaylist : undefined}
                            onViewQueue={() => setShowQueueModal(true)}
                          />
                        )} />
                      {/* Feature (Liked Songs A-Z index): previously excluded
                          `view === 'liked'` -- Liked Songs is already sorted
                          alphabetically (it's filtered straight out of the
                          globally alphabetical `songs` array), so the same
                          jump-to-letter bar now applies there too. */}
                      {!query && view !== 'most-played' && <AlphaScrollBar songs={alphaSongs} accentColor={accentColor} listRef={listRef} indexOffset={alphaOffset} />}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Player Bar */}
        {/* Mobile now uses a taller 3-row expanded layout (art+title / transport
            controls / seek row), so it needs more vertical room than desktop's
            compact single-row 68px bar. */}
        <div className="h-[176px] md:h-[68px] shrink-0 px-2 pb-2">
          <PlayerBar
            currentSong={playerState.currentSong}
            artUrl={artUrl}
            isPlaying={playerState.isPlaying}
            isLoading={playerState.isLoading}
            currentTime={playerState.currentTime}
            duration={playerState.duration}
            volume={playerState.volume}
            muted={playerState.muted}
            shuffleMode={playerState.shuffleMode}
            repeat={playerState.repeat}
            accentColor={accentColor}
            queueCount={playerState.userQueue.length}
            onPrev={() => player.previous()}
            onNext={() => player.next(false)}
            onTogglePlay={() => player.togglePlay()}
            onSeek={(t) => player.seek(t)}
            onVolume={(v) => player.setVolume(v)}
            onMute={() => player.setMuted(!playerState.muted)}
            onShuffleToggle={handleShuffleToggle}
            onShuffleModeChange={(mode) => player.setShuffle(mode)}
            onRepeat={() => {
              const modes: import('./types').RepeatMode[] = ['off', 'all', 'one'];
              player.setRepeat(modes[(modes.indexOf(playerState.repeat) + 1) % modes.length]);
            }}
            onOpenQueue={() => setShowQueueModal(true)}
          />
        </div>
      </div>

      {/* Modals */}
      {showSettings && (
        <SettingsPanel
          accentColor={accentColor}
          onAccentChange={handleAccentChange}
          onClose={() => setShowSettings(false)}
          songCount={songs.length}
          onDeleteAllSongs={handleDeleteAllSongs}
          onRescanArt={handleRescanArt}
          artRescan={artRescan}
        />
      )}
      {editSong && <AlbumArtEditModal song={editSong} accentColor={accentColor} onClose={() => setEditSong(null)} onUpdated={(u) => { handleSongUpdated(u); setEditSong(null); }} />}
      {showNewPlaylist && <NewPlaylistModal accentColor={accentColor} onCreated={(name) => handleCreatePlaylist(name, newPlaylistSong ?? undefined)} onClose={() => { setShowNewPlaylist(false); setNewPlaylistSong(null); }} />}
      {/* Task 1: song picker for the playlist toolbar's "Add Songs" button.
          Only rendered while a playlist is actually open, so `currentPlaylist`
          is guaranteed non-null here. */}
      {showAddSongs && currentPlaylist && (
        <AddSongsModal
          playlist={currentPlaylist}
          songs={songs}
          accentColor={accentColor}
          onClose={() => setShowAddSongs(false)}
          onConfirm={handleAddSongsToPlaylist}
        />
      )}
      {deletingPlaylist && (
        <DeletePlaylistDialog
          playlist={deletingPlaylist}
          onCancel={() => setDeletingPlaylist(null)}
          onConfirm={() => { handleDeletePlaylist(deletingPlaylist.id); setDeletingPlaylist(null); }}
        />
      )}
      {showQueueModal && (
        <div className="fixed inset-0 z-50 flex justify-end md:items-center md:justify-center"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowQueueModal(false); }}>
          <div className="w-full max-w-sm h-full md:h-auto md:max-h-[80vh] animate-slide-in-right md:animate-slide-up"
            style={{ background: 'rgba(20,20,20,0.97)', backdropFilter: 'blur(20px)', borderLeft: '1px solid rgba(255,255,255,0.1)', maxWidth: '480px' }}>
            <QueuePanel
              queue={upcomingSongs}
              userQueueLen={userQueueLen}
              currentSong={playerState.currentSong}
              accentColor={accentColor}
              onClose={() => setShowQueueModal(false)}
              onPlayFromQueue={handlePlayFromQueue}
              onRemoveFromQueue={(index) => player.removeFromQueue(index)}
              onReorderQueue={(from, to) => player.reorderQueue(from, to)}
              onClearQueue={() => { player.clearQueue(); showToast('Queue cleared'); }}
            />
          </div>
        </div>
      )}
      {toast && <Toast message={toast} />}
    </>
  );
}
