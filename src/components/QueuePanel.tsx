import { useState, useRef } from 'react';
import { X, Trash2, Play, ListMusic, ChevronUp, ChevronDown, GripVertical } from 'lucide-react';
import type { Song } from '../types';
import { getArtUrl, useAlbumArtError } from './SongRow';
import { initialFor, placeholderBackground } from '../lib/artPlaceholder';

interface Props {
  queue: Song[];
  userQueueLen: number;
  currentSong: Song | null;
  accentColor: string;
  onClose: () => void;
  // BUG FIX (duplicates in queue): both callbacks now take the row's index
  // within `queue` rather than the song's id. When the same song is queued
  // more than once, every copy shares an id, so id-based lookups could only
  // ever act on "a" matching entry (or all of them) — never the specific one
  // the person clicked. Index addresses exactly one row.
  onPlayFromQueue: (song: Song, index: number) => void;
  onRemoveFromQueue: (index: number) => void;
  onReorderQueue: (from: number, to: number) => void;
  onClearQueue: () => void;
}

export function QueuePanel({ queue, userQueueLen, currentSong, accentColor, onClose, onPlayFromQueue, onRemoveFromQueue, onReorderQueue, onClearQueue }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div ref={ref} className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2">
          <ListMusic size={20} style={{ color: accentColor }} />
          <h2 className="text-white font-bold text-lg">Queue</h2>
          {queue.length > 0 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: `${accentColor}25`, color: accentColor }}>{queue.length}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {queue.length > 0 && (
            <button onClick={onClearQueue} className="btn-icon w-8 h-8 hover:bg-red-500/15 rounded-lg" title="Clear queue">
              <Trash2 size={16} className="text-red-400/70 hover:text-red-400" />
            </button>
          )}
          <button onClick={onClose} className="btn-icon w-8 h-8 hover:bg-white/10 rounded-lg">
            <X size={18} className="text-white/60" />
          </button>
        </div>
      </div>

      {/* Now playing */}
      {currentSong && (
        <div className="px-4 py-3 shrink-0">
          <p className="text-xs text-white/30 uppercase tracking-wider font-semibold mb-2">Now Playing</p>
          <QueueRow song={currentSong} isCurrent accentColor={accentColor} onPlay={() => {}} />
        </div>
      )}

      {/* Queue list */}
      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-white/25">
            <ListMusic size={40} className="mb-3 text-white/15" />
            <p className="font-medium">Queue is empty</p>
            <p className="text-xs mt-1">Swipe a song right to queue it</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-white/30 uppercase tracking-wider font-semibold mb-2 mt-2">Next Up</p>
            {queue.map((song, i) => {
              const isUserQueued = i < userQueueLen;
              return (
              <QueueRow
                key={`${song.id}-${i}`}
                song={song}
                accentColor={accentColor}
                onPlay={() => onPlayFromQueue(song, i)}
                onRemove={isUserQueued ? () => onRemoveFromQueue(i) : undefined}
                onMoveUp={isUserQueued && i > 0 ? () => onReorderQueue(i, i - 1) : undefined}
                onMoveDown={isUserQueued && i < userQueueLen - 1 ? () => onReorderQueue(i, i + 1) : undefined}
                index={i + 1}
                isAutoQueued={!isUserQueued}
              />
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function QueueRow({ song, isCurrent, accentColor, onPlay, onRemove, onMoveUp, onMoveDown, index, isAutoQueued }: {
  song: Song; isCurrent?: boolean; accentColor: string;
  onPlay: () => void; onRemove?: () => void;
  onMoveUp?: () => void; onMoveDown?: () => void;
  index?: number; isAutoQueued?: boolean;
}) {
  const artUrl = getArtUrl(song);
  const { showArt, onError: onArtError } = useAlbumArtError(song, artUrl);
  const [dragX, setDragX] = useState(0);
  const startX = useRef(0);
  const startY = useRef(0);
  const dragging = useRef(false);

  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    dragging.current = true;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!dragging.current) return;
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;
    if (Math.abs(dy) > Math.abs(dx)) { dragging.current = false; return; }
    if (dx < 0) { e.preventDefault(); setDragX(Math.max(dx, -80)); }
  };

  const onTouchEnd = () => {
    if (dragX < -40 && onRemove) { onRemove(); }
    setDragX(0); dragging.current = false;
  };

  return (
    <div className="relative overflow-hidden rounded-lg">
      {/* Remove background (swipe left) */}
      {onRemove && (
        <div className="absolute inset-0 flex items-center justify-end px-4"
          style={{ background: 'rgba(231,76,60,0.15)', opacity: dragX < -10 ? 1 : 0, transition: 'opacity 0.15s' }}>
          <Trash2 size={18} className="text-red-400" />
        </div>
      )}

      <div
        className="group flex items-center gap-2 py-2 rounded-lg cursor-pointer hover:bg-white/5 transition-colors px-2 -mx-2"
        style={{ transform: `translateX(${dragX}px)`, transition: dragging.current ? 'none' : 'transform 0.3s cubic-bezier(0.16,1,0.3,1)' }}
        onClick={onPlay}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Drag handle / index */}
        <div className="w-5 shrink-0 flex items-center justify-center">
          {index !== undefined && !isCurrent && !isAutoQueued && (
            <GripVertical size={14} className="text-white/20 group-hover:text-white/40 transition-colors" />
          )}
        </div>

        <div className="w-9 h-9 rounded-md shrink-0 overflow-hidden flex items-center justify-center" style={{ background: placeholderBackground(accentColor) }}>
          {showArt ? <img src={artUrl!} alt="" className="w-full h-full object-cover" onError={onArtError} /> : <span className="text-[11px] font-semibold" style={{ color: accentColor }}>{initialFor(song)}</span>}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: isCurrent ? accentColor : 'rgba(255,255,255,0.9)' }}>
            {song.title}
          </p>
          <p className="text-xs text-white/40 truncate">{song.artist}</p>
        </div>

        {/* Reorder buttons */}
        {!isCurrent && (onMoveUp || onMoveDown) && (
          <div className="flex flex-col shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {onMoveUp && (
              <button onClick={(e) => { e.stopPropagation(); onMoveUp(); }} className="w-5 h-4 flex items-center justify-center text-white/40 hover:text-white">
                <ChevronUp size={12} />
              </button>
            )}
            {onMoveDown && (
              <button onClick={(e) => { e.stopPropagation(); onMoveDown(); }} className="w-5 h-4 flex items-center justify-center text-white/40 hover:text-white">
                <ChevronDown size={12} />
              </button>
            )}
          </div>
        )}

        {isCurrent && <Play size={14} fill={accentColor} style={{ color: accentColor }} className="shrink-0" />}

        {/* Remove button */}
        {onRemove && !isCurrent && (
          <button onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="btn-icon w-7 h-7 hover:bg-red-500/15 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <X size={14} className="text-red-400/70 hover:text-red-400" />
          </button>
        )}
      </div>
    </div>
  );
}
