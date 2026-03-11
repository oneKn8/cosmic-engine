export interface Mood {
  name: string;
  display_name: string;
  description: string;
  bpm: number;
}

export type PlaybackState = 'idle' | 'connecting' | 'generating' | 'playing' | 'paused' | 'stopped';

export interface StreamStatus {
  mood: string;
  segment: number;
  elapsed: number;
}

export interface SavedClip {
  id: string;
  mood: string;
  seed: number | null;
  duration: number;
  createdAt: number;
  blob: Blob;
  name?: string;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

export const MOOD_COLORS: Record<string, string> = {
  cosmic: '#7c3aed',
  melancholic: '#3b82f6',
  night_drive: '#f43f5e',
  dream: '#a78bfa',
  tension: '#ef4444',
  euphoria: '#fbbf24',
  rain: '#06b6d4',
  horizon: '#f97316',
};

export function getMoodColor(moodName: string): string {
  return MOOD_COLORS[moodName] ?? '#7c3aed';
}
