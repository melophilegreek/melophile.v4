import { useState, useEffect, useRef, useCallback } from 'react';
import { Heart, Play, Pencil, ListMusic, FolderPlus, X, ListPlus, Repeat, Trash2, MoreVertical, Copy, Pin, PinOff } from 'lucide-react';
import type { Playlist, Song } from '../types';
import { initialFor, placeholderBackground } from '../lib/artPlaceholder';

const artCache = new Map<string, string>();

export function getArtUrl(song: Song): string | null {
  if (!song.albumArtData) return null;
  if (artCache.has(song.id)) return artCache.get(song.id)!;
  const url = URL.createObjectURL(new Blob([song.albumArtData], { type: song.albumArtMime || 'image/jpeg' }));
  artCache.set(song.id, url);
  return url;
}

export function invalidateArt(songId: string) {
  const url = artCache.get(songId);
  if (url) { URL.revokeObjectURL(url); artCache.delete(songId); }
}

/**
 * BUG FIX (broken album art): a non-null artUrl only means an object URL was
 * created for the song's stored art bytes — it doesn't mean the browser can
 * actually decode those bytes (corrupt/truncated art, an unsupported image
 * format, etc). None of the <img> tags rendering album art had an onError
 * handler, so a bad artUrl silently rendered the browser's default
 * broken-image icon instead of the app's placeholder, with nothing logged to
 * explain why. This hook tracks failures per song/url and every place that
 * renders art (SongRow, QueuePanel, StatsScreen, PlayerBar) falls back to its
 * existing placeholder note icon and logs a descriptive warning once.
 */
export function useAlbumArtError(song: Song, url: string | null) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [url]);
  const onError = () => {
    if (failed) return;
    console.warn(
      `Album art failed to load for "${song.title}"${song.artist ? ` by ${song.artist}` : ''} ` +
      `(mime: ${song.albumArtMime ?? 'unknown'}). Falling back to placeholder icon.`,
      { songId: song.id, fileName: song.fileName, artUrl: url },
    );
    setFailed(true);
  };
  return { showArt: !!url && !failed, onError };
}

