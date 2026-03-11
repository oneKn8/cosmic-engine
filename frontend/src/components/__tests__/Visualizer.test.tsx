import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Visualizer } from '../Visualizer.tsx';

// Mock canvas context
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    stroke: vi.fn(),
    scale: vi.fn(),
    set strokeStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set lineJoin(_v: string) {},
    set lineCap(_v: string) {},
    set shadowColor(_v: string) {},
    set shadowBlur(_v: number) {},
  });
});

describe('Visualizer', () => {
  it('renders a canvas element', () => {
    render(
      <Visualizer analyserNode={null} moodColor="#7c3aed" isPlaying={false} />,
    );
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('has an aria-label for accessibility', () => {
    render(
      <Visualizer analyserNode={null} moodColor="#7c3aed" isPlaying={false} />,
    );
    expect(screen.getByLabelText('Audio visualization')).toBeInTheDocument();
  });

  it('renders without errors when analyserNode is null', () => {
    const { container } = render(
      <Visualizer analyserNode={null} moodColor="#3b82f6" isPlaying={false} />,
    );
    expect(container.querySelector('canvas')).toBeInTheDocument();
  });
});
