import { useState } from 'react';
import { Music, Heart, ListMusic, Plus, Settings, Trash2, TrendingUp, BarChart3 } from 'lucide-react';
import type { AppView, Playlist } from '../types';

interface Props {
  currentView: AppView;
  onViewChange: (view: AppView) => void;
  playlists: Playlist[];
  likedCount: number;
  queueCount: number;
  accentColor: string;
  onCreatePlaylist: () => void;
  onDeletePlaylist: (id: string) => void;
  onOpenSettings: () => void;
}

function isViewActive(current: AppView, target: AppView): boolean {
  if (typeof current === 'string' && typeof target === 'string') return current === target;
  if (typeof current === 'object' && typeof target === 'object') return current.id === target.id;
  return false;
}

export function Sidebar({
  currentView, onViewChange, playlists, likedCount, queueCount, accentColor,
  onCreatePlaylist, onDeletePlaylist, onOpenSettings,
}: Props) {
  const [hoveredPlaylist, setHoveredPlaylist] = useState<string | null>(null);

  const NavItem = ({ view, icon, label, badge }: { view: AppView; icon: React.ReactNode; label: string; badge?: number }) => {
    const active = isViewActive(currentView, view);
    return (
      <button
        onClick={() => onViewChange(view)}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm font-medium"
        style={active ? { background: `${accentColor}22`, color: accentColor } : { color: 'rgba(255,255,255,0.65)' }}
        onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = 'white'; }}
        onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = 'rgba(255,255,255,0.65)'; }}
      >
        {icon}
        <span className="flex-1 text-left truncate">{label}</span>
        {badge !== undefined && badge > 0 && (
          <span className="text-xs font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)' }}>{badge}</span>
        )}
      </button>
    );
  };

  return (
    <div className="h-full flex flex-col py-4 px-3 overflow-y-auto" style={{ background: '#181818' }}>
      <div className="flex items-center gap-2 px-2 mb-6">
        <img src={`${import.meta.env.BASE_URL}icons/logo-transparent.png`} alt="" className="w-8 h-8 shrink-0" />
        <span className="text-white font-bold text-lg tracking-tight">Melophile</span>
      </div>

      <div className="space-y-0.5 mb-2">
        <NavItem view="library" icon={<Music size={18} />} label="Library" />
        <NavItem view="liked" icon={<Heart size={18} />} label="Liked Songs" badge={likedCount} />
        <NavItem view="most-played" icon={<TrendingUp size={18} />} label="Most Played" />
        <NavItem view="queue" icon={<ListMusic size={18} />} label="Queue" badge={queueCount} />
        <NavItem view="stats" icon={<BarChart3 size={18} />} label="Stats" />
      </div>

      <div className="h-px bg-white/10 mx-1 mb-3" />

      <div className="flex items-center justify-between px-2 mb-2">
        <span className="text-xs text-white/40 font-semibold uppercase tracking-wider">Playlists</span>
        <button onClick={onCreatePlaylist} className="btn-icon w-6 h-6 hover:bg-white/10 rounded-md" title="New playlist">
          <Plus size={14} className="text-white/50" />
        </button>
      </div>

      <div className="flex-1 space-y-0.5 overflow-y-auto">
        {playlists.length === 0 && <p className="text-white/25 text-xs px-3 py-2">No playlists yet</p>}
        {playlists.map((pl) => {
          const view: AppView = { type: 'playlist', id: pl.id };
          const active = isViewActive(currentView, view);
          const hovered = hoveredPlaylist === pl.id;
          return (
            <div key={pl.id} className="flex items-center group rounded-lg transition-colors cursor-pointer"
              style={active ? { background: `${accentColor}22` } : {}}
              onMouseEnter={() => setHoveredPlaylist(pl.id)} onMouseLeave={() => setHoveredPlaylist(null)}
              onClick={() => onViewChange(view)}>
              <div className="flex-1 flex items-center gap-2.5 px-3 py-2 min-w-0">
                <ListMusic size={16} style={{ color: active ? accentColor : 'rgba(255,255,255,0.4)', flexShrink: 0 }} />
                <span className="text-sm truncate" style={{ color: active ? accentColor : 'rgba(255,255,255,0.7)' }}>{pl.name}</span>
                <span className="text-xs text-white/30 shrink-0">{pl.songIds.length}</span>
              </div>
              {hovered && (
                <button onClick={(e) => { e.stopPropagation(); onDeletePlaylist(pl.id); }}
                  className="btn-icon w-7 h-7 hover:bg-red-500/20 mr-1 shrink-0" title="Delete playlist">
                  <Trash2 size={13} className="text-red-400/70 hover:text-red-400" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 pt-3 border-t border-white/10">
        <button onClick={onOpenSettings}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-white/50 hover:text-white hover:bg-white/5 transition-colors text-sm font-medium">
          <Settings size={16} /> Settings
        </button>
      </div>
    </div>
  );
}
