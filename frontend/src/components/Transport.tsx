import { useCallback, useState } from 'react';
import type { PlaybackState, Mood } from '../types.ts';
import { VolumeControl } from './VolumeControl.tsx';
import { SaveControls } from './SaveControls.tsx';

interface TransportProps {
  playbackState: PlaybackState;
  currentMood: string | null;
  currentMoodData: Mood | null;
  elapsed: number;
  segmentCount: number;
  moodColor: string;
  volume: number;
  isMuted: boolean;
  isFullscreen: boolean;
  currentSeed: number | null;
  isSeedLocked: boolean;
  isRecording: boolean;
  recordingDuration: number;
  clipCount: number;
  canSave: boolean;
  onStart: () => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onToggleFullscreen: () => void;
  onLockSeed: () => void;
  onUnlockSeed: () => void;
  onSaveClip: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onOpenLibrary: () => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function PlayIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <polygon points="6,3 20,12 6,21" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="5" y="3" width="5" height="18" rx="1" />
      <rect x="14" y="3" width="5" height="18" rx="1" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}

function FullscreenIcon({ active }: { active: boolean }) {
  if (active) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="4 14 10 14 10 20" />
        <polyline points="20 10 14 10 14 4" />
        <line x1="14" y1="10" x2="21" y2="3" />
        <line x1="3" y1="21" x2="10" y2="14" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function LockIcon({ locked }: { locked: boolean }) {
  if (locked) {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  );
}

function GeneratingIndicator({ moodColor }: { moodColor: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
      }}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          style={{
            width: '3px',
            height: '14px',
            borderRadius: '2px',
            backgroundColor: moodColor,
            animation: `generating-bar 1.2s ease-in-out ${i * 0.15}s infinite`,
            opacity: 0.6,
          }}
        />
      ))}
    </div>
  );
}

