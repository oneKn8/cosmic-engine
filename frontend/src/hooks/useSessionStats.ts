import { useEffect, useRef, useState } from 'react';
import type { PlaybackState } from '../types.ts';

export interface SessionStats {
  totalListeningTime: number;
  moodsExplored: Set<string>;
  sessionStartTime: number;
  currentStreak: number;
}

const TICK_INTERVAL_MS = 250;
const TICK_SECONDS = TICK_INTERVAL_MS / 1000;

export function useSessionStats(
  playbackState: PlaybackState,
  currentMood: string | null,
): SessionStats {
  const sessionStartTimeRef = useRef<number>(Date.now());
  const moodsExploredRef = useRef<Set<string>>(new Set());
  const totalTimeRef = useRef<number>(0);
  const streakRef = useRef<number>(0);

  // Trigger re-renders on meaningful changes
  const [stats, setStats] = useState<SessionStats>({
    totalListeningTime: 0,
    moodsExplored: new Set(),
    sessionStartTime: sessionStartTimeRef.current,
    currentStreak: 0,
  });

  // Track moods as they change
  useEffect(() => {
    if (currentMood !== null) {
      moodsExploredRef.current.add(currentMood);
    }
  }, [currentMood]);

  // Reset streak when playback stops (not pause -- pause preserves streak)
  useEffect(() => {
    if (playbackState === 'stopped' || playbackState === 'idle') {
      streakRef.current = 0;
    }
  }, [playbackState]);

  // Tick interval: accumulate time while playing
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (playbackState === 'playing') {
        totalTimeRef.current += TICK_SECONDS;
        streakRef.current += TICK_SECONDS;
      }

      setStats({
        totalListeningTime: totalTimeRef.current,
        moodsExplored: new Set(moodsExploredRef.current),
        sessionStartTime: sessionStartTimeRef.current,
        currentStreak: streakRef.current,
      });
    }, TICK_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [playbackState]);

  return stats;
}
