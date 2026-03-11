interface SessionStatsProps {
  totalListeningTime: number;
  moodsExplored: number;
  moodColor: string;
  isVisible: boolean;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function SessionStats({
  totalListeningTime,
  moodsExplored,
  moodColor,
  isVisible,
}: SessionStatsProps) {
  if (!isVisible || totalListeningTime <= 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        fontSize: '0.7rem',
        fontFamily: 'monospace',
        color: 'rgba(107, 107, 123, 0.5)',
        animation: 'sessionStatsFadeIn 400ms ease-out',
        userSelect: 'none',
      }}
    >
      <style>{`
        @keyframes sessionStatsFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>

      {/* Listening time */}
      <span>
        <span style={{ color: moodColor, opacity: 0.8 }}>{formatTime(totalListeningTime)}</span>
        {' listened'}
      </span>

      {/* Divider */}
      <span
        style={{
          width: '1px',
          height: '10px',
          backgroundColor: 'rgba(107, 107, 123, 0.2)',
          flexShrink: 0,
        }}
      />

      {/* Moods explored */}
      <span>
        <span style={{ color: moodColor, opacity: 0.8 }}>{moodsExplored}</span>
        {' / 8 moods'}
      </span>
    </div>
  );
}
