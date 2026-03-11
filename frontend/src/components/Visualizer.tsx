import { useRef } from 'react';
import { useVisualizer } from '../hooks/useVisualizer.ts';

interface VisualizerProps {
  analyserNode: AnalyserNode | null;
  moodColor: string;
  isPlaying: boolean;
  height?: string;
}

export function Visualizer({ analyserNode, moodColor, isPlaying, height = '300px' }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useVisualizer({
    analyserNode,
    canvasRef,
    color: moodColor,
    isPlaying,
  });

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
        }}
        aria-label="Audio visualization"
        role="img"
      />
    </div>
  );
}
