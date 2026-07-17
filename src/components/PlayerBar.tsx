import { useState, useRef, useCallback, useEffect, useId } from 'react';
import {
  Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Shuffle, Repeat, Repeat1, Music, Library, ListMusic,
} from 'lucide-react';
import type { RepeatMode, ShuffleMode, Song } from '../types';
import { initialFor, placeholderBackground } from '../lib/artPlaceholder';
import { getContrastText } from '../lib/color';

function formatTime(s: number): string {
  if (!s || !isFinite(s) || s <= 0) return '0:00';
  const m = Math.floor(s / 60); const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function gradientFor(title: string): string {
  const h = (title.charCodeAt(0) * 37 + (title.charCodeAt(1) || 0) * 17) % 360;
  return `linear-gradient(135deg, hsl(${h},45%,22%), hsl(${(h+50)%360},35%,12%))`;
}

// FIX 3 (LONG SONG NAMES): replaces the plain `truncate` <p> for the song
// title. Measures whether the text actually overflows its container; if it
// doesn't, it renders perfectly static (no ellipsis, no animation). If it
// does, it scrolls right-to-left just far enough to reveal the clipped end,
// holds there for ~2s, then snaps back to the start and repeats — instead
// of the old behavior of silently cutting the title off with `truncate`.
function MarqueeText({ text, className }: { text: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflowPx, setOverflowPx] = useState(0);
  const animId = useId().replace(/[:]/g, '');

  useEffect(() => {
    const measure = () => {
      const container = containerRef.current;
      const span = textRef.current;
      if (!container || !span) return;
      const diff = span.scrollWidth - container.clientWidth;
      setOverflowPx(diff > 1 ? diff : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);

    // BUG FIX: index.css loads Inter with `display=swap`, so on first paint
    // the title renders in the fallback font, gets measured, and THEN Inter
    // swaps in (wider, 600-weight). That swap changes the span's scrollWidth
    // but never resizes the container, so the ResizeObserver above never
    // fires and `overflowPx` stays stuck at the stale fallback-font value —
    // this is what produced the permanently clipped, never-scrolling title.
    // Re-measure once real fonts are ready to catch that swap.
    if (typeof document !== 'undefined' && 'fonts' in document) {
      document.fonts.ready.then(measure).catch(() => {});
    }

    return () => ro.disconnect();
  }, [text]);

  const overflowing = overflowPx > 0;

  // Constant scroll speed (~35px/s) so long titles don't rush by, plus a
  // fixed ~2s pause at the start before the loop restarts. Percent
  // breakpoints below are derived from these durations for THIS instance.
  const scrollSec = overflowing ? Math.max(overflowPx / 35, 1.5) : 0;
  const pauseSec = 2;
  const snapSec = 0.05; // near-instant reset back to the start
  const totalSec = scrollSec + pauseSec + snapSec;
  const scrollEndPct = (scrollSec / totalSec) * 100;
  const pauseEndPct = ((scrollSec + pauseSec) / totalSec) * 100;

  return (
    <div ref={containerRef} className={`overflow-hidden whitespace-nowrap ${className ?? ''}`}>
      {overflowing && (
        <style>{`
          @keyframes ${animId} {
            0% { transform: translateX(0); }
            ${scrollEndPct}% { transform: translateX(-${overflowPx}px); }
            ${pauseEndPct}% { transform: translateX(-${overflowPx}px); }
            100% { transform: translateX(0); }
          }
        `}</style>
      )}
      <span
        ref={textRef}
        className="inline-block"
        style={overflowing ? { animation: `${animId} ${totalSec}s linear infinite` } : undefined}
      >
        {text}
      </span>
    </div>
  );
}

interface Props {
  currentSong: Song | null;
  artUrl: string | null;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffleMode: ShuffleMode;
  repeat: RepeatMode;
  accentColor: string;
  queueCount: number;
  onPrev: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  onSeek: (t: number) => void;
  onVolume: (v: number) => void;
  onMute: () => void;
  onShuffleToggle: () => void;
  onShuffleModeChange: (mode: ShuffleMode) => void;
  onRepeat: () => void;
  onOpenQueue: () => void;
}

export function PlayerBar({
  currentSong, artUrl, isPlaying, isLoading,
  currentTime, duration, volume, muted, shuffleMode, repeat, accentColor, queueCount,
  onPrev, onNext, onTogglePlay, onSeek, onVolume, onMute,
  onShuffleToggle, onShuffleModeChange, onRepeat, onOpenQueue,
}: Props) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bg = currentSong ? gradientFor(currentSong.title) : 'linear-gradient(135deg,#1a1a1a,#0d0d0d)';
  const [showShuffleMenu, setShowShuffleMenu] = useState(false);
  const shuffleRef = useRef<HTMLDivElement>(null);
  // Play/pause icons and the queue-count badge sit on an accentColor
  // background -- pick black or white per the *current* accent instead of
  // assuming black works (it doesn't for darker accents like blue/purple).
  const onAccent = getContrastText(accentColor);

  // BUG FIX (broken album art): `artUrl` being non-null only means we *tried*
  // to build an object URL for the art — it doesn't guarantee the browser can
  // actually decode it (corrupt/truncated art bytes, an unsupported image
  // format, etc). Previously there was no <img onError>, so a bad artUrl just
  // rendered the browser's broken-image icon with nothing in the console to
  // explain why. Track failures per artUrl and fall back to the placeholder
  // note icon everywhere this art is shown (background blur + both
  // thumbnails), and log a descriptive warning so it's diagnosable.
  const [artFailed, setArtFailed] = useState(false);
  useEffect(() => { setArtFailed(false); }, [artUrl]);
  const showArt = !!artUrl && !artFailed;
  const handleArtError = () => {
    if (artFailed) return;
    console.warn(
      `[PlayerBar] Album art failed to load for "${currentSong?.title ?? 'unknown track'}"` +
      (currentSong?.artist ? ` by ${currentSong.artist}` : '') +
      ` (mime: ${currentSong?.albumArtMime ?? 'unknown'}). Falling back to placeholder icon.`,
      { songId: currentSong?.id, fileName: currentSong?.fileName, artUrl },
    );
    setArtFailed(true);
  };

  useEffect(() => {
    if (!showShuffleMenu) return;
    const handler = (e: MouseEvent) => {
      if (shuffleRef.current && !shuffleRef.current.contains(e.target as Node)) setShowShuffleMenu(false);
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [showShuffleMenu]);

  const shuffleActive = shuffleMode !== 'off';

  return (
    <div className="relative h-full overflow-hidden rounded-xl">
      {/* Blurred background */}
      <div className="absolute inset-0 transition-all duration-700" style={{ background: bg }}>
        {showArt && (
          <img src={artUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-25 scale-110 transition-all duration-700"
            style={{ filter: 'blur(24px)' }} onError={handleArtError} />
        )}
      </div>
      <div className="absolute inset-0 bg-black/55" />

      {/* ── MOBILE LAYOUT (<768px) ── */}
      {/* Taller 3-row "expanded" layout: art+title row, transport-controls
          row, and a full seek row with time labels — matches the target
          design. Requires the taller parent height set in App.tsx
          (h-[180px] md:h-[68px]) instead of the old fixed 68px on both
          breakpoints. */}
      <div className="md:hidden relative h-full flex flex-col justify-center gap-4 px-4 py-4">
        {/* ALIGNMENT FIX: art + title/artist are left-aligned (not centered)
            — flex row starting at the container's left edge. */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-xl shrink-0 overflow-hidden flex items-center justify-center"
            style={{ background: currentSong ? placeholderBackground(accentColor) : '#282828' }}>
            {showArt ? <img src={artUrl} alt="" className="w-full h-full object-cover" onError={handleArtError} />
              : currentSong ? <span className="text-sm font-semibold" style={{ color: accentColor }}>{initialFor(currentSong)}</span>
              : <Music size={18} className="text-white/20" />}
          </div>
          <div className="min-w-0 flex-1">
            {currentSong ? (
              <>
                {/* LONG SONG NAMES FIX: MarqueeText only animates when the
                    title actually overflows its box; otherwise it stays
                    static, no ellipsis, no clipping. */}
                <MarqueeText text={currentSong.title} className="text-white text-base font-semibold leading-tight" />
                <p className="text-white/50 text-sm truncate mt-0.5 leading-tight">{currentSong.artist}</p>
              </>
            ) : <p className="text-white/25 text-sm">Nothing playing</p>}
          </div>
        </div>

        {/* Transport controls — shuffle on the left, prev/play/next centered
            as their own group. Grid with equal side columns keeps the
            prev/play/next group genuinely centered on the bar regardless of
            the shuffle button's width. */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center">
          <div ref={shuffleRef} className="relative justify-self-start">
            <button onClick={onShuffleToggle} onContextMenu={(e) => { e.preventDefault(); setShowShuffleMenu(true); }}
              className="w-9 h-9 flex items-center justify-center" title="Shuffle">
              <Shuffle size={19} style={{ color: shuffleActive ? accentColor : 'rgba(255,255,255,0.45)' }} />
            </button>
            {shuffleActive && <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full" style={{ background: accentColor }} />}
            {showShuffleMenu && (
              <div className="absolute bottom-10 left-0 w-44 rounded-xl overflow-hidden shadow-2xl border border-white/10 z-50 animate-fade-in"
                style={{ background: 'rgba(30,30,30,0.97)', backdropFilter: 'blur(16px)' }}>
                <div className="p-1">
                  {(['off', 'view', 'library'] as ShuffleMode[]).map((mode) => (
                    <button key={mode} onClick={() => { onShuffleModeChange(mode); setShowShuffleMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
                      style={{ background: shuffleMode === mode ? 'rgba(255,255,255,0.1)' : 'transparent', color: shuffleMode === mode ? accentColor : 'rgba(255,255,255,0.75)' }}>
                      {mode === 'off' && <><Shuffle size={13} />Off</>}
                      {mode === 'view' && <><Shuffle size={13} />Shuffle view</>}
                      {mode === 'library' && <><Library size={13} />Shuffle library</>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-5 justify-self-center">
            <button onClick={onPrev} className="w-9 h-9 flex items-center justify-center text-white/70 active:scale-90 transition-transform" title="Previous">
              <SkipBack size={22} fill="currentColor" />
            </button>
            <button onClick={onTogglePlay}
              className="w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-90"
              style={{ background: accentColor }} title="Play/Pause">
              {isLoading ? (
                <div className="w-4 h-4 border-2 rounded-full animate-spin"
                  style={{ borderColor: `${onAccent}33`, borderTopColor: onAccent }} />
              ) : isPlaying ? (
                <Pause size={20} fill={onAccent} style={{ color: onAccent }} />
              ) : (
                <Play size={20} fill={onAccent} className="ml-0.5" style={{ color: onAccent }} />
              )}
            </button>
            <button onClick={onNext} className="w-9 h-9 flex items-center justify-center text-white/70 active:scale-90 transition-transform" title="Next">
              <SkipForward size={22} fill="currentColor" />
            </button>
          </div>

          {/* Empty third column mirrors the shuffle column's width so the
              prev/play/next group above is truly centered. */}
          <div />
        </div>

        {/* Full seek row with time labels on both ends. */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/40 tabular-nums w-9">{formatTime(currentTime)}</span>
          <div
            className="flex-1 h-4 flex items-center cursor-pointer"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration);
            }}
          >
            <div className="w-full h-[3px] rounded-full bg-white/15">
              <div className="h-full rounded-full" style={{ width: `${progress}%`, background: accentColor }} />
            </div>
          </div>
          <span className="text-xs text-white/40 tabular-nums w-9 text-right">{formatTime(duration)}</span>
        </div>
      </div>

      {/* ── DESKTOP LAYOUT (≥768px) ── */}
      <div className="hidden md:flex relative h-full items-center px-4 gap-3">
        {/* FIX 1 (SIZE) + FIX 2 (ALIGNMENT): fixed 48x48 art, row stays
            items-center (vertically centered), title/artist bumped up to
            14px/12px (from 13px/11px) now that the row has the height to
            support it without feeling cramped. */}
        <div className="flex items-center gap-3 w-[28%] min-w-0 shrink-0">
          <div className="w-12 h-12 rounded-lg shrink-0 overflow-hidden flex items-center justify-center"
            style={{ background: currentSong ? placeholderBackground(accentColor) : '#282828' }}>
            {showArt ? <img src={artUrl} alt="" className="w-full h-full object-cover" onError={handleArtError} />
              : currentSong ? <span className="text-sm font-semibold" style={{ color: accentColor }}>{initialFor(currentSong)}</span>
              : <Music size={18} className="text-white/20" />}
          </div>
          <div className="min-w-0">
            {currentSong ? (
              <>
                {/* FIX 3 (LONG SONG NAMES): MarqueeText replaces the plain
                    truncating <p> — only animates when the title overflows. */}
                <MarqueeText text={currentSong.title} className="text-white text-sm font-semibold leading-tight" />
                <p className="text-white/45 text-xs truncate mt-0.5 leading-tight">{currentSong.artist}</p>
              </>
            ) : <p className="text-white/25 text-sm">Nothing playing</p>}
          </div>
        </div>

        {/* Center controls */}
        <div className="flex flex-col items-center justify-center gap-1 flex-1 max-w-[520px]">
          <div className="flex items-center justify-center gap-2">
            <div ref={shuffleRef} className="relative">
              <button onClick={onShuffleToggle} onContextMenu={(e) => { e.preventDefault(); setShowShuffleMenu(true); }}
                className="btn-icon w-7 h-7 hover:bg-white/10 rounded-lg" title="Shuffle">
                <Shuffle size={15} style={{ color: shuffleActive ? accentColor : 'rgba(255,255,255,0.45)' }} />
              </button>
              {shuffleActive && <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full" style={{ background: accentColor }} />}
              {showShuffleMenu && (
                <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-44 rounded-xl overflow-hidden shadow-2xl border border-white/10 z-50 animate-fade-in"
                  style={{ background: 'rgba(30,30,30,0.97)', backdropFilter: 'blur(16px)' }}>
                  <div className="p-1">
                    {(['off', 'view', 'library'] as ShuffleMode[]).map((mode) => (
                      <button key={mode} onClick={() => { onShuffleModeChange(mode); setShowShuffleMenu(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
                        style={{ background: shuffleMode === mode ? 'rgba(255,255,255,0.1)' : 'transparent', color: shuffleMode === mode ? accentColor : 'rgba(255,255,255,0.75)' }}>
                        {mode === 'off' && <><Shuffle size={13} />Off</>}
                        {mode === 'view' && <><Shuffle size={13} />Shuffle view</>}
                        {mode === 'library' && <><Library size={13} />Shuffle library</>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button onClick={onPrev} className="btn-icon w-8 h-8 text-white/65 hover:text-white" title="Previous">
              <SkipBack size={18} fill="currentColor" />
            </button>
            <button onClick={onTogglePlay}
              className="w-9 h-9 rounded-full flex items-center justify-center transition-all hover:scale-105 active:scale-95"
              style={{ background: accentColor }} title="Play/Pause">
              {isLoading ? (
                <div className="w-3.5 h-3.5 border-2 rounded-full animate-spin"
                  style={{ borderColor: `${onAccent}33`, borderTopColor: onAccent }} />
              ) : isPlaying ? (
                <Pause size={18} fill={onAccent} style={{ color: onAccent }} />
              ) : (
                <Play size={18} fill={onAccent} className="ml-0.5" style={{ color: onAccent }} />
              )}
            </button>
            <button onClick={onNext} className="btn-icon w-8 h-8 text-white/65 hover:text-white" title="Next">
              <SkipForward size={18} fill="currentColor" />
            </button>

            <button onClick={onRepeat} className="btn-icon w-7 h-7 hover:bg-white/10 rounded-lg relative" title="Repeat">
              {repeat === 'one' ? <Repeat1 size={15} style={{ color: accentColor }} /> : <Repeat size={15} style={{ color: repeat !== 'off' ? accentColor : 'rgba(255,255,255,0.45)' }} />}
              {repeat !== 'off' && <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full" style={{ background: accentColor }} />}
            </button>
          </div>

          <div className="flex items-center gap-2 w-full max-w-md">
            <span className="text-[10px] text-white/35 tabular-nums w-8 text-right">{formatTime(currentTime)}</span>
            <SeekBar progress={progress} duration={duration} accentColor={accentColor} onSeek={onSeek} />
            <span className="text-[10px] text-white/35 tabular-nums w-8">{formatTime(duration)}</span>
          </div>
        </div>

        {/* Right: queue + volume */}
        <div className="flex items-center gap-2 w-[28%] justify-end shrink-0">
          <button onClick={onOpenQueue} className="btn-icon w-8 h-8 hover:bg-white/10 rounded-lg relative" title="Queue">
            <ListMusic size={17} style={{ color: queueCount > 0 ? accentColor : 'rgba(255,255,255,0.45)' }} />
            {queueCount > 0 && (
              <span className="absolute -top-1 -right-1 text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full"
                style={{ background: accentColor, color: onAccent }}>{queueCount > 9 ? '9+' : queueCount}</span>
            )}
          </button>
          <button onClick={onMute} className="btn-icon w-8 h-8 text-white/45 hover:text-white">
            {muted || volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </button>
          <div className="relative w-24 h-1.5 rounded-full bg-white/15 cursor-pointer"
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onVolume(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))); }}>
            <div className="absolute h-full rounded-full transition-all" style={{ width: `${(muted ? 0 : volume) * 100}%`, background: accentColor }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SeekBar({ progress, duration, accentColor, onSeek }: {
  progress: number; duration: number; accentColor: string; onSeek: (t: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState(false);
  const pct = drag ?? progress;

  const calc = useCallback((clientX: number) => {
    const el = barRef.current; if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100));
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    const p = calc(e.clientX); setDrag(p);
    const move = (ev: MouseEvent) => setDrag(calc(ev.clientX));
    const up = (ev: MouseEvent) => {
      onSeek((calc(ev.clientX) / 100) * duration);
      setDrag(null);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  // TASK 4 (mobile seek support): the bar previously only listened for mouse
  // events, so dragging to seek didn't work at all on touch devices — tapping
  // was the only option. Mirrors onMouseDown's drag-then-commit-on-release
  // behavior using touch events instead.
  const onTouchStart = (e: React.TouchEvent) => {
    const p = calc(e.touches[0].clientX); setDrag(p);
    const move = (ev: TouchEvent) => { ev.preventDefault(); setDrag(calc(ev.touches[0].clientX)); };
    const end = (ev: TouchEvent) => {
      const t = ev.changedTouches[0];
      onSeek((calc(t.clientX) / 100) * duration);
      setDrag(null);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
    };
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end);
  };

  const showThumb = hover || drag !== null;
  const dragging = drag !== null;

  return (
    <div ref={barRef} className="flex-1 h-4 flex items-center cursor-pointer"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onMouseDown={onMouseDown} onTouchStart={onTouchStart}>
      <div className="w-full h-[3px] rounded-full bg-white/15 relative">
        {/* Width transitions smoothly except while actively dragging, where it
            needs to track the pointer/finger instantly with no lag (Task 4). */}
        <div className="absolute h-full rounded-full" style={{ width: `${pct}%`, background: showThumb ? accentColor : 'rgba(255,255,255,0.6)', transition: dragging ? 'none' : 'width 200ms ease, background-color 150ms ease' }} />
        {showThumb && (
          <div className="absolute w-3 h-3 rounded-full bg-white shadow-md -top-[4.5px]" style={{ left: `calc(${pct}% - 6px)`, transition: dragging ? 'none' : 'left 200ms ease' }} />
        )}
      </div>
    </div>
  );
}