function formatDuration(s: number): string {
  if (!s || !isFinite(s) || s <= 0) return '';
  const m = Math.floor(s / 60); const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function PlayingIndicator({ accent }: { accent: string }) {
  return (
    <div className="flex items-end gap-[2px] h-3">
      {[0, 1, 2].map((i) => (
        <span key={i} className="w-[3px] rounded-full animate-pulse-bar"
          style={{ height: '100%', background: accent, animationDelay: `${i * 0.15}s` }} />
      ))}
    </div>
  );
}

// ── Track actions menu (3-dot overflow + right-click) ──────────────────────────
// TASK 2 (consolidate per-track actions): this used to be a "ContextMenu"
// shown only on right-click, with Like, Add to Playlist, and Edit album art
// as separate always-in-the-DOM inline buttons next to it. Those inline
// buttons are gone now — this single accessible menu is the only way to
// reach Like/Unlike, Add to Playlist, Edit album art, and Delete, and it's
// opened either by right-clicking the row or by the visible 3-dot button.
interface TrackMenuProps {
  x: number; y: number;
  song: Song;
  playlists: Playlist[];
  isLiked: boolean;
  isPinned: boolean;
  accentColor: string;
  onClose: () => void;
  onLike: (song: Song) => void;
  onPin: (song: Song) => void;
  onEditArt: (song: Song) => void;
  onAddToPlaylist: (song: Song, playlistId: string) => void;
  onCreatePlaylist: (song: Song) => void;
  onRemoveFromPlaylist?: (song: Song) => void;
  onRequestDelete: (song: Song) => void;
  /** FIX (Add to Queue menu item): calls the same underlying queue function
   * the swipe-to-queue gesture uses, so both paths stay consistent. */
  onQueue: (song: Song) => void;
  /** FIX (View Queue menu item): opens the existing queue panel/modal. */
  onViewQueue: () => void;
  /** Focus is returned here when the menu closes via Escape/keyboard activation (i.e. it was opened via the keyboard-reachable 3-dot button, not a mouse right-click). */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

function TrackMenu({
  x, y, song, playlists, isLiked, isPinned, accentColor, onClose,
  onLike, onPin, onEditArt, onAddToPlaylist, onCreatePlaylist, onRemoveFromPlaylist, onRequestDelete, returnFocusRef,
  onQueue, onViewQueue,
}: TrackMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback((restoreFocus: boolean) => {
    onClose();
    if (restoreFocus) returnFocusRef?.current?.focus();
  }, [onClose, returnFocusRef]);

  useEffect(() => {
    const clickOutside = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(false); };
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(true); return; }
      if (!ref.current) return;
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>('[role="menuitem"]'));
      if (!items.length) return;
      const idx = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(idx + 1 + items.length) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(idx - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
    };
    // Deferred so the click that opened the menu doesn't also close it.
    const t = setTimeout(() => document.addEventListener('mousedown', clickOutside), 0);
    document.addEventListener('keydown', keydown, true);
    // Autofocus the first menu item so keyboard users land straight in the menu.
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', clickOutside);
      document.removeEventListener('keydown', keydown, true);
    };
  }, [close]);

  const left = Math.min(x, window.innerWidth - 224);
  const top = Math.min(y, window.innerHeight - 340);
  const itemClass = 'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-white/80 hover:bg-white/10 focus:bg-white/10 focus:outline-none text-sm transition-colors';

  return (
    <div ref={ref} role="menu" aria-label={`Actions for ${song.title}`}
      className="w-56 rounded-xl overflow-hidden shadow-2xl border border-white/10 animate-fade-in fixed z-[1000]"
      style={{ left, top, background: 'rgba(30,30,30,0.95)', backdropFilter: 'blur(16px)' }}>
      <div className="px-3 py-2 border-b border-white/10">
        <p className="text-white text-xs font-semibold truncate">{song.title}</p>
        <p className="text-white/40 text-xs truncate">{song.artist}</p>
      </div>
      <div className="p-1">
        <button role="menuitem" tabIndex={-1} onClick={() => { onLike(song); close(false); }} className={itemClass}>
          <Heart size={14} fill={isLiked ? accentColor : 'none'} style={{ color: isLiked ? accentColor : 'rgba(255,255,255,0.6)' }} />
          {isLiked ? 'Unlike' : 'Like'}
        </button>
        <button role="menuitem" tabIndex={-1} onClick={() => { onPin(song); close(false); }} className={itemClass}>
          {isPinned ? <PinOff size={14} style={{ color: accentColor }} /> : <Pin size={14} className="text-white/50" />}
          {isPinned ? 'Unpin Song' : 'Pin Song'}
        </button>
        <button role="menuitem" tabIndex={-1} onClick={() => { onEditArt(song); close(false); }} className={itemClass}>
          <Pencil size={14} className="text-white/50" /> Edit album art
        </button>
        {/* FIX (Add to Queue menu item): calls the same onQueue callback the
            swipe-to-queue gesture uses (player.addToQueue under the hood),
            so both entry points stay consistent. */}
        <button role="menuitem" tabIndex={-1} onClick={() => { onQueue(song); close(false); }} className={`${itemClass} mt-1`}>
          <ListPlus size={14} className="text-white/50" /> Add to queue
        </button>
        {/* FIX (View Queue menu item): opens the existing queue panel/modal
            so the queue can be reviewed or managed without leaving the row. */}
        <button role="menuitem" tabIndex={-1} onClick={() => { onViewQueue(); close(false); }} className={itemClass}>
          <ListMusic size={14} className="text-white/50" /> View queue
        </button>
        <button role="menuitem" tabIndex={-1} onClick={() => { onCreatePlaylist(song); close(false); }} className={`${itemClass} mt-1`}>
          <FolderPlus size={14} className="text-white/50" /> New playlist
        </button>
        {playlists.length > 0 && (
          <>
            <div className="px-3 py-1 text-[10px] text-white/30 uppercase tracking-wider font-semibold mt-1">Add to playlist</div>
            {playlists.map((pl) => (
              <button key={pl.id} role="menuitem" tabIndex={-1} onClick={() => { onAddToPlaylist(song, pl.id); close(false); }} className={itemClass}>
                <ListMusic size={14} className="text-white/50" /> <span className="truncate">{pl.name}</span>
              </button>
            ))}
          </>
        )}
        {onRemoveFromPlaylist && (
          <button role="menuitem" tabIndex={-1} onClick={() => { onRemoveFromPlaylist(song); close(false); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-red-400 hover:bg-red-500/10 focus:bg-red-500/10 focus:outline-none text-sm transition-colors mt-1">
            <X size={14} /> Remove from playlist
          </button>
        )}
        <div className="h-px bg-white/10 my-1" />
        <button role="menuitem" tabIndex={-1} onClick={() => { onRequestDelete(song); close(false); }}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-red-400 hover:bg-red-500/10 focus:bg-red-500/10 focus:outline-none text-sm transition-colors">
          <Trash2 size={14} /> Delete from library
        </button>
      </div>
    </div>
  );
}

// ── Delete confirmation dialog ─────────────────────────────────────────────────
function DeleteConfirmDialog({ song, onCancel, onConfirm }: {
  song: Song; onCancel: () => void; onConfirm: () => void;
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
        <h3 className="text-white font-bold text-lg mb-2">Delete song?</h3>
        <p className="text-white/50 text-sm mb-5 leading-snug">
          <span className="text-white/80 font-medium">{song.title}</span> will be permanently removed from your library. This can't be undone.
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


// ── Main SongRow with swipe-to-queue ──────────────────────────────────────────
interface SongRowProps {
  song: Song;
  index: number;
  isCurrent: boolean;
  isPlaying: boolean;
  isLiked: boolean;
  /** Pin/Unpin feature: true when this song is pinned. Drives the small pin
   *  badge on the row and the Pin/Unpin toggle wording in the overflow menu. */
  isPinned: boolean;
  isQueued: boolean;
  accentColor: string;
  playlists: Playlist[];
  isInPlaylist?: boolean;
  showPlayCount?: boolean;
  /** Change (duplicate imports): true when another imported track shares this
   *  one's title + artist. Duplicates are always imported now (no blocking
   *  prompt), so this badge is the only signal the user gets that it happened. */
  isDuplicateTitleArtist?: boolean;
  onPlay: (song: Song) => void;
  onLike: (song: Song) => void;
  onPin: (song: Song) => void;
  onQueue: (song: Song) => void;
  onAddToPlaylist: (song: Song, playlistId: string) => void;
  onCreatePlaylist: (song: Song) => void;
  onEditArt: (song: Song) => void;
  onDelete: (song: Song) => void;
  onRemoveFromPlaylist?: (song: Song) => void;
  /** FIX (View Queue menu item): opens the existing queue panel/modal. */
  onViewQueue: () => void;
}

export function SongRow({
  song, index, isCurrent, isPlaying, isLiked, isPinned, isQueued, accentColor, playlists, isInPlaylist, showPlayCount, isDuplicateTitleArtist,
  onPlay, onLike, onPin, onQueue, onAddToPlaylist, onCreatePlaylist, onEditArt, onDelete, onRemoveFromPlaylist, onViewQueue,
}: SongRowProps) {
  const [trackMenu, setTrackMenu] = useState<{ x: number; y: number; keyboardTriggered: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [swipeX, setSwipeX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
// Auto-dismiss the delete confirmation after 2.5 seconds
  useEffect(() => {
    if (!confirmDelete) return;

    const timer = setTimeout(() => {
      setConfirmDelete(false);
    }, 2500);

    return () => clearTimeout(timer);
  }, [confirmDelete]);
  
  const startTime = useRef(0);

  const artUrl = getArtUrl(song);
  const { showArt, onError: onArtError } = useAlbumArtError(song, artUrl);
  const duration = formatDuration(song.duration);
  const kbpsLabel = song.kbps != null ? `${song.kbps} kbps` : '? kbps';
  const meta = [duration, kbpsLabel].filter(Boolean).join(' · ');

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); setTrackMenu({ x: e.clientX, y: e.clientY, keyboardTriggered: false });
  }, []);

  const openMenuFromButton = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setTrackMenu({ x: r.right - 224, y: r.bottom + 6, keyboardTriggered: true });
  }, []);

  // ── Swipe left-to-right to queue ──
  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    startTime.current = Date.now();
    setSwiping(true);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!swiping) return;
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;
    if (Math.abs(dy) > Math.abs(dx)) { setSwiping(false); setSwipeX(0); return; }
    if (dx > 0) { e.preventDefault(); setSwipeX(Math.min(dx, 100)); }
  };

  const onTouchEnd = () => {
    if (swipeX > 60) { onQueue(song); }
    setSwipeX(0); setSwiping(false);
  };

  const showQueueHint = swipeX > 20;

  return (
    <>
      <div className="relative h-full overflow-hidden">
        {/* Queue hint background revealed on swipe */}
        <div className="absolute inset-0 flex items-center justify-start px-4"
          style={{ background: `${accentColor}15`, opacity: showQueueHint ? 1 : 0, transition: 'opacity 0.15s' }}>
          <div className="flex items-center gap-2" style={{ color: accentColor }}>
            <ListPlus size={20} />
            <span className="text-sm font-semibold">Queue</span>
          </div>
        </div>

        {/* Main row */}
        <div
          className={`group flex items-center gap-3 px-3 h-full cursor-pointer transition-colors ${
            isCurrent ? 'bg-white/[0.07]' : 'hover:bg-white/[0.05]'
          }`}
          style={{ transform: `translateX(${swipeX}px)`, transition: swiping ? 'none' : 'transform 0.3s cubic-bezier(0.16,1,0.3,1)' }}
          onClick={() => { if (swipeX === 0) onPlay(song); }}
          onContextMenu={handleContextMenu}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {/* Index / Playing */}
          <div className="w-6 flex items-center justify-center shrink-0">
            {isCurrent && isPlaying ? (
              <PlayingIndicator accent={accentColor} />
            ) : (
              <>
                <span className="text-xs tabular-nums text-white/30 group-hover:hidden"
                  style={isCurrent ? { color: accentColor } : {}}>{index + 1}</span>
                <Play size={12} fill="white" className="text-white hidden group-hover:block ml-0.5" />
              </>
            )}
          </div>

          {/* Thumbnail */}
          <div className="w-10 h-10 rounded-md shrink-0 overflow-hidden flex items-center justify-center" style={{ background: placeholderBackground(accentColor) }}>
            {showArt ? <img src={artUrl!} alt="" className="w-full h-full object-cover" onError={onArtError} /> : <span className="text-xs font-semibold" style={{ color: accentColor }}>{initialFor(song)}</span>}
          </div>

          {/* Title + meta */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate leading-tight flex items-center gap-1.5" style={{ color: isCurrent ? accentColor : 'rgba(255,255,255,0.9)' }}>
              <span className="truncate">{song.title}</span>
              {isDuplicateTitleArtist && (
                <span
                  className="inline-flex shrink-0"
                  aria-label="Another imported track shares this title and artist"
                  title="Another imported track shares this title and artist"
                >
                  <Copy size={11} className="text-white/35" />
                </span>
              )}
            </p>
            <p className="text-xs text-white/40 truncate leading-tight mt-0.5">
              {song.artist}{meta ? ` · ${meta}` : ''}
            </p>
          </div>

          {/* Queued indicator */}
          {isQueued && (
            <div className="shrink-0 mr-1">
              <ListPlus size={14} style={{ color: accentColor }} />
            </div>
          )}

          {/* Pinned indicator — non-interactive; Pin/Unpin itself lives in the
              overflow menu below. Shown before the Liked heart so a pinned
              song is identifiable at a glance regardless of its liked state. */}
          {isPinned && (
            <div className="shrink-0 mr-1" aria-label="Pinned" title="Pinned">
              <Pin size={14} fill={accentColor} style={{ color: accentColor }} />
            </div>
          )}

          {/* Liked indicator — non-interactive; Like/Unlike itself now lives in the overflow menu below, so this preserves at-a-glance liked status without an always-visible button */}
          {isLiked && (
            <div className="shrink-0 mr-1" aria-label="Liked" title="Liked">
              <Heart size={14} fill={accentColor} style={{ color: accentColor }} />
            </div>
          )}

          {/* Play count badge */}
          {showPlayCount && (song.playCount ?? 0) > 0 && (
            <div className="shrink-0 mr-1 flex items-center gap-1 px-2 py-0.5 rounded-full"
              style={{ background: `${accentColor}18` }}>
              <Repeat size={11} style={{ color: accentColor }} />
              <span className="text-[11px] font-semibold tabular-nums" style={{ color: accentColor }}>{song.playCount}</span>
            </div>
          )}

          {/* Actions — Play is the primary action (the whole row / index-hover play icon above); everything
              secondary (Like, Add to Playlist, Edit album art, Delete) lives in this one overflow menu. */}
          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              ref={menuButtonRef}
              onClick={openMenuFromButton}
              aria-haspopup="menu"
              aria-expanded={!!trackMenu}
              aria-label={`More actions for ${song.title}`}
              title="More options"
              // FIX (three-dot menu always visible): this used to be
              // `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100
              // focus:opacity-100`, which hid the button until the row was
              // hovered/focused/tapped. Dropping the opacity-0 base state makes
              // it always visible; tap-to-play and swipe-to-queue are untouched
              // since this button already stops click propagation separately.
              className="btn-icon w-7 h-7 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 transition-opacity"
            >
              <MoreVertical size={15} className="text-white/60" />
            </button>
          </div>
        </div>
      </div>

      {trackMenu && (
        <TrackMenu
          x={trackMenu.x} y={trackMenu.y}
          song={song} playlists={playlists} isLiked={isLiked} isPinned={isPinned} accentColor={accentColor}
          onClose={() => setTrackMenu(null)}
          onLike={onLike}
          onPin={onPin}
          onEditArt={onEditArt}
          onAddToPlaylist={onAddToPlaylist}
          onCreatePlaylist={onCreatePlaylist}
          onRemoveFromPlaylist={isInPlaylist ? onRemoveFromPlaylist : undefined}
          onRequestDelete={() => setConfirmDelete(true)}
          onQueue={onQueue}
          onViewQueue={onViewQueue}
          returnFocusRef={trackMenu.keyboardTriggered ? menuButtonRef : undefined}
        />
      )}

      {confirmDelete && (
        <DeleteConfirmDialog song={song} onCancel={() => setConfirmDelete(false)}
          onConfirm={() => { setConfirmDelete(false); onDelete(song); }} />
      )}
    </>
  );
}
