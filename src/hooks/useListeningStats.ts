import { useState, useEffect } from 'react';

export interface ListeningSession {
  id: string;
  startTime: string; 
  endTime: string;   
  durationInSeconds: number;
}

const STORAGE_KEY = 'music_listening_sessions';

export const useListeningStats = () => {
  const [sessions, setSessions] = useState<ListeningSession[]>([]);
  const [currentSessionStart, setCurrentSessionStart] = useState<Date | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setSessions(JSON.parse(stored));
  }, []);

  const startSession = () => setCurrentSessionStart(new Date());

  const stopSession = () => {
    if (!currentSessionStart) return;
    const endTime = new Date();
    const durationInSeconds = Math.floor((endTime.getTime() - currentSessionStart.getTime()) / 1000);

    if (durationInSeconds > 1) {
      const newSession: ListeningSession = {
        id: Math.random().toString(36).substring(2, 9),
        startTime: currentSessionStart.toISOString(),
        endTime: endTime.toISOString(),
        durationInSeconds,
      };
      const updated = [...sessions, newSession];
      setSessions(updated);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    }
    setCurrentSessionStart(null);
  };

  const getAggregatedStats = () => {
    const now = new Date();
    let todaySec = 0, monthSec = 0, yearSec = 0, totalSec = 0;

    sessions.forEach(session => {
      const sessionDate = new Date(session.startTime);
      const isSameYear = sessionDate.getFullYear() === now.getFullYear();
      const isSameMonth = isSameYear && sessionDate.getMonth() === now.getMonth();
      const isSameDay = isSameMonth && sessionDate.getDate() === now.getDate();

      if (isSameDay) todaySec += session.durationInSeconds;
      if (isSameMonth) monthSec += session.durationInSeconds;
      if (isSameYear) yearSec += session.durationInSeconds;
      totalSec += session.durationInSeconds;
    });

    return {
      today: Math.round(todaySec / 60),
      thisMonth: Math.round(monthSec / 60),
      thisYear: Math.round(yearSec / 60),
      total: Math.round(totalSec / 60),
    };
  };

  return { startSession, stopSession, stats: getAggregatedStats(), sessions };
};
