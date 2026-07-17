import { useMemo, useState } from 'react';
import { TrendingUp, BarChart3, Clock, Music2, Disc3, Play, Trash2, ChevronRight } from 'lucide-react';
import type { Song, HistoryEntry } from '../types';
import type { ListeningSession } from '../hooks/useListeningStats';
import { getArtUrl, useAlbumArtError } from './SongRow';
import { initialFor, placeholderBackground } from '../lib/artPlaceholder';
import { ListeningStats, type AggregatedListeningStats } from './ListeningStats';
import { TimeListenedDetail } from './TimeListenedDetail';

// Small wrapper so useAlbumArtError (a hook) can be used per-row inside a
// .map() — hooks can't be called directly inside a map callback, but a
// dedicated component instance per row is fine. See SongRow.tsx for why the
// error handling/fallback exists.
function StatArt({ song, accentColor, textSize }: { song: Song; accentColor: string; textSize: string }) {
  const artUrl = getArtUrl(song);
  const { showArt, onError } = useAlbumArtError(song, artUrl);
  return showArt
    ? <img src={artUrl!} alt="" className="w-full h-full object-cover" onError={onError} />
    : <span className={`${textSize} font-semibold`} style={{ color: accentColor }}>{initialFor(song)}</span>;
}

interface Props {
  songs: Song[];
  history: HistoryEntry[];
  accentColor: string;
  onClearHistory: () => void;
  onPlaySong: (song: Song) => void;
  listeningStats: AggregatedListeningStats;
  sessions: ListeningSession[];
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function formatMinutes(mins: number): string {
  if (mins <= 0) return '0';
  return mins.toLocaleString();
}

export function StatsScreen({ songs, history, accentColor, onClearHistory, onPlaySong, listeningStats, sessions }: Props) {
  const [showTimeDetail, setShowTimeDetail] = useState(false);
  const stats = useMemo(() => {
    const played = songs.filter((s) => (s.playCount ?? 0) > 0);
    const totalPlays = played.reduce((sum, s) => sum + (s.playCount ?? 0), 0);

    // Top 10 by play count
    const top10 = [...played].sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0)).slice(0, 10);
    const maxCount = top10[0]?.playCount ?? 1;
    const topSong = top10[0] ?? null;

    // Most played artist. Also grabs that artist's own highest-played song,
    // used as a stand-in "artist photo" on the capsule card below — the
    // library only has embedded album art, not artist photos, so this is
    // the closest visual we can offer.
    const artistCounts = new Map<string, number>();
    played.forEach((s) => artistCounts.set(s.artist, (artistCounts.get(s.artist) ?? 0) + (s.playCount ?? 0)));
    let topArtist = '';
    let topArtistCount = 0;
    artistCounts.forEach((count, artist) => { if (count > topArtistCount) { topArtist = artist; topArtistCount = count; } });
    const topArtistSong = topArtist
      ? played.filter((s) => s.artist === topArtist).sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0))[0] ?? null
      : null;

    // Most played album
    const albumCounts = new Map<string, number>();
    played.forEach((s) => { if (s.album) albumCounts.set(s.album, (albumCounts.get(s.album) ?? 0) + (s.playCount ?? 0)); });
    let topAlbum = '';
    let topAlbumCount = 0;
    albumCounts.forEach((count, album) => { if (count > topAlbumCount) { topAlbum = album; topAlbumCount = count; } });

    return { totalPlays, top10, maxCount, topSong, topArtist, topArtistCount, topArtistSong, topAlbum, topAlbumCount };
  }, [songs]);

  const songMap = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs]);

  if (stats.totalPlays === 0) {
    return (
      <div className="flex-1 overflow-y-auto pb-6">
        <div className="px-4 pt-3">
          <button onClick={() => setShowTimeDetail(true)}
            className="w-full text-left rounded-2xl p-5 mb-3 transition-transform active:scale-[0.99]"
            style={{ background: `linear-gradient(160deg, ${accentColor}26, rgba(255,255,255,0.03))`, border: `1px solid ${accentColor}30` }}>
            <div className="flex items-center justify-between">
              <span className="text-white/50 text-xs font-semibold uppercase tracking-wider">Time Listened</span>
              <ChevronRight size={16} className="text-white/30" />
            </div>
            <p className="mt-1 leading-none">
              <span className="text-5xl font-extrabold tabular-nums" style={{ color: accentColor }}>{formatMinutes(listeningStats.total)}</span>
              <span className="text-lg font-bold text-white/60 ml-2">minutes</span>
            </p>
            <p className="text-white/35 text-xs mt-2">All time · {formatMinutes(listeningStats.thisMonth)} min this month</p>
          </button>
        </div>
        <ListeningStats stats={listeningStats} accentColor={accentColor} />
        <div className="flex-1 flex flex-col items-center justify-center text-white/25 gap-2 py-20">
          <BarChart3 size={48} className="mb-2 text-white/15" />
          <p className="font-medium text-white/40">No plays counted yet</p>
          <p className="text-xs">A song counts once you've heard 75% of it</p>
        </div>
        {showTimeDetail && (
          <TimeListenedDetail sessions={sessions} accentColor={accentColor} onClose={() => setShowTimeDetail(false)} />
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto pb-6">
      <div className="px-4 pt-3">
        {/* ── Hero: Time Listened capsule ── */}
        <button onClick={() => setShowTimeDetail(true)}
          className="w-full text-left rounded-2xl p-5 mb-3 transition-transform active:scale-[0.99]"
          style={{ background: `linear-gradient(160deg, ${accentColor}26, rgba(255,255,255,0.03))`, border: `1px solid ${accentColor}30` }}>
          <div className="flex items-center justify-between">
            <span className="text-white/50 text-xs font-semibold uppercase tracking-wider">Time Listened</span>
            <ChevronRight size={16} className="text-white/30" />
          </div>
          <p className="mt-1 leading-none">
            <span className="text-5xl font-extrabold tabular-nums" style={{ color: accentColor }}>{formatMinutes(listeningStats.total)}</span>
            <span className="text-lg font-bold text-white/60 ml-2">minutes</span>
          </p>
          <p className="text-white/35 text-xs mt-2">All time · {formatMinutes(listeningStats.thisMonth)} min this month</p>
        </button>

        {/* ── Top Artist / Top Song capsules ── */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <CapsuleCard label="Top Artist" title={stats.topArtist || '—'} accentColor={accentColor}>
            {stats.topArtistSong ? (
              <div className="relative aspect-square rounded-full overflow-hidden mt-3" style={{ background: placeholderBackground(accentColor) }}>
                <StatArt song={stats.topArtistSong} accentColor={accentColor} textSize="text-2xl" />
                {stats.topArtistCount > 0 && (
                  <span className="absolute bottom-1 right-1 rounded-full text-[10px] font-bold px-2 py-1 text-white" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}>
                    {stats.topArtistCount} plays
                  </span>
                )}
              </div>
            ) : <EmptyArt accentColor={accentColor} rounded="rounded-full" />}
          </CapsuleCard>

          <CapsuleCard label="Top Song" title={stats.topSong?.title || '—'} accentColor={accentColor}>
            {stats.topSong ? (
              <div className="relative aspect-square rounded-xl overflow-hidden mt-3" style={{ background: placeholderBackground(accentColor) }}>
                <StatArt song={stats.topSong} accentColor={accentColor} textSize="text-2xl" />
                <span className="absolute bottom-1 right-1 rounded-full text-[10px] font-bold px-2 py-1 text-white" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}>
                  {stats.topSong.playCount} play{stats.topSong.playCount === 1 ? '' : 's'}
                </span>
              </div>
            ) : <EmptyArt accentColor={accentColor} rounded="rounded-xl" />}
          </CapsuleCard>
        </div>

        {/* ── Secondary stat chips ── */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <StatCard icon={<Play size={18} />} label="Total Plays" value={stats.totalPlays.toString()} accentColor={accentColor} />
          <StatCard icon={<Music2 size={18} />} label="Songs Played" value={stats.top10.length > 0 ? songs.filter(s => (s.playCount ?? 0) > 0).length.toString() : '0'} accentColor={accentColor} />
          <StatCard icon={<Disc3 size={18} />} label="Top Album" value={stats.topAlbum || '—'} sub={stats.topAlbum ? `${stats.topAlbumCount} plays` : undefined} accentColor={accentColor} />
          <StatCard icon={<Clock size={18} />} label="This Year" value={formatMinutes(listeningStats.thisYear)} sub="minutes" accentColor={accentColor} />
        </div>
      </div>

      <ListeningStats stats={listeningStats} accentColor={accentColor} />

      {/* ── Top 10, as a capsule panel ── */}
      <div className="px-4 mb-4">
        <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-2">
            <TrendingUp size={14} style={{ color: accentColor }} /> Top 10 Most Played
          </h3>
          <div className="space-y-2">
            {stats.top10.map((song, i) => {
              const pct = ((song.playCount ?? 0) / stats.maxCount) * 100;
              return (
                <div key={song.id} className="flex items-center gap-3 cursor-pointer group rounded-lg -mx-1 px-1 py-0.5 transition-colors hover:bg-white/[0.05]" onClick={() => onPlaySong(song)}>
                  <span className="text-[11px] font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: i < 3 ? `${accentColor}30` : 'rgba(255,255,255,0.06)', color: i < 3 ? accentColor : 'rgba(255,255,255,0.4)' }}>{i + 1}</span>
                  <div className="w-9 h-9 rounded-md shrink-0 overflow-hidden flex items-center justify-center" style={{ background: placeholderBackground(accentColor) }}>
                    <StatArt song={song} accentColor={accentColor} textSize="text-[11px]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-white/90 truncate">{song.title}</p>
                      <span className="text-xs font-bold tabular-nums shrink-0" style={{ color: accentColor }}>{song.playCount} play{song.playCount === 1 ? '' : 's'}</span>
                    </div>
                    <p className="text-xs text-white/40 truncate mb-1">{song.artist}</p>
                    <div className="h-1 rounded-full bg-white/8 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: accentColor }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Recently played, as a capsule panel ── */}
      <div className="px-4">
        <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider flex items-center gap-2">
              <Clock size={14} style={{ color: accentColor }} /> Recently Played
            </h3>
            {history.length > 0 && (
              <button onClick={onClearHistory} className="text-xs text-white/30 hover:text-red-400 flex items-center gap-1 transition-colors">
                <Trash2 size={12} /> Clear
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <p className="text-white/25 text-xs py-4">No history yet</p>
          ) : (
            <div className="space-y-0.5">
              {history.slice(0, 30).map((entry) => {
                const song = songMap.get(entry.songId);
                if (!song) return null;
                return (
                  <div key={entry.id} className="flex items-center gap-3 py-1.5 group cursor-pointer rounded-lg -mx-1 px-1 transition-colors hover:bg-white/[0.05]" onClick={() => onPlaySong(song)}>
                    <div className="w-8 h-8 rounded-md shrink-0 overflow-hidden flex items-center justify-center" style={{ background: placeholderBackground(accentColor) }}>
                      <StatArt song={song} accentColor={accentColor} textSize="text-[10px]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white/80 truncate leading-tight">{song.title}</p>
                      <p className="text-xs text-white/30 truncate leading-tight">{song.artist}</p>
                    </div>
                    <span className="text-xs text-white/25 shrink-0">{timeAgo(entry.playedAt)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {showTimeDetail && (
        <TimeListenedDetail sessions={sessions} accentColor={accentColor} onClose={() => setShowTimeDetail(false)} />
      )}
    </div>
  );
}

/** Label + big colored title + arbitrary art content, used for the Top
 *  Artist / Top Song capsule cards (the Sound-Capsule-style layout). */
function CapsuleCard({ label, title, accentColor, children }: {
  label: string; title: string; accentColor: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <span className="text-white/50 text-xs font-medium">{label}</span>
      <p className="text-base font-extrabold truncate mt-0.5" style={{ color: accentColor }}>{title}</p>
      {children}
    </div>
  );
}

function EmptyArt({ accentColor, rounded }: { accentColor: string; rounded: string }) {
  return (
    <div className={`aspect-square ${rounded} overflow-hidden mt-3 flex items-center justify-center`} style={{ background: placeholderBackground(accentColor) }}>
      <Music2 size={24} style={{ color: accentColor }} />
    </div>
  );
}

function StatCard({ icon, label, value, sub, accentColor }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; accentColor: string;
}) {
  return (
    <div className="rounded-2xl p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span style={{ color: accentColor }}>{icon}</span>
        <span className="text-white/40 text-[11px] font-medium uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-white text-sm font-bold truncate">{value}</p>
      {sub && <p className="text-white/35 text-xs mt-0.5">{sub}</p>}
    </div>
  );
}
