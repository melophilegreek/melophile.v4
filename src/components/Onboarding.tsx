import { useRef, useState } from 'react';
import { Music, FolderOpen, Loader as Loader2 } from 'lucide-react';
import { importFiles, type ImportProgress } from '../lib/scanner';
import { getContrastText } from '../lib/color';

interface Props {
  accentColor: string;
  onComplete: () => void;
}

export function Onboarding({ accentColor, onComplete }: Props) {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [done, setDone] = useState<{ added: number; skipped: number } | null>(null);

  const handleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setDone(null);
    setProgress({ current: 0, total: files.length, fileName: '' });
    const result = await importFiles(Array.from(files), setProgress);
    setProgress(null);
    setDone(result);
    e.target.value = '';
    if (result.added > 0) setTimeout(() => onComplete(), 1200);
  };

  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-[#121212] px-6">
      <div className="w-full max-w-md text-center animate-fade-in">
        <img src={`${import.meta.env.BASE_URL}icons/logo-transparent.png`} alt="Melophile"
          className="w-24 h-24 mx-auto mb-6 drop-shadow-[0_0_36px_rgba(37,99,235,0.4)]" />
        <h1 className="text-3xl font-bold text-white mb-2">Melophile</h1>
        <p className="text-white/45 mb-10">Your personal offline music player</p>

        <input ref={folderInputRef} type="file"
          // @ts-expect-error — webkitdirectory is non-standard but widely supported
          webkitdirectory="" directory="" multiple accept="audio/*"
          className="hidden" onChange={handleFiles} />
        <input ref={fileInputRef} type="file" multiple accept="audio/*" className="hidden" onChange={handleFiles} />

        {progress ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={32} className="animate-spin" style={{ color: accentColor }} />
            <p className="text-white/60 text-sm">
              {progress.finalizing ? `Saving ${progress.current} / ${progress.total}…` : (
                <>
                  Importing {progress.current} / {progress.total}
                  {progress.fileName && <span className="text-white/35"> — {progress.fileName}</span>}
                </>
              )}
            </p>
            <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-200"
                style={{ width: `${(progress.current / Math.max(progress.total, 1)) * 100}%`, background: accentColor }} />
            </div>
          </div>
        ) : done ? (
          <div className="animate-fade-in space-y-4">
            {done.added > 0 ? (
              <div className="rounded-xl p-4 border" style={{ background: `${accentColor}15`, borderColor: `${accentColor}40` }}>
                <p className="font-semibold" style={{ color: accentColor }}>
                  Added {done.added} song{done.added !== 1 ? 's' : ''}
                  {/* `skipped` now only reflects genuine per-file import errors --
                      duplicates are always imported, never skipped. */}
                  {done.skipped > 0 && `, ${done.skipped} file${done.skipped !== 1 ? 's' : ''} could not be imported`}
                </p>
                <p className="text-white/35 text-xs mt-1">Opening your library…</p>
              </div>
            ) : (
              <div className="bg-yellow-500/10 border border-yellow-500/25 rounded-xl p-4">
                <p className="text-yellow-400 font-medium">No new audio files found</p>
              </div>
            )}
            <button onClick={() => folderInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 font-bold py-4 rounded-full transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ background: accentColor, color: getContrastText(accentColor) }}>
              <FolderOpen size={20} /> Import another folder
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <button onClick={() => folderInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 font-bold py-4 rounded-full transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ background: accentColor, color: getContrastText(accentColor) }}>
              <FolderOpen size={20} /> Import music folder
            </button>
            <button onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 font-medium py-3 rounded-full bg-white/5 hover:bg-white/10 text-white/70 transition-colors text-sm">
              <Music size={18} /> Select individual files
            </button>
          </div>
        )}
        <p className="text-white/20 text-xs mt-6">Music never leaves your device · Everything stays offline</p>
      </div>
    </div>
  );
}
