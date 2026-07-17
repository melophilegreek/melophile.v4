import { useEffect, useRef } from 'react';
import { X, Upload, Trash2 } from 'lucide-react';
import type { Song } from '../types';
import { updateSongArt } from '../lib/db';

interface Props {
  song: Song;
  accentColor: string;
  onClose: () => void;
  onUpdated: (updated: Song) => void;
}

export function AlbumArtEditModal({ song, accentColor, onClose, onUpdated }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const mime = file.type || 'image/jpeg';
    await updateSongArt(song.id, buf, mime);
    onUpdated({ ...song, albumArtData: buf, albumArtMime: mime });
    onClose();
  };

  const handleRemove = async () => {
    await updateSongArt(song.id, undefined, undefined);
    onUpdated({ ...song, albumArtData: undefined, albumArtMime: undefined });
    onClose();
  };

  return (
    <div ref={overlayRef} className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
      onMouseDown={(e) => { if (e.target === overlayRef.current) onClose(); }}>
      <div className="w-72 rounded-2xl p-5 shadow-2xl animate-slide-up"
        style={{ background: 'rgba(28,28,28,0.97)', backdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-bold">Edit Album Art</h3>
          <button onClick={onClose} className="btn-icon w-7 h-7 hover:bg-white/10 rounded-full">
            <X size={16} className="text-white/50" />
          </button>
        </div>
        <p className="text-white/40 text-xs mb-4 truncate">{song.title}</p>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
        <div className="space-y-2">
          <button onClick={() => inputRef.current?.click()}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white transition-colors">
            <Upload size={16} style={{ color: accentColor }} /> <span className="text-sm font-medium">Upload new art</span>
          </button>
          {song.albumArtData && (
            <button onClick={handleRemove}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 hover:bg-red-500/15 text-white hover:text-red-400 transition-colors">
              <Trash2 size={16} /> <span className="text-sm font-medium">Remove art</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
