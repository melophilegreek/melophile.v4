import { useEffect, useRef, useState } from 'react';
import { X, Check, Heart, Trash2, AlertTriangle, Sparkles, ImagePlus } from 'lucide-react';
import type { ArtRescanProgress } from '../lib/scanner';
import { getContrastText } from '../lib/color';

const PRESETS = [
  { name: 'Green', color: '#1DB954' }, { name: 'Purple', color: '#9B59B6' },
  { name: 'Blue', color: '#3498DB' }, { name: 'Red', color: '#E74C3C' },
  { name: 'Orange', color: '#E67E22' }, { name: 'Pink', color: '#FF6B9D' },
  { name: 'Teal', color: '#1ABC9C' }, { name: 'Gold', color: '#F1C40F' },
];

// Extra jewel-tone / metallic palette, kept separate from PRESETS above so
// the original 8 colors are untouched — just an additional row of options.
const PREMIUM_PRESETS = [
  { name: 'Rose Gold', color: '#E0A899' }, { name: 'Platinum', color: '#D4D8DD' },
  { name: 'Champagne', color: '#E6C79C' }, { name: 'Sapphire', color: '#2C5FCC' },
  { name: 'Emerald', color: '#0E9F6E' }, { name: 'Amethyst', color: '#A855F7' },
  { name: 'Ruby', color: '#E11D48' }, { name: 'Bronze', color: '#C08552' },
];

interface Props {
  accentColor: string;
  onAccentChange: (color: string) => void;
  onClose: () => void;
  /** Current library size — used to disable the delete-all action and
   *  word the confirmation dialog (e.g. "Delete 850 songs?"). */
  songCount: number;
  onDeleteAllSongs: () => void | Promise<void>;
  /** Re-scans every song's album art against its already-stored audio blob
   *  (see scanner.ts's rescanMissingArt for why this is needed). */
  onRescanArt: () => void | Promise<void>;
  /** Live progress while a rescan is running; null when idle. */
  artRescan: (ArtRescanProgress & { running: boolean }) | null;
}

