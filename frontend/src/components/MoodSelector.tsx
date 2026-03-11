import { useCallback, useEffect, useState } from 'react';
import type { Mood, PlaybackState } from '../types.ts';
import { getMoodColor } from '../types.ts';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8888';

interface MoodSelectorProps {
  activeMood: string | null;
  playbackState: PlaybackState;
  onSelectMood: (moodName: string) => void;
  onMoodsLoaded?: (moods: Mood[]) => void;
}

function EqualizerBars({ color }: { color: string }) {
  const bars = [
    { width: 2.5, maxHeight: 14, duration: '0.4s', delay: '0s' },
    { width: 2.5, maxHeight: 10, duration: '0.5s', delay: '0.15s' },
    { width: 2.5, maxHeight: 12, duration: '0.3s', delay: '0.08s' },
  ];

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '12px',
        right: '12px',
        display: 'flex',
        alignItems: 'flex-end',
        gap: '2px',
        height: '14px',
      }}
    >
      {bars.map((bar, i) => (
        <div
          key={i}
          style={{
            width: `${bar.width}px`,
            height: `${bar.maxHeight}px`,
            backgroundColor: color,
            borderRadius: '1px',
            transformOrigin: 'bottom',
            animation: `eq-bar ${bar.duration} ease-in-out infinite ${i % 2 === 0 ? 'alternate' : 'alternate-reverse'}`,
            animationDelay: bar.delay,
            opacity: 0.9,
          }}
        />
      ))}
    </div>
  );
}

function BpmDisplay({ bpm, color, isSelected }: { bpm: number; color: string; isSelected: boolean }) {
  // Calculate pulse animation duration from BPM: one beat = 60/bpm seconds
  const pulseDuration = `${(60 / bpm).toFixed(3)}s`;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '0.75rem',
        color: isSelected ? `${color}99` : 'rgba(107, 107, 123, 0.6)',
        fontFamily: 'monospace',
        transition: 'color 300ms ease',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: '4px',
          height: '4px',
          borderRadius: '50%',
          backgroundColor: isSelected ? color : 'rgba(107, 107, 123, 0.4)',
          animation: `bpm-pulse ${pulseDuration} ease-in-out infinite`,
          flexShrink: 0,
        }}
      />
      {bpm} BPM
    </span>
  );
}