export function Transport({
  playbackState,
  currentMood,
  currentMoodData,
  elapsed,
  segmentCount,
  moodColor,
  volume,
  isMuted,
  isFullscreen,
  currentSeed,
  isSeedLocked,
  isRecording,
  recordingDuration,
  clipCount,
  canSave,
  onStart,
  onStop,
  onPause,
  onResume,
  onVolumeChange,
  onToggleMute,
  onToggleFullscreen,
  onLockSeed,
  onUnlockSeed,
  onSaveClip,
  onStartRecording,
  onStopRecording,
  onOpenLibrary,
}: TransportProps) {
  const isIdle = playbackState === 'idle' || playbackState === 'stopped';
  const isPlaying = playbackState === 'playing';
  const isPaused = playbackState === 'paused';
  const isConnecting = playbackState === 'connecting';
  const isGenerating = playbackState === 'generating';

  const [primaryHovered, setPrimaryHovered] = useState(false);
  const [stopHovered, setStopHovered] = useState(false);
  const [fsHovered, setFsHovered] = useState(false);
  const [seedHovered, setSeedHovered] = useState(false);

  const handlePrimaryAction = useCallback(() => {
    if (isIdle) {
      onStart();
    } else if (isPlaying) {
      onPause();
    } else if (isPaused) {
      onResume();
    }
  }, [isIdle, isPlaying, isPaused, onStart, onPause, onResume]);

  const primaryLabel = isIdle
    ? 'Play'
    : isPlaying
      ? 'Pause'
      : isPaused
        ? 'Resume'
        : isGenerating
          ? 'Generating...'
          : 'Connecting...';

  const showStop = isPlaying || isPaused || isConnecting || isGenerating;
  const showControls = isPlaying || isPaused || isConnecting || isGenerating;
  const primaryDisabled = isConnecting || isGenerating;

  // BPM pulse duration
  const bpmDuration = currentMoodData?.bpm
    ? `${60 / currentMoodData.bpm}s`
    : '0.7s';

  const handleSeedToggle = useCallback(() => {
    if (isSeedLocked) {
      onUnlockSeed();
    } else {
      onLockSeed();
    }
  }, [isSeedLocked, onLockSeed, onUnlockSeed]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px',
        padding: '16px 0',
      }}
    >
      {/* Main controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {/* Primary action button */}
        <button
          onClick={handlePrimaryAction}
          onMouseEnter={() => setPrimaryHovered(true)}
          onMouseLeave={() => setPrimaryHovered(false)}
          disabled={primaryDisabled}
          aria-label={primaryLabel}
          title={`${primaryLabel} (Space)`}
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            border: `1.5px solid ${moodColor}`,
            backgroundColor: primaryHovered
              ? `${moodColor}40`
              : `${moodColor}33`,
            color: '#e2e2e8',
            cursor: primaryDisabled ? 'not-allowed' : 'pointer',
            opacity: primaryDisabled ? 0.7 : 1,
            transition: 'all 300ms ease',
            outline: 'none',
            animation: isPlaying
              ? 'pulse-glow 2s ease-in-out infinite'
              : isGenerating
                ? 'generating-pulse 1.5s ease-in-out infinite'
                : 'none',
          }}
        >
          {isConnecting ? (
            <div
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                border: `2px solid ${moodColor}`,
                borderTopColor: 'transparent',
                animation: 'spin 1s linear infinite',
              }}
            />
          ) : isGenerating ? (
            <GeneratingIndicator moodColor="#e2e2e8" />
          ) : isIdle ? (
            <PlayIcon />
          ) : isPlaying ? (
            <PauseIcon />
          ) : isPaused ? (
            <PlayIcon />
          ) : null}
        </button>

        {showStop && (
          <button
            onClick={onStop}
            onMouseEnter={() => setStopHovered(true)}
            onMouseLeave={() => setStopHovered(false)}
            aria-label="Stop"
            title="Stop (Esc)"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              backgroundColor: stopHovered ? 'rgba(30, 30, 42, 1)' : 'rgba(18, 18, 26, 0.8)',
              color: stopHovered ? '#e2e2e8' : '#6b6b7b',
              border: stopHovered
                ? '1px solid rgba(107, 107, 123, 0.4)'
                : '1px solid rgba(107, 107, 123, 0.2)',
              cursor: 'pointer',
              transition: 'all 300ms ease',
              outline: 'none',
            }}
          >
            <StopIcon />
          </button>
        )}

        {/* Fullscreen toggle */}
        <button
          onClick={onToggleFullscreen}
          onMouseEnter={() => setFsHovered(true)}
          onMouseLeave={() => setFsHovered(false)}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen mode'}
          title={`${isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} (F)`}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            backgroundColor: fsHovered ? 'rgba(30, 30, 42, 1)' : 'transparent',
            color: isFullscreen ? moodColor : fsHovered ? '#e2e2e8' : '#6b6b7b',
            border: 'none',
            cursor: 'pointer',
            transition: 'all 300ms ease',
            outline: 'none',
          }}
        >
          <FullscreenIcon active={isFullscreen} />
        </button>
      </div>

      {/* Generating state info */}
      {isGenerating && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            animation: 'fade-in 300ms ease',
          }}
        >
          <span
            style={{
              fontSize: '0.8rem',
              fontWeight: 500,
              color: moodColor,
              letterSpacing: '0.1em',
              animation: 'generating-text 2s ease-in-out infinite',
            }}
          >
            Generating...
          </span>

          {/* Subtle progress bar */}
          <div
            style={{
              width: '120px',
              height: '2px',
              borderRadius: '1px',
              backgroundColor: 'rgba(107, 107, 123, 0.15)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: '40%',
                height: '100%',
                borderRadius: '1px',
                backgroundColor: moodColor,
                animation: 'shimmer-sweep 1.5s ease-in-out infinite',
              }}
            />
          </div>
        </div>
      )}

      {/* Now Playing info */}
      {(isPlaying || isPaused) && showControls && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            animation: 'fade-in 300ms ease',
          }}
        >
          {/* Mood name + description row */}
          {currentMood && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '2px',
              }}
            >
              <span
                style={{
                  textTransform: 'uppercase',
                  letterSpacing: '0.15em',
                  fontSize: '0.8rem',
                  fontWeight: 500,
                  color: moodColor,
                }}
              >
                {currentMood.replace('_', ' ')}
              </span>
              {currentMoodData?.description && (
                <span
                  style={{
                    fontSize: '0.7rem',
                    color: '#6b6b7b',
                    letterSpacing: '0.02em',
                  }}
                >
                  {currentMoodData.description}
                </span>
              )}
            </div>
          )}

          {/* Time, BPM, Segments, Seed, Volume row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '16px',
              fontSize: '0.875rem',
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                color: '#6b6b7b',
                fontFamily: 'monospace',
                fontVariantNumeric: 'tabular-nums',
                fontSize: '0.875rem',
              }}
            >
              {formatTime(elapsed)}
            </span>

            {currentMoodData?.bpm && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: moodColor,
                    animation: isPlaying
                      ? `bpm-pulse ${bpmDuration} ease-in-out infinite`
                      : 'none',
                  }}
                />
                <span
                  style={{
                    fontSize: '0.75rem',
                    color: 'rgba(107, 107, 123, 0.7)',
                    fontFamily: 'monospace',
                  }}
                >
                  {currentMoodData.bpm} BPM
                </span>
              </div>
            )}

            {segmentCount > 0 && (
              <span
                style={{
                  color: 'rgba(107, 107, 123, 0.5)',
                  fontSize: '0.7rem',
                  fontFamily: 'monospace',
                }}
              >
                seg {segmentCount}
              </span>
            )}

            {/* Seed lock indicator */}
            {currentSeed !== null && (isPlaying || isPaused) && (
              <button
                onClick={handleSeedToggle}
                onMouseEnter={() => setSeedHovered(true)}
                onMouseLeave={() => setSeedHovered(false)}
                aria-label={isSeedLocked ? 'Unlock seed' : 'Lock seed'}
                title={isSeedLocked
                  ? `Seed #${currentSeed} locked -- click to unlock`
                  : `Seed #${currentSeed} -- click to lock for reuse`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 6px',
                  borderRadius: '8px',
                  backgroundColor: isSeedLocked
                    ? `${moodColor}22`
                    : seedHovered
                      ? 'rgba(107, 107, 123, 0.1)'
                      : 'transparent',
                  color: isSeedLocked
                    ? moodColor
                    : seedHovered
                      ? '#e2e2e8'
                      : 'rgba(107, 107, 123, 0.5)',
                  border: isSeedLocked
                    ? `1px solid ${moodColor}33`
                    : '1px solid transparent',
                  cursor: 'pointer',
                  transition: 'all 200ms ease',
                  outline: 'none',
                  fontSize: '0.65rem',
                  fontFamily: 'monospace',
                }}
              >
                <LockIcon locked={isSeedLocked} />
                <span>{currentSeed}</span>
              </button>
            )}

            <div
              style={{
                width: '1px',
                height: '16px',
                backgroundColor: 'rgba(107, 107, 123, 0.2)',
              }}
            />

            <VolumeControl
              volume={volume}
              isMuted={isMuted}
              moodColor={moodColor}
              onVolumeChange={onVolumeChange}
              onToggleMute={onToggleMute}
            />
          </div>

          {/* Save controls row */}
          <div style={{ marginTop: '4px' }}>
            <SaveControls
              moodColor={moodColor}
              isRecording={isRecording}
              recordingDuration={recordingDuration}
              canSave={canSave}
              onSaveClip={onSaveClip}
              onStartRecording={onStartRecording}
              onStopRecording={onStopRecording}
              onOpenLibrary={onOpenLibrary}
              clipCount={clipCount}
            />
          </div>
        </div>
      )}

      {isIdle && (
        <p style={{ color: '#6b6b7b', fontSize: '0.8rem', textAlign: 'center', lineHeight: 1.6 }}>
          Select a mood and press play
          <br />
          <span style={{ fontSize: '0.7rem', color: 'rgba(107, 107, 123, 0.5)' }}>
            Space = play/pause | M = mute | 1-8 = moods | F = fullscreen | ? = help
          </span>
        </p>
      )}
    </div>
  );
}