export function SettingsPanel({ accentColor, onAccentChange, onClose, songCount, onDeleteAllSongs, onRescanArt, artRescan }: Props) {
  const [hexInput, setHexInput] = useState(accentColor);
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setHexInput(accentColor); }, [accentColor]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (confirmingDeleteAll) { setConfirmingDeleteAll(false); return; }
      onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, confirmingDeleteAll]);

  const handleConfirmDeleteAll = async () => {
    setDeleting(true);
    try {
      await onDeleteAllSongs();
      setConfirmingDeleteAll(false);
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  const applyHex = (val: string) => {
    const n = val.startsWith('#') ? val : `#${val}`;
    if (/^#[0-9a-fA-F]{6}$/.test(n)) onAccentChange(n);
  };

  return (
    <div ref={overlayRef} className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
      onMouseDown={(e) => { if (e.target === overlayRef.current) onClose(); }}>
      <div className="w-full max-w-sm max-h-[85vh] overflow-y-auto rounded-2xl p-6 shadow-2xl animate-slide-up"
        style={{ background: 'rgba(28,28,28,0.95)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-bold text-xl">Settings</h2>
          <button onClick={onClose} className="btn-icon w-8 h-8 hover:bg-white/10 rounded-full">
            <X size={18} className="text-white/60" />
          </button>
        </div>

        <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-3">Accent Color</h3>
        <div className="grid grid-cols-4 gap-2 mb-4">
          {PRESETS.map((p) => {
            const active = accentColor.toLowerCase() === p.color.toLowerCase();
            return (
              <button key={p.color} onClick={() => { onAccentChange(p.color); setHexInput(p.color); }}
                className="relative h-10 rounded-xl flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
                style={{ background: p.color, boxShadow: active ? `0 0 0 2px white, 0 0 0 4px ${p.color}` : 'none' }} title={p.name}>
                {active && <Check size={16} strokeWidth={3} style={{ color: getContrastText(p.color) }} />}
              </button>
            );
          })}
        </div>

        <h3 className="flex items-center gap-1.5 text-amber-300/70 text-xs font-semibold uppercase tracking-wider mb-3">
          <Sparkles size={12} /> Premium
        </h3>
        <div className="grid grid-cols-4 gap-2 mb-4">
          {PREMIUM_PRESETS.map((p) => {
            const active = accentColor.toLowerCase() === p.color.toLowerCase();
            return (
              <button key={p.color} onClick={() => { onAccentChange(p.color); setHexInput(p.color); }}
                className="relative h-10 rounded-xl flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
                style={{
                  background: `linear-gradient(135deg, ${p.color}, ${p.color}cc)`,
                  boxShadow: active
                    ? `0 0 0 2px white, 0 0 0 4px ${p.color}, 0 0 12px ${p.color}80`
                    : `0 0 8px ${p.color}40`,
                }}
                title={p.name}>
                {active && <Check size={16} strokeWidth={3} style={{ color: getContrastText(p.color) }} />}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <input type="text" value={hexInput} onChange={(e) => setHexInput(e.target.value)}
            onBlur={(e) => applyHex(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applyHex(hexInput); }}
            placeholder="#2C5FCC"
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm font-mono focus:outline-none focus:border-white/25 transition-colors" />
          <div className="relative w-10 h-10 rounded-xl overflow-hidden border border-white/20 cursor-pointer" style={{ background: accentColor }}>
            <input type="color" value={accentColor} onChange={(e) => { onAccentChange(e.target.value); setHexInput(e.target.value); }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
          </div>
        </div>

        <div className="mt-4 p-3 rounded-xl bg-white/5 border border-white/5">
          <p className="text-white/40 text-xs mb-2">Preview</p>
          <div className="flex items-center gap-3">
            <div className="w-2 h-6 rounded-full" style={{ background: accentColor }} />
            <div className="flex-1 h-1.5 rounded-full bg-white/10">
              <div className="w-2/3 h-full rounded-full" style={{ background: accentColor }} />
            </div>
            <Heart size={16} fill={accentColor} style={{ color: accentColor }} />
          </div>
        </div>

        <button onClick={onClose} className="w-full mt-5 py-3 rounded-xl font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
          style={{ background: accentColor, color: getContrastText(accentColor) }}>Done</button>

        <div className="mt-5 pt-4 border-t border-white/10">
          <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-3">Library</h3>
          <button
            onClick={onRescanArt}
            disabled={!!artRescan?.running || songCount === 0}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-white/10 text-white/70 text-sm font-medium transition-colors hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <ImagePlus size={15} />
            {artRescan?.running
              ? `Scanning… ${artRescan.current} / ${artRescan.total}${artRescan.found > 0 ? ` (found ${artRescan.found})` : ''}`
              : 'Fix missing album art'}
          </button>
          <p className="text-white/30 text-xs mt-2 leading-snug">
            Re-checks every song's embedded cover art against past parsing
            bugs (including corrupted art that looked "missing" but wasn't
            actually empty) and fixes any it finds. Scans your whole library,
            so it can take a bit for large collections. Songs whose files
            never had art won't be affected.
          </p>
        </div>

        {/* Danger Zone: bulk-delete the entire library. Kept visually
            separated (border + red accents) from the accent-color settings
            above so it doesn't get clicked by accident. */}
        <div className="mt-5 pt-4 border-t border-white/10">
          <h3 className="text-red-400/80 text-xs font-semibold uppercase tracking-wider mb-3">Danger Zone</h3>
          <button
            onClick={() => setConfirmingDeleteAll(true)}
            disabled={songCount === 0}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-red-500/30 text-red-400 text-sm font-medium transition-colors hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <Trash2 size={15} />
            Delete all songs{songCount > 0 ? ` (${songCount})` : ''}
          </button>
        </div>
      </div>

      {confirmingDeleteAll && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
          onMouseDown={(e) => { if (e.currentTarget === e.target && !deleting) setConfirmingDeleteAll(false); }}>
          <div className="w-full max-w-sm rounded-2xl p-6 shadow-2xl animate-slide-up"
            style={{ background: 'rgba(28,28,28,0.97)', backdropFilter: 'blur(20px)', border: '1px solid rgba(239,68,68,0.25)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
            <div className="flex items-center gap-2.5 mb-2">
              <AlertTriangle size={18} className="text-red-400 shrink-0" />
              <h3 className="text-white font-bold text-lg">Delete all songs?</h3>
            </div>
            <p className="text-white/50 text-sm mb-5 leading-snug">
              <span className="text-white/80 font-medium">All {songCount} song{songCount === 1 ? '' : 's'}</span> in
              your library will be permanently removed, along with liked status and playlist entries. This can't be undone.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmingDeleteAll(false)} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/70 text-sm transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleConfirmDeleteAll} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl bg-red-500/90 hover:bg-red-500 text-white font-semibold text-sm transition-colors disabled:opacity-70">
                {deleting ? 'Deleting…' : 'Delete all'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
