import { useEffect, useRef } from 'react';

interface ParticleBackgroundProps {
  analyserNode: AnalyserNode | null;
  moodColor: string;
  isPlaying: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseRadius: number;
  radius: number;
  opacity: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [124, 58, 237];
  return [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)];
}

const PARTICLE_COUNT = 80;
const CONNECTION_DISTANCE = 120;
const BASE_DRIFT_SPEED = 0.3;
const WOBBLE_AMPLITUDE = 0.15;

function createParticle(width: number, height: number): Particle {
  const baseRadius = 1.2 + Math.random() * 1.8;
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * WOBBLE_AMPLITUDE * 2,
    vy: -(Math.random() * BASE_DRIFT_SPEED + 0.1),
    baseRadius,
    radius: baseRadius,
    opacity: 0.3 + Math.random() * 0.5,
  };
}

function wrapParticle(p: Particle, width: number, height: number): void {
  if (p.x < 0) p.x += width;
  else if (p.x > width) p.x -= width;
  if (p.y < 0) p.y += height;
  else if (p.y > height) p.y -= height;
}

export function ParticleBackground({
  analyserNode,
  moodColor,
  isPlaying,
}: ParticleBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const colorRef = useRef(moodColor);
  const isPlayingRef = useRef(isPlaying);

  // Keep refs in sync without triggering effect re-runs
  colorRef.current = moodColor;
  isPlayingRef.current = isPlaying;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // --- Resize handling with devicePixelRatio ---
    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = window.innerWidth;
      const height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Re-initialize particles when viewport changes significantly
      // or on first mount (empty array)
      const particles = particlesRef.current;
      if (particles.length === 0) {
        particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () =>
          createParticle(width, height),
        );
      } else {
        // Clamp existing particles into the new bounds
        for (const p of particles) {
          if (p.x > width) p.x = Math.random() * width;
          if (p.y > height) p.y = Math.random() * height;
        }
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // --- Audio data buffer ---
    let frequencyData: Uint8Array<ArrayBuffer> | null = null;
    let binCount = 0;

    if (analyserNode) {
      binCount = analyserNode.frequencyBinCount;
      frequencyData = new Uint8Array(binCount) as Uint8Array<ArrayBuffer>;
    }

    // --- Animation loop ---
    const draw = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const particles = particlesRef.current;
      const [r, g, b] = hexToRgb(colorRef.current);
      const playing = isPlayingRef.current;

      ctx.clearRect(0, 0, width, height);

      // Compute amplitude from frequency data
      let amplitude = 0;
      if (analyserNode && frequencyData && playing) {
        analyserNode.getByteFrequencyData(frequencyData);
        let sum = 0;
        for (let i = 0; i < binCount; i++) {
          sum += frequencyData[i];
        }
        amplitude = sum / (binCount * 255); // normalized 0..1
      }

      // Amplitude-derived modifiers
      const speedMultiplier = 1 + amplitude * 3;
      const sizeMultiplier = 1 + amplitude * 2;
      const connectionBrightness = 0.08 + amplitude * 0.25;

      // --- Update particles ---
      for (const p of particles) {
        p.x += p.vx * speedMultiplier;
        p.y += p.vy * speedMultiplier;
        p.radius = p.baseRadius * sizeMultiplier;
        wrapParticle(p, width, height);
      }

      // --- Draw connections ---
      const connDist2 = CONNECTION_DISTANCE * CONNECTION_DISTANCE;

      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j++) {
          const b2 = particles[j];
          const dx = a.x - b2.x;
          const dy = a.y - b2.y;
          const dist2 = dx * dx + dy * dy;

          if (dist2 < connDist2) {
            const dist = Math.sqrt(dist2);
            const proximityFactor = 1 - dist / CONNECTION_DISTANCE;
            const lineOpacity = proximityFactor * connectionBrightness;

            ctx.beginPath();
            ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${lineOpacity.toFixed(3)})`;
            ctx.lineWidth = 0.5 + proximityFactor * 0.5;
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b2.x, b2.y);
            ctx.stroke();
          }
        }
      }

      // --- Draw particles ---
      for (const p of particles) {
        const glowRadius = p.radius * (1 + amplitude * 1.5);

        // Outer glow when audio is active
        if (playing && amplitude > 0.05) {
          const gradient = ctx.createRadialGradient(
            p.x, p.y, 0,
            p.x, p.y, glowRadius * 3,
          );
          gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${(p.opacity * amplitude * 0.4).toFixed(3)})`);
          gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
          ctx.beginPath();
          ctx.fillStyle = gradient;
          ctx.arc(p.x, p.y, glowRadius * 3, 0, Math.PI * 2);
          ctx.fill();
        }

        // Core dot
        ctx.beginPath();
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${p.opacity.toFixed(3)})`;
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };

    animFrameRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [analyserNode]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 0,
        pointerEvents: 'none',
      }}
      aria-hidden="true"
    />
  );
}
