import { useCallback, useEffect, useRef, useState } from 'react';

interface SaveControlsProps {
  moodColor: string;
  isRecording: boolean;
  recordingDuration: number;
  canSave: boolean;
  onSaveClip: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onOpenLibrary: () => void;
  clipCount: number;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function BookmarkIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

export function SaveControls({
  moodColor,
  isRecording,
  recordingDuration,
  canSave,
  onSaveClip,
  onStartRecording,
  onStopRecording,
  onOpenLibrary,
  clipCount,
}: SaveControlsProps) {
  const [saveHovered, setSaveHovered] = useState(false);
  const [recHovered, setRecHovered] = useState(false);
  const [libHovered, setLibHovered] = useState(false);
  const [showSaveFlash, setShowSaveFlash] = useState(false);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup flash timer.
  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== null) {
        clearTimeout(flashTimerRef.current);
      }
    };
  }, []);

  const handleSaveClip = useCallback(() => {
    if (!canSave) return;
    onSaveClip();
    setShowSaveFlash(true);
    if (flashTimerRef.current !== null) {
      clearTimeout(flashTimerRef.current);
    }
    flashTimerRef.current = setTimeout(() => {
      setShowSaveFlash(false);
    }, 1500);
  }, [canSave, onSaveClip]);

  const handleRecordToggle = useCallback(() => {
    if (isRecording) {
      onStopRecording();
    } else {
      onStartRecording();
    }
  }, [isRecording, onStartRecording, onStopRecording]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        position: 'relative',
      }}
    >
      {/* Save flash toast */}
      {showSaveFlash && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: '8px',
            padding: '4px 12px',
            borderRadius: '12px',
            backgroundColor: `${moodColor}22`,
            border: `1px solid ${moodColor}44`,
            color: moodColor,
            fontSize: '0.7rem',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            animation: 'fade-in 200ms ease',
            pointerEvents: 'none',
          }}
        >
          Clip saved
        </div>
      )}

      {/* Quick Save button */}
      <button
        onClick={handleSaveClip}
        onMouseEnter={() => setSaveHovered(true)}
        onMouseLeave={() => setSaveHovered(false)}
        disabled={!canSave}
        aria-label="Save last 30 seconds"
        title="Save last 30 seconds (S)"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          backgroundColor: saveHovered && canSave
            ? 'rgba(30, 30, 42, 1)'
            : 'transparent',
          color: showSaveFlash
            ? moodColor
            : saveHovered && canSave
              ? '#e2e2e8'
              : '#6b6b7b',
          border: 'none',
          cursor: canSave ? 'pointer' : 'not-allowed',
          opacity: canSave ? 1 : 0.4,
          transition: 'all 200ms ease',
          outline: 'none',
        }}
      >
        <BookmarkIcon />
      </button>

      {/* Record button */}
      <button
        onClick={handleRecordToggle}
        onMouseEnter={() => setRecHovered(true)}
        onMouseLeave={() => setRecHovered(false)}
        aria-label={isRecording ? 'Stop recording' : 'Start recording'}
        title={isRecording ? 'Stop recording (R)' : 'Start recording (R)'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          height: '32px',
          paddingLeft: isRecording ? '8px' : '0',
          paddingRight: isRecording ? '10px' : '0',
          width: isRecording ? 'auto' : '32px',
          borderRadius: isRecording ? '16px' : '50%',
          backgroundColor: isRecording
            ? 'rgba(239, 68, 68, 0.15)'
            : recHovered
              ? 'rgba(30, 30, 42, 1)'
              : 'transparent',
          color: isRecording
            ? '#ef4444'
            : recHovered
              ? '#e2e2e8'
              : '#6b6b7b',
          border: isRecording
            ? '1px solid rgba(239, 68, 68, 0.3)'
            : 'none',
          cursor: 'pointer',
          transition: 'all 200ms ease',
          outline: 'none',
        }}
      >
        {/* Record dot */}
        <div
          style={{
            width: isRecording ? '8px' : '10px',
            height: isRecording ? '8px' : '10px',
            borderRadius: '50%',
            backgroundColor: isRecording ? '#ef4444' : 'currentColor',
            animation: isRecording ? 'rec-pulse 1s ease-in-out infinite' : 'none',
            flexShrink: 0,
          }}
        />
        {isRecording && (
          <span
            style={{
              fontSize: '0.7rem',
              fontFamily: 'monospace',
              fontVariantNumeric: 'tabular-nums',
              color: '#ef4444',
            }}
          >
            {formatDuration(recordingDuration)}
          </span>
        )}
      </button>

      {/* Divider */}
      <div
        style={{
          width: '1px',
          height: '16px',
          backgroundColor: 'rgba(107, 107, 123, 0.2)',
        }}
      />

      {/* Library button */}
      <button
        onClick={onOpenLibrary}
        onMouseEnter={() => setLibHovered(true)}
        onMouseLeave={() => setLibHovered(false)}
        aria-label="Open library"
        title="Open library (L)"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px',
          height: '32px',
          paddingLeft: clipCount > 0 ? '8px' : '0',
          paddingRight: clipCount > 0 ? '10px' : '0',
          width: clipCount > 0 ? 'auto' : '32px',
          borderRadius: clipCount > 0 ? '16px' : '50%',
          backgroundColor: libHovered
            ? 'rgba(30, 30, 42, 1)'
            : 'transparent',
          color: libHovered ? '#e2e2e8' : '#6b6b7b',
          border: 'none',
          cursor: 'pointer',
          transition: 'all 200ms ease',
          outline: 'none',
        }}
      >
        <LibraryIcon />
        {clipCount > 0 && (
          <span
            style={{
              fontSize: '0.65rem',
              fontFamily: 'monospace',
              color: 'inherit',
            }}
          >
            {clipCount}
          </span>
        )}
      </button>
    </div>
  );
}
