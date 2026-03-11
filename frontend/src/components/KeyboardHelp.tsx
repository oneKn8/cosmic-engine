import { useEffect } from 'react';

interface KeyboardHelpProps {
  isOpen: boolean;
  onClose: () => void;
  moodColor: string;
}

interface ShortcutEntry {
  key: string;
  description: string;
}

const playbackShortcuts: ShortcutEntry[] = [
  { key: 'Space', description: 'Play / Pause' },
  { key: 'Esc', description: 'Stop' },
  { key: 'M', description: 'Mute / Unmute' },
  { key: '\u2191 / \u2193', description: 'Volume' },
  { key: 'F', description: 'Fullscreen mode' },
];

const navigationShortcuts: ShortcutEntry[] = [
  { key: '1\u20138', description: 'Select mood' },
  { key: '?', description: 'Toggle this help' },
];

function ShortcutRow({ entry, moodColor }: { entry: ShortcutEntry; moodColor: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '6px 0',
      }}
    >
      <kbd
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: '36px',
          padding: '4px 8px',
          fontSize: '0.7rem',
          fontFamily: 'monospace',
          fontWeight: 600,
          color: moodColor,
          backgroundColor: 'rgba(107, 107, 123, 0.1)',
          border: '1px solid rgba(107, 107, 123, 0.25)',
          borderRadius: '6px',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
          whiteSpace: 'nowrap',
          lineHeight: 1.4,
        }}
      >
        {entry.key}
      </kbd>
      <span
        style={{
          fontSize: '0.8rem',
          color: '#6b6b7b',
        }}
      >
        {entry.description}
      </span>
    </div>
  );
}

function ShortcutSection({
  title,
  shortcuts,
  moodColor,
}: {
  title: string;
  shortcuts: ShortcutEntry[];
  moodColor: string;
}) {
  return (
    <div style={{ flex: 1, minWidth: '180px' }}>
      <h3
        style={{
          margin: '0 0 12px 0',
          fontSize: '0.7rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: moodColor,
          opacity: 0.8,
        }}
      >
        {title}
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {shortcuts.map((entry) => (
          <ShortcutRow key={entry.key} entry={entry} moodColor={moodColor} />
        ))}
      </div>
    </div>
  );
}

export function KeyboardHelp({ isOpen, onClose, moodColor }: KeyboardHelpProps) {
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
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        animation: 'keyboardHelpFadeIn 200ms ease-out',
      }}
    >
      <style>{`
        @keyframes keyboardHelpFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes keyboardHelpCardIn {
          from { opacity: 0; transform: scale(0.95) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          maxWidth: '480px',
          width: '90vw',
          padding: '28px 32px 24px',
          backgroundColor: 'rgba(18, 18, 26, 0.95)',
          border: '1px solid rgba(107, 107, 123, 0.2)',
          borderRadius: '16px',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          boxShadow: '0 24px 48px rgba(0, 0, 0, 0.4)',
          animation: 'keyboardHelpCardIn 250ms ease-out',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '24px',
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: '1rem',
              fontWeight: 600,
              color: '#e2e2e8',
              letterSpacing: '0.01em',
            }}
          >
            Keyboard Shortcuts
          </h2>

          <button
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px',
              padding: 0,
              background: 'none',
              border: '1px solid rgba(107, 107, 123, 0.2)',
              borderRadius: '8px',
              cursor: 'pointer',
              color: '#6b6b7b',
              fontSize: '1rem',
              lineHeight: 1,
              transition: 'color 150ms, border-color 150ms',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#e2e2e8';
              e.currentTarget.style.borderColor = 'rgba(107, 107, 123, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#6b6b7b';
              e.currentTarget.style.borderColor = 'rgba(107, 107, 123, 0.2)';
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Shortcut columns */}
        <div
          style={{
            display: 'flex',
            gap: '32px',
            flexWrap: 'wrap',
          }}
        >
          <ShortcutSection title="Playback" shortcuts={playbackShortcuts} moodColor={moodColor} />
          <ShortcutSection title="Navigation" shortcuts={navigationShortcuts} moodColor={moodColor} />
        </div>
      </div>
    </div>
  );
}