export function MoodSelector({ activeMood, playbackState, onSelectMood, onMoodsLoaded }: MoodSelectorProps) {
  const [moods, setMoods] = useState<Mood[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredMood, setHoveredMood] = useState<string | null>(null);
  const [pressedMood, setPressedMood] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchMoods() {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`${API_URL}/api/moods`);
        if (!response.ok) {
          throw new Error(`Failed to fetch moods: ${response.status}`);
        }
        const data = (await response.json()) as Mood[];
        if (!cancelled) {
          setMoods(data);
          onMoodsLoaded?.(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to fetch moods');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchMoods();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = useCallback(
    (moodName: string) => {
      onSelectMood(moodName);
    },
    [onSelectMood],
  );

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '48px 0',
        }}
      >
        <div style={{ color: '#6b6b7b', fontSize: '0.875rem' }}>Loading moods...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '48px 0',
        }}
      >
        <div style={{ color: '#f87171', fontSize: '0.875rem' }}>{error}</div>
      </div>
    );
  }

  const isActive = playbackState === 'playing' || playbackState === 'paused';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: '16px',
        padding: '0 16px 32px',
        maxWidth: '960px',
        margin: '0 auto',
        width: '100%',
      }}
      role="radiogroup"
      aria-label="Music mood selection"
    >
      {moods.map((mood, index) => {
        const color = getMoodColor(mood.name);
        const isSelected = activeMood === mood.name;
        const isHovered = hoveredMood === mood.name;
        const isPressed = pressedMood === mood.name;
        const isPlaying = isSelected && isActive;

        // Border color logic
        const borderColor = isSelected
          ? color
          : isHovered
            ? 'rgba(107, 107, 123, 0.4)'
            : 'rgba(107, 107, 123, 0.15)';

        // Background with mood color tint when selected
        const bgColor = isSelected
          ? `linear-gradient(135deg, rgba(24, 24, 36, 0.95), color-mix(in srgb, ${color} 6%, rgba(18, 18, 26, 0.9)))`
          : isHovered
            ? 'linear-gradient(135deg, rgba(22, 22, 32, 0.9), rgba(18, 18, 26, 0.85))'
            : 'linear-gradient(135deg, rgba(18, 18, 26, 0.8), rgba(14, 14, 22, 0.8))';

        // Double border glow for selected state
        const shadow = isSelected
          ? `inset 0 0 0 1px ${color}33, 0 0 30px 4px ${color}33, 0 2px 8px rgba(0,0,0,0.3)`
          : isHovered
            ? '0 4px 16px rgba(0,0,0,0.3), 0 0 0 0 transparent'
            : '0 2px 8px rgba(0,0,0,0.2)';

        // Transform for hover/press
        const transform = isPressed
          ? 'scale(0.98)'
          : isHovered
            ? 'scale(1.03)'
            : 'scale(1)';

        // Description color: brighter on hover
        const descColor = isHovered || isSelected ? '#8b8b9b' : '#6b6b7b';

        return (
          <button
            key={mood.name}
            onClick={() => handleSelect(mood.name)}
            onMouseEnter={() => setHoveredMood(mood.name)}
            onMouseLeave={() => {
              setHoveredMood(null);
              setPressedMood(null);
            }}
            onMouseDown={() => setPressedMood(mood.name)}
            onMouseUp={() => setPressedMood(null)}
            role="radio"
            aria-checked={isSelected}
            style={{
              position: 'relative',
              textAlign: 'left',
              borderRadius: '12px',
              padding: '16px',
              border: `1px solid ${borderColor}`,
              background: bgColor,
              boxShadow: shadow,
              cursor: 'pointer',
              transition: 'all 220ms cubic-bezier(0.4, 0, 0.2, 1)',
              outline: 'none',
              backdropFilter: 'blur(12px)',
              overflow: 'hidden',
              transform,
              animation: `card-enter 0.4s ease-out ${index * 0.05}s both`,
            }}
          >
            {/* Shimmer overlay on hover */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.03) 50%, transparent 60%)',
                transform: isHovered ? 'translateX(100%)' : 'translateX(-100%)',
                transition: 'transform 0.6s ease',
                pointerEvents: 'none',
                borderRadius: '12px',
              }}
            />

            {/* Color indicator dot */}
            <div
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                marginBottom: '12px',
                backgroundColor: color,
                boxShadow: isSelected
                  ? `0 0 10px ${color}, 0 0 4px ${color}88`
                  : isHovered
                    ? `0 0 6px ${color}66`
                    : 'none',
                transition: 'box-shadow 300ms ease',
              }}
            />

            <h3
              style={{
                fontSize: '0.875rem',
                fontWeight: 600,
                marginBottom: '4px',
                color: isSelected ? color : '#e2e2e8',
                transition: 'color 300ms ease',
                letterSpacing: '0.01em',
              }}
            >
              {mood.display_name}
            </h3>

            <p
              style={{
                fontSize: '0.75rem',
                color: descColor,
                lineHeight: 1.5,
                marginBottom: '8px',
                transition: 'color 300ms ease',
              }}
            >
              {mood.description}
            </p>

            <BpmDisplay bpm={mood.bpm} color={color} isSelected={isSelected} />

            {/* Keyboard shortcut hint */}
            {index < 8 && (
              <span
                style={{
                  position: 'absolute',
                  top: '10px',
                  right: '12px',
                  fontSize: '0.625rem',
                  fontFamily: 'monospace',
                  color: isSelected
                    ? `${color}cc`
                    : isHovered
                      ? 'rgba(107, 107, 123, 0.5)'
                      : 'rgba(107, 107, 123, 0.25)',
                  transition: 'color 300ms ease',
                  fontWeight: 500,
                }}
              >
                {index + 1}
              </span>
            )}

            {/* Equalizer bars when mood is actively playing */}
            {isPlaying && <EqualizerBars color={color} />}
          </button>
        );
      })}
    </div>
  );
}
