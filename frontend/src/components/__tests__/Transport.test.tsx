import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Transport } from '../Transport.tsx';

const defaultProps = {
  playbackState: 'idle' as const,
  currentMood: null,
  elapsed: 0,
  segmentCount: 0,
  moodColor: '#7c3aed',
  volume: 0.8,
  isMuted: false,
  onStart: vi.fn(),
  onStop: vi.fn(),
  onPause: vi.fn(),
  onResume: vi.fn(),
  onVolumeChange: vi.fn(),
  onToggleMute: vi.fn(),
};

describe('Transport', () => {
  it('renders play button when idle', () => {
    render(<Transport {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('renders pause button when playing', () => {
    render(<Transport {...defaultProps} playbackState="playing" />);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('renders resume button when paused', () => {
    render(<Transport {...defaultProps} playbackState="paused" />);
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });

  it('renders stop button when playing', () => {
    render(<Transport {...defaultProps} playbackState="playing" />);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  it('does not render stop button when idle', () => {
    render(<Transport {...defaultProps} />);
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
  });

  it('calls onStart when play is clicked', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<Transport {...defaultProps} onStart={onStart} />);
    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it('calls onPause when pause is clicked', async () => {
    const user = userEvent.setup();
    const onPause = vi.fn();
    render(<Transport {...defaultProps} playbackState="playing" onPause={onPause} />);
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(onPause).toHaveBeenCalledOnce();
  });

  it('calls onStop when stop is clicked', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    render(<Transport {...defaultProps} playbackState="playing" onStop={onStop} />);
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('formats elapsed time correctly', () => {
    render(
      <Transport
        {...defaultProps}
        playbackState="playing"
        currentMood="cosmic"
        elapsed={125}
      />,
    );
    expect(screen.getByText('02:05')).toBeInTheDocument();
  });

  it('displays the current mood', () => {
    render(
      <Transport
        {...defaultProps}
        playbackState="playing"
        currentMood="night_drive"
      />,
    );
    expect(screen.getByText('night drive')).toBeInTheDocument();
  });

  it('displays segment count when available', () => {
    render(
      <Transport
        {...defaultProps}
        playbackState="playing"
        currentMood="cosmic"
        segmentCount={5}
      />,
    );
    expect(screen.getByText('seg 5')).toBeInTheDocument();
  });

  it('shows idle help text when not playing', () => {
    render(<Transport {...defaultProps} />);
    expect(screen.getByText('Select a mood and press play')).toBeInTheDocument();
  });
});
