import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ArrowUp, ArrowDown, History as HistoryIcon } from 'lucide-react';
import type { ListeningSession } from '../hooks/useListeningStats';

interface Props {
  sessions: ListeningSession[];
  accentColor: string;
  onClose: () => void;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Time-of-day buckets. Boundaries are just reasonable default cutoffs
// (5am/12pm/5pm/9pm) — not derived from anything in the library, so treat
// them as a stylistic choice rather than a precise definition of "evening".
type Bucket = 'morning' | 'afternoon' | 'evening' | 'night';
function bucketFor(hour: number): Bucket {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function aggregateMonth(sessions: ListeningSession[], year: number, month: number) {
  const days = daysInMonth(year, month);
  const perDaySec = new Array(days + 1).fill(0); // 1-indexed by day-of-month
  const bucketSec: Record<Bucket, number> = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  let totalSec = 0;
  for (const s of sessions) {
    const d = new Date(s.startTime);
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    perDaySec[d.getDate()] += s.durationInSeconds;
    bucketSec[bucketFor(d.getHours())] += s.durationInSeconds;
    totalSec += s.durationInSeconds;
  }
  return {
    days,
    totalMin: Math.round(totalSec / 60),
    perDayMin: perDaySec.map((s) => Math.round(s / 60)),
    buckets: {
      morning: Math.round(bucketSec.morning / 60),
      afternoon: Math.round(bucketSec.afternoon / 60),
      evening: Math.round(bucketSec.evening / 60),
      night: Math.round(bucketSec.night / 60),
    },
  };
}

export function TimeListenedDetail({ sessions, accentColor, onClose }: Props) {
  const now = new Date();
  // 0 = current month, negative = further back. Lets you page back through
  // any month that has session data, but never forward past "now".
  const [monthOffset, setMonthOffset] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  // Which day's bar was last tapped, so we can show its exact minute count.
  // Cleared on month change so a stale selection from a previous month
  // doesn't appear to apply to the new one.
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  // Full month-by-month history: every calendar month from the earliest
  // recorded session through the current one, most recent first. Months
  // with no listening still get an entry (0 min) — the point is a complete
  // timeline, not just the months that happen to have data.
  const monthHistory = useMemo(() => {
    if (sessions.length === 0) return [{ year: now.getFullYear(), month: now.getMonth(), totalMin: 0 }];
    const sumsByKey = new Map<string, number>();
    let earliest = new Date(sessions[0].startTime);
    for (const s of sessions) {
      const d = new Date(s.startTime);
      if (d < earliest) earliest = d;
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      sumsByKey.set(key, (sumsByKey.get(key) ?? 0) + s.durationInSeconds);
    }
    const list: { year: number; month: number; totalMin: number }[] = [];
    let y = earliest.getFullYear();
    let m = earliest.getMonth();
    const endY = now.getFullYear();
    const endM = now.getMonth();
    while (y < endY || (y === endY && m <= endM)) {
      list.push({ year: y, month: m, totalMin: Math.round((sumsByKey.get(`${y}-${m}`) ?? 0) / 60) });
      m += 1;
      if (m > 11) { m = 0; y += 1; }
    }
    return list.reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);

  const jumpToMonth = (year: number, month: number) => {
    setMonthOffset((year - now.getFullYear()) * 12 + (month - now.getMonth()));
    setShowHistory(false);
  };

  const target = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const year = target.getFullYear();
  const month = target.getMonth();
  const isCurrentMonth = monthOffset === 0;

  useEffect(() => { setSelectedDay(null); }, [year, month]);

  const current = useMemo(() => aggregateMonth(sessions, year, month), [sessions, year, month]);
  const prevTarget = new Date(year, month - 1, 1);
  const previous = useMemo(
    () => aggregateMonth(sessions, prevTarget.getFullYear(), prevTarget.getMonth()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, year, month],
  );

  // Daily average: elapsed days only for the current month-in-progress
  // (dividing by the full month would understate it), full month otherwise.
  const elapsedDays = isCurrentMonth ? now.getDate() : current.days;
  const dailyAvg = elapsedDays > 0 ? Math.round(current.totalMin / elapsedDays) : 0;

  const pctChange = previous.totalMin > 0
    ? Math.round(((current.totalMin - previous.totalMin) / previous.totalMin) * 100)
    : null;

  const maxDay = Math.max(1, ...current.perDayMin.slice(1, isCurrentMonth ? now.getDate() + 1 : undefined));
  // Round the chart ceiling up to a clean-ish number so the axis labels
  // don't look arbitrary (mirrors the reference screenshot's 265/132.5/0).
  const chartMax = Math.max(10, Math.ceil(maxDay / 10) * 10);

  const bucketEntries = (Object.entries(current.buckets) as [Bucket, number][]);
  const maxBucket = Math.max(1, ...bucketEntries.map(([, v]) => v));
  const topBucket = bucketEntries.reduce((a, b) => (b[1] > a[1] ? b : a), bucketEntries[0]);
  const bucketLabel: Record<Bucket, string> = { morning: 'Mornings', afternoon: 'Afternoons', evening: 'Evenings', night: 'Nights' };

  const canGoBack = sessions.length > 0; // always allow paging back; there's no hard floor on stored history
  const canGoForward = monthOffset < 0;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col animate-fade-in" style={{ background: '#0a0a0a' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3 shrink-0">
        <button onClick={() => (showHistory ? setShowHistory(false) : onClose())} className="btn-icon w-9 h-9 hover:bg-white/10 rounded-full -ml-1.5">
          <ChevronLeft size={22} className="text-white" />
        </button>
        <h2 className="text-white font-bold text-lg">{showHistory ? 'Listening History' : 'Time Listened'}</h2>
        {!showHistory && (
          <button onClick={() => setShowHistory(true)}
            className="ml-auto flex items-center gap-1.5 text-white/50 hover:text-white text-xs font-medium px-3 py-1.5 rounded-full hover:bg-white/10 transition-colors">
            <HistoryIcon size={14} /> History
          </button>
        )}
      </div>

      {showHistory ? (
        <div className="flex-1 overflow-y-auto px-4 pb-8">
          <p className="text-white/30 text-xs mb-3 px-1">Every month since you started listening</p>
          <div className="space-y-1">
            {monthHistory.map(({ year: histYear, month: histMonth, totalMin }) => {
              const isSelected = histYear === year && histMonth === month;
              return (
                <button key={`${histYear}-${histMonth}`} onClick={() => jumpToMonth(histYear, histMonth)}
                  className="w-full flex items-center justify-between rounded-xl px-3 py-3 transition-colors hover:bg-white/[0.06]"
                  style={isSelected ? { background: `${accentColor}18`, border: `1px solid ${accentColor}40` } : { border: '1px solid transparent' }}>
                  <span className="text-sm font-semibold" style={{ color: isSelected ? accentColor : '#fff' }}>{MONTH_NAMES[histMonth]} {histYear}</span>
                  <span className="text-xs text-white/40 tabular-nums">{totalMin > 0 ? `${totalMin.toLocaleString()} min` : 'No listening'}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto px-5 pb-8">
        {/* Month selector */}
        <div className="flex items-center gap-2 mb-5">
          <button onClick={() => canGoBack && setMonthOffset((o) => o - 1)}
            className="btn-icon w-7 h-7 rounded-full hover:bg-white/10 text-white/50 hover:text-white">
            <ChevronLeft size={16} />
          </button>
          <span className="text-white/90 font-semibold text-sm min-w-[9rem] text-center">{MONTH_NAMES[month]} {year}</span>
          <button onClick={() => canGoForward && setMonthOffset((o) => o + 1)} disabled={!canGoForward}
            className="btn-icon w-7 h-7 rounded-full hover:bg-white/10 text-white/50 hover:text-white disabled:opacity-25 disabled:hover:bg-transparent">
            <ChevronRight size={16} />
          </button>
        </div>

        {current.totalMin === 0 ? (
          <p className="text-white/30 text-sm py-16 text-center">No listening recorded in {MONTH_NAMES[month]}.</p>
        ) : (
          <>
            {/* Headline */}
            <p className="text-3xl font-extrabold leading-tight text-white">
              You listened to music for{' '}
              <span style={{ color: accentColor }}>{current.totalMin.toLocaleString()} minutes</span>{' '}
              {isCurrentMonth ? 'this month.' : `in ${MONTH_NAMES[month]}.`}
            </p>

            {pctChange !== null && (
              <div className="flex items-center gap-2 mt-3 text-sm text-white/50">
                <span>vs {previous.totalMin.toLocaleString()} minutes in {MONTH_NAMES[(month + 11) % 12]}</span>
                <span className="flex items-center gap-0.5 font-bold rounded-full pl-1 pr-2 py-0.5"
                  style={{ background: pctChange >= 0 ? `${accentColor}22` : 'rgba(248,113,113,0.15)', color: pctChange >= 0 ? accentColor : '#F87171' }}>
                  {pctChange >= 0 ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
                  {Math.abs(pctChange)}%
                </span>
              </div>
            )}
            {pctChange === null && (
              <p className="text-white/30 text-xs mt-3">No data for {MONTH_NAMES[(month + 11) % 12]} to compare against.</p>
            )}

            <p className="text-white/40 text-sm mt-6 mb-2">Daily average: <span className="text-white font-semibold">{dailyAvg} min</span></p>

            {/* Bar chart */}
            <div className="relative mt-4 pl-9" style={{ height: 180 }}>
              {/* Y-axis grid labels */}
              <div className="absolute left-0 top-0 bottom-6 flex flex-col justify-between text-[10px] text-white/25 w-8 text-right pr-1">
                <span>{chartMax}</span>
                <span>{Math.round(chartMax / 2)}</span>
                <span>0</span>
              </div>
              {/* Horizontal gridlines (0 / half / max) spanning full width */}
              <div className="absolute left-9 right-0 top-0 bottom-6">
                <div className="absolute left-0 right-0 top-0 border-t border-white/10" />
                <div className="absolute left-0 right-0 top-1/2 border-t border-white/10" />
                <div className="absolute left-0 right-0 bottom-0 border-t border-white/10" />
              </div>
              {/* Average line */}
              {dailyAvg > 0 && dailyAvg <= chartMax && (
                <div className="absolute left-9 right-0 border-t-2 border-white/70 flex items-start justify-end"
                  style={{ bottom: `${24 + (dailyAvg / chartMax) * (180 - 24)}px` }}>
                  <span className="text-[10px] font-bold text-white bg-[#0a0a0a] px-1 -mt-2">{dailyAvg}</span>
                </div>
              )}
              {/* Bars: pill-shaped. A day with 0 minutes renders as no bar
                  at all (fully empty), rather than a visible nub. Tap a bar
                  to reveal that day's exact minute count above it. */}
              <div className="absolute left-9 right-0 top-0 bottom-6 flex items-end gap-[3px]">
                {current.perDayMin.slice(1, isCurrentMonth ? now.getDate() + 1 : undefined).map((min, i) => {
                  const day = i + 1;
                  const h = Math.max(3, (min / chartMax) * 100);
                  const isSelected = selectedDay === day;
                  return (
                    <div key={day} className="relative flex-1 min-w-0 h-full flex flex-col justify-end items-center">
                      {isSelected && (
                        <span className="mb-1 whitespace-nowrap text-[10px] font-bold text-white bg-black/90 border border-white/20 rounded px-1.5 py-0.5 z-10">
                          {min} min
                        </span>
                      )}
                      <button type="button" onClick={() => setSelectedDay(isSelected ? null : day)}
                        className="w-full rounded-full transition-all p-0 border-0"
                        style={{ height: min > 0 ? `${h}%` : 0, background: `linear-gradient(to top, ${accentColor}, ${accentColor}99)` }}
                        aria-label={`Day ${day}: ${min} min`} />
                    </div>
                  );
                })}
              </div>
              {/* X-axis: a number under every bar, running to the real last
                  day of the month (28/29/30/31), never hardcoded */}
              <div className="absolute left-9 right-0 bottom-0 h-6 flex gap-[3px] text-[7px] text-white/30 leading-none">
                {current.perDayMin.slice(1, isCurrentMonth ? now.getDate() + 1 : undefined).map((_, i) => (
                  <span key={i + 1} className="flex-1 min-w-0 text-center pt-1.5">{i + 1}</span>
                ))}
              </div>
            </div>

            {/* Time of day */}
            <h3 className="mt-10 mb-6 text-2xl font-extrabold leading-tight">
              <span style={{ color: accentColor }}>{bucketLabel[topBucket[0]]}</span>
              <span className="text-white"> are when you listened most.</span>
            </h3>
            <div className="flex items-end justify-between gap-2 px-1">
              {bucketEntries.map(([key, min]) => {
                const isTop = key === topBucket[0];
                const size = 56 + Math.round(72 * Math.sqrt(min / maxBucket));
                return (
                  <div key={key} className="flex flex-col items-center gap-2 flex-1">
                    <div className="rounded-full flex items-center justify-center shrink-0"
                      style={{
                        width: size, height: size,
                        background: `radial-gradient(circle at 50% 40%, ${accentColor}${isTop ? 'cc' : '55'}, rgba(88,28,135,0.35) 70%, transparent 100%)`,
                        border: `1px solid ${accentColor}30`,
                      }}>
                      <span className={`font-bold text-white ${isTop ? 'text-base' : 'text-xs'}`}>
                        {min.toLocaleString()}{isTop ? ' min' : ''}
                      </span>
                    </div>
                    <span className="text-xs text-white/40 capitalize">{key}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      )}
    </div>
  );
}
