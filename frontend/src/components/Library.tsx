import { useCallback, useEffect, useRef, useState } from 'react';
import type { SavedClip } from '../types.ts';
import { getMoodColor } from '../types.ts';

interface LibraryProps {
  isOpen: boolean;
  clips: SavedClip[];
  moodColor: string;
  onClose: () => void;
  onDeleteClip: (id: string) => void;
  onDownloadClip: (id: string) => void;
  onRenameClip: (id: string, name: string) => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  const month = d.toLocaleString('en', { month: 'short' });
  const day = d.getDate();
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${month} ${day}, ${hours}:${mins}`;
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function PlaySmallIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <polygon points="6,3 20,12 6,21" />
    </svg>
  );
}

function StopSmallIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function ClipCard({
  clip,
  onPlay,
  onStop,
  isPlaying,
  onDownload,
  onDelete,
  onRename,
}: {
  clip: SavedClip;
  onPlay: () => void;
  onStop: () => void;
  isPlaying: boolean;
  onDownload: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(clip.name ?? '');
  const [hoveredAction, setHoveredAction] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const clipMoodColor = getMoodColor(clip.mood);

  const displayName = clip.name || `${clip.mood.replace('_', ' ')} clip`;

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleStartEditing = useCallback(() => {
    setEditValue(clip.name ?? displayName);
    setIsEditing(true);
  }, [clip.name, displayName]);

  const handleFinishEditing = useCallback(() => {
    setIsEditing(false);
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== clip.name) {
      onRename(trimmed);
    }
  }, [editValue, clip.name, onRename]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleFinishEditing();
      } else if (e.key === 'Escape') {
        setIsEditing(false);
      }
    },
    [handleFinishEditing],
  );

  const actionButtonStyle = (action: string): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    borderRadius: '6px',
    backgroundColor: hoveredAction === action ? 'rgba(107, 107, 123, 0.15)' : 'transparent',
    color: action === 'delete'
      ? hoveredAction === action ? '#ef4444' : '#6b6b7b'
      : hoveredAction === action ? '#e2e2e8' : '#6b6b7b',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 150ms ease',
    outline: 'none',
    padding: 0,
  });

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '12px',
        borderRadius: '10px',
        backgroundColor: 'rgba(18, 18, 26, 0.6)',
        border: '1px solid rgba(107, 107, 123, 0.1)',
        transition: 'background-color 200ms ease',
      }}
    >
      {/* Play / Stop button */}
      <button
        onClick={isPlaying ? onStop : onPlay}
        onMouseEnter={() => setHoveredAction('play')}
        onMouseLeave={() => setHoveredAction(null)}
        aria-label={isPlaying ? 'Stop' : 'Play'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '32px',
          height: '32px',
          borderRadius: '50%',
          backgroundColor: isPlaying ? `${clipMoodColor}33` : 'rgba(107, 107, 123, 0.1)',
          color: isPlaying ? clipMoodColor : hoveredAction === 'play' ? '#e2e2e8' : '#6b6b7b',
          border: isPlaying ? `1px solid ${clipMoodColor}55` : '1px solid transparent',
          cursor: 'pointer',
          transition: 'all 200ms ease',
          outline: 'none',
          flexShrink: 0,
          padding: 0,
        }}
      >
        {isPlaying ? <StopSmallIcon /> : <PlaySmallIcon />}
      </button>

      {/* Clip info */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Mood color dot */}
          <div
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: clipMoodColor,
              flexShrink: 0,
            }}
          />

          {/* Name */}
          {isEditing ? (
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleFinishEditing}
              onKeyDown={handleKeyDown}
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: '0.8rem',
                fontWeight: 500,
                color: '#e2e2e8',
                backgroundColor: 'rgba(107, 107, 123, 0.1)',
                border: `1px solid ${clipMoodColor}44`,
                borderRadius: '4px',
                padding: '2px 6px',
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
          ) : (
            <span
              onClick={handleStartEditing}
              style={{
                fontSize: '0.8rem',
                fontWeight: 500,
                color: '#e2e2e8',
                cursor: 'text',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title="Click to rename"
            >
              {displayName}
            </span>
          )}
        </div>

        {/* Metadata row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '0.65rem',
            color: '#6b6b7b',
            fontFamily: 'monospace',
          }}
        >
          <span>{clip.mood.replace('_', ' ')}</span>
          <span>{formatDuration(clip.duration)}</span>
          <span>{formatDate(clip.createdAt)}</span>
          {clip.seed !== null && (
            <span style={{ color: 'rgba(107, 107, 123, 0.5)' }}>
              #{clip.seed}
            </span>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
        <button
          onClick={onDownload}
          onMouseEnter={() => setHoveredAction('download')}
          onMouseLeave={() => setHoveredAction(null)}
          aria-label="Download"
          title="Download clip"
          style={actionButtonStyle('download')}
        >
          <DownloadIcon />
        </button>
        <button
          onClick={onDelete}
          onMouseEnter={() => setHoveredAction('delete')}
          onMouseLeave={() => setHoveredAction(null)}
          aria-label="Delete"
          title="Delete clip"
          style={actionButtonStyle('delete')}
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}

export function Library({
  isOpen,
  clips,
  moodColor,
  onClose,
  onDeleteClip,
  onDownloadClip,
  onRenameClip,
}: LibraryProps) {
  const [playingClipId, setPlayingClipId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  // Cleanup audio on unmount or close.
  useEffect(() => {
    if (!isOpen) {
      stopPreview();
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      stopPreview();
    };
  }, []);

  const stopPreview = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setPlayingClipId(null);
  }, []);

  const playClip = useCallback(
    (clip: SavedClip) => {
      stopPreview();

      const url = URL.createObjectURL(clip.blob);
      objectUrlRef.current = url;

      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        stopPreview();
      };

      audio.play().catch((err) => {
        console.error('Failed to play clip:', err);
        stopPreview();
      });

      setPlayingClipId(clip.id);
    },
    [stopPreview],
  );

  // Handle Escape key to close.
  useEffect(() => {
    if (!isOpen) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          zIndex: 100,
          animation: 'fade-in 200ms ease',
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '400px',
          maxWidth: '100vw',
          backgroundColor: '#0d0d14',
          borderLeft: '1px solid rgba(107, 107, 123, 0.15)',
          zIndex: 101,
          display: 'flex',
          flexDirection: 'column',
          animation: 'library-slide-in 300ms ease',
          boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.5)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 20px 16px',
            borderBottom: '1px solid rgba(107, 107, 123, 0.1)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2
              style={{
                fontSize: '1rem',
                fontWeight: 500,
                color: '#e2e2e8',
                letterSpacing: '0.05em',
              }}
            >
              Library
            </h2>
            {clips.length > 0 && (
              <span
                style={{
                  fontSize: '0.65rem',
                  fontFamily: 'monospace',
                  color: '#6b6b7b',
                  backgroundColor: 'rgba(107, 107, 123, 0.1)',
                  padding: '2px 8px',
                  borderRadius: '10px',
                }}
              >
                {clips.length} clip{clips.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close library"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              backgroundColor: 'transparent',
              color: '#6b6b7b',
              border: 'none',
              cursor: 'pointer',
              transition: 'color 200ms ease',
              outline: 'none',
              padding: 0,
            }}
          >
            <CloseIcon />
          </button>
        </div>

        {/* Clip list */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          {clips.length === 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 1,
                gap: '12px',
                color: '#6b6b7b',
                textAlign: 'center',
                padding: '40px 20px',
              }}
            >
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="rgba(107, 107, 123, 0.3)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
              <div>
                <p style={{ fontSize: '0.85rem', fontWeight: 500, marginBottom: '6px' }}>
                  No saved clips yet
                </p>
                <p style={{ fontSize: '0.72rem', color: 'rgba(107, 107, 123, 0.6)', lineHeight: 1.5 }}>
                  Use the bookmark button to save the last 30 seconds,
                  <br />
                  or the record button for longer sessions.
                </p>
              </div>
            </div>
          ) : (
            clips.map((clip) => (
              <ClipCard
                key={clip.id}
                clip={clip}
                isPlaying={playingClipId === clip.id}
                onPlay={() => playClip(clip)}
                onStop={stopPreview}
                onDownload={() => onDownloadClip(clip.id)}
                onDelete={() => {
                  if (playingClipId === clip.id) {
                    stopPreview();
                  }
                  onDeleteClip(clip.id);
                }}
                onRename={(name) => onRenameClip(clip.id, name)}
              />
            ))
          )}
        </div>

        {/* Footer hint */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid rgba(107, 107, 123, 0.1)',
            flexShrink: 0,
          }}
        >
          <p
            style={{
              fontSize: '0.65rem',
              color: 'rgba(107, 107, 123, 0.4)',
              textAlign: 'center',
            }}
          >
            L to toggle library | S to quick save | R to record
          </p>
        </div>
      </div>
    </>
  );
}
