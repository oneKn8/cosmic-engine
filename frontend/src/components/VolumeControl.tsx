import { useCallback, useRef, useState } from 'react';

interface VolumeControlProps {
  volume: number;
  isMuted: boolean;
  moodColor: string;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
}

function VolumeHighIcon({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill={color} />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

function VolumeLowIcon({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill={color} />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

function VolumeMuteIcon({ color }: { color: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill={color} />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}

export function VolumeControl({
  volume,
  isMuted,
  moodColor,
  onVolumeChange,
  onToggleMute,
}: VolumeControlProps) {
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const sliderRef = useRef<HTMLDivElement>(null);

  const updateVolumeFromEvent = useCallback(
    (clientX: number) => {
      const el = sliderRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onVolumeChange(pct);
    },
    [onVolumeChange],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(true);
      updateVolumeFromEvent(e.clientX);

      const onMove = (ev: MouseEvent) => updateVolumeFromEvent(ev.clientX);
      const onUp = () => {
        setDragging(false);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [updateVolumeFromEvent],
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      setDragging(true);
      updateVolumeFromEvent(e.touches[0].clientX);

      const onMove = (ev: TouchEvent) => {
        ev.preventDefault();
        updateVolumeFromEvent(ev.touches[0].clientX);
      };
      const onEnd = () => {
        setDragging(false);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onEnd);
      };

      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onEnd);
    },
    [updateVolumeFromEvent],
  );

  const displayVolume = isMuted ? 0 : volume;
  const pct = Math.round(displayVolume * 100);

  const VolumeIcon =
    isMuted || displayVolume === 0
      ? VolumeMuteIcon
      : displayVolume < 0.5
        ? VolumeLowIcon
        : VolumeHighIcon;

  const iconColor = hovered || dragging ? moodColor : '#6b6b7b';
  const trackActive = dragging || hovered;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '0 4px',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        onClick={onToggleMute}
        aria-label={isMuted ? 'Unmute' : 'Mute'}
        title={`${isMuted ? 'Unmute' : 'Mute'} (M)`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '4px',
          borderRadius: '4px',
          color: iconColor,
          transition: 'color 200ms',
          outline: 'none',
        }}
      >
        <VolumeIcon color={iconColor} />
      </button>

      <div
        ref={sliderRef}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        role="slider"
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            onVolumeChange(Math.min(1, volume + 0.05));
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            onVolumeChange(Math.max(0, volume - 0.05));
          }
        }}
        style={{
          position: 'relative',
          width: '100px',
          height: '24px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          touchAction: 'none',
        }}
      >
        {/* Track background */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            height: trackActive ? '6px' : '4px',
            borderRadius: '3px',
            backgroundColor: 'rgba(107, 107, 123, 0.2)',
            transition: 'height 150ms',
          }}
        />
        {/* Track fill */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            width: `${pct}%`,
            height: trackActive ? '6px' : '4px',
            borderRadius: '3px',
            backgroundColor: trackActive ? moodColor : 'rgba(107, 107, 123, 0.5)',
            transition: dragging ? 'none' : 'background-color 200ms, height 150ms',
          }}
        />
        {/* Thumb */}
        <div
          style={{
            position: 'absolute',
            left: `${pct}%`,
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            backgroundColor: trackActive ? moodColor : '#6b6b7b',
            transform: `translateX(-50%) scale(${trackActive ? 1 : 0})`,
            transition: dragging ? 'none' : 'transform 150ms, background-color 200ms',
            boxShadow: trackActive ? `0 0 8px ${moodColor}66` : 'none',
          }}
        />
      </div>

      <span
        style={{
          fontSize: '0.625rem',
          fontFamily: 'monospace',
          color: 'rgba(107, 107, 123, 0.5)',
          width: '28px',
          textAlign: 'right',
          opacity: hovered || dragging ? 1 : 0,
          transition: 'opacity 200ms',
        }}
      >
        {pct}%
      </span>
    </div>
  );
}
