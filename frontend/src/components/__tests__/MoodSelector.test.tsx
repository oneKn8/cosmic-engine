import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MoodSelector } from '../MoodSelector.tsx';

const mockMoods = [
  {
    name: 'cosmic',
    display_name: 'Cosmic',
    description: 'Deep space ambient with evolving synthesizer pads',
    bpm: 85,
  },
  {
    name: 'melancholic',
    display_name: 'Melancholic',
    description: 'Emotional piano with cinematic ambient pads',
    bpm: 70,
  },
  {
    name: 'night_drive',
    display_name: 'Night Drive',
    description: 'Synthwave with driving bass and neon arpeggios',
    bpm: 100,
  },
];

const defaultProps = {
  activeMood: null,
  playbackState: 'idle' as const,
  onSelectMood: vi.fn(),
};

describe('MoodSelector', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockMoods),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading state initially', () => {
    render(<MoodSelector {...defaultProps} />);
    expect(screen.getByText('Loading moods...')).toBeInTheDocument();
  });

  it('renders mood cards after fetching', async () => {
    render(<MoodSelector {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Cosmic')).toBeInTheDocument();
    });
    expect(screen.getByText('Melancholic')).toBeInTheDocument();
    expect(screen.getByText('Night Drive')).toBeInTheDocument();
  });

  it('displays mood descriptions', async () => {
    render(<MoodSelector {...defaultProps} />);
    await waitFor(() => {
      expect(
        screen.getByText('Deep space ambient with evolving synthesizer pads'),
      ).toBeInTheDocument();
    });
  });

  it('displays BPM for each mood', async () => {
    render(<MoodSelector {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('85 BPM')).toBeInTheDocument();
    });
    expect(screen.getByText('70 BPM')).toBeInTheDocument();
    expect(screen.getByText('100 BPM')).toBeInTheDocument();
  });

  it('calls onSelectMood when a mood is clicked', async () => {
    const user = userEvent.setup();
    const onSelectMood = vi.fn();
    render(<MoodSelector {...defaultProps} onSelectMood={onSelectMood} />);
    await waitFor(() => {
      expect(screen.getByText('Cosmic')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('radio', { name: /cosmic/i }));
    expect(onSelectMood).toHaveBeenCalledWith('cosmic');
  });

  it('marks the active mood as checked', async () => {
    render(<MoodSelector {...defaultProps} activeMood="cosmic" />);
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /cosmic/i })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });
  });

  it('shows error message on fetch failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    render(<MoodSelector {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Failed to fetch moods: 500')).toBeInTheDocument();
    });
  });

  it('has radiogroup role for accessibility', async () => {
    render(<MoodSelector {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    });
  });
});
