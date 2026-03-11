import type { ConnectionStatus } from '../types.ts';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8888/ws/stream';

interface StatusBarProps {
  connectionStatus: ConnectionStatus;
}

const STATUS_CONFIG: Record<ConnectionStatus, { label: string; dotColor: string }> = {
  connected: { label: 'Connected', dotColor: '#22c55e' },
  connecting: { label: 'Connecting...', dotColor: '#eab308' },
  disconnected: { label: 'Disconnected', dotColor: '#ef4444' },
};

export function StatusBar({ connectionStatus }: StatusBarProps) {
  const config = STATUS_CONFIG[connectionStatus];

  return (
    <footer
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        padding: '8px 16px',
        fontSize: '0.75rem',
        color: 'rgba(107, 107, 123, 0.6)',
      }}
      role="status"
      aria-live="polite"
    >
      <div
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          backgroundColor: config.dotColor,
          boxShadow: `0 0 6px ${config.dotColor}`,
          transition: 'background-color 300ms ease',
        }}
        aria-hidden="true"
      />
      <span>{config.label}</span>
      <span style={{ margin: '0 4px' }}>|</span>
      <span>{WS_URL}</span>
    </footer>
  );
}
