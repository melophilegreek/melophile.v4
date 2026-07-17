import { Clock } from 'lucide-react';

export interface AggregatedListeningStats {
  today: number;
  thisMonth: number;
  thisYear: number;
  total: number;
}

interface Props {
  stats: AggregatedListeningStats;
  accentColor: string;
}

function formatMinutes(mins: number): string {
  if (mins <= 0) return '0 min';
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs === 0) return `${rem} min`;
  if (rem === 0) return `${hrs} hr${hrs !== 1 ? 's' : ''}`;
  return `${hrs} hr${hrs !== 1 ? 's' : ''} ${rem} min`;
}

export function ListeningStats({ stats, accentColor }: Props) {
  return (
    <div className="px-4 pt-3 mb-4">
      <h3 className="text-white/60 text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-2">
        <Clock size={14} style={{ color: accentColor }} /> Listening Time
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <Card label="Today" value={formatMinutes(stats.today)} accentColor={accentColor} />
        <Card label="This Month" value={formatMinutes(stats.thisMonth)} accentColor={accentColor} />
        <Card label="This Year" value={formatMinutes(stats.thisYear)} accentColor={accentColor} />
        <Card label="Total Listened" value={formatMinutes(stats.total)} accentColor={accentColor} />
      </div>
    </div>
  );
}

function Card({ label, value, accentColor }: { label: string; value: string; accentColor: string }) {
  return (
    <div
      className="rounded-2xl p-3 transition-colors hover:bg-white/[0.06]"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <span className="text-white/40 text-[11px] font-medium uppercase tracking-wider block mb-1.5">{label}</span>
      <strong className="text-sm font-bold" style={{ color: accentColor }}>{value}</strong>
    </div>
  );
}
