import { useEffect } from 'react';
import type { PlaybackState } from '../types.ts';

interface KeyboardShortcutOptions {
  playbackState: PlaybackState;
  volume: number;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onToggleMute: () => void;
  onVolumeChange: (volume: number) => void;
  onSelectMood: (index: number) => void;
  onToggleHelp: () => void;
  onToggleFullscreen: () => void;
  onToggleLibrary: () => void;
  onSaveClip?: () => void;
  onToggleRecording?: () => void;
}

export function useKeyboardShortcuts({
  playbackState,
  volume,
  onStart,
  onStop,
  onPause,
  onResume,
  onToggleMute,
  onVolumeChange,
  onSelectMood,
  onToggleHelp,
  onToggleFullscreen,
  onToggleLibrary,
  onSaveClip,
  onToggleRecording,
}: KeyboardShortcutOptions): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key) {
        case ' ': {
          e.preventDefault();
          if (playbackState === 'playing') {
            onPause();
          } else if (playbackState === 'paused') {
            onResume();
          } else if (playbackState === 'idle' || playbackState === 'stopped') {
            onStart();
          }
          break;
        }
        case 'm':
        case 'M': {
          e.preventDefault();
          onToggleMute();
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          onVolumeChange(Math.min(1, volume + 0.05));
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          onVolumeChange(Math.max(0, volume - 0.05));
          break;
        }
        case 'Escape': {
          if (playbackState === 'playing' || playbackState === 'paused' || playbackState === 'generating') {
            e.preventDefault();
            onStop();
          }
          break;
        }
        case '?': {
          e.preventDefault();
          onToggleHelp();
          break;
        }
        case 'f':
        case 'F': {
          e.preventDefault();
          onToggleFullscreen();
          break;
        }
        case 'l':
        case 'L': {
          e.preventDefault();
          onToggleLibrary();
          break;
        }
        case 's':
        case 'S': {
          if (onSaveClip) {
            e.preventDefault();
            onSaveClip();
          }
          break;
        }
        case 'r':
        case 'R': {
          if (onToggleRecording) {
            e.preventDefault();
            onToggleRecording();
          }
          break;
        }
        default: {
          // Number keys 1-8 for mood selection
          const num = parseInt(e.key, 10);
          if (num >= 1 && num <= 8) {
            e.preventDefault();
            onSelectMood(num - 1);
          }
          break;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [playbackState, volume, onStart, onStop, onPause, onResume, onToggleMute, onVolumeChange, onSelectMood, onToggleHelp, onToggleFullscreen, onToggleLibrary, onSaveClip, onToggleRecording]);
}
