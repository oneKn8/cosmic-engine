import { useEffect, useRef } from 'react';

interface UseVisualizerOptions {
  analyserNode: AnalyserNode | null;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  color: string;
  isPlaying: boolean;
}

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [124, 58, 237];
  return [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16),
  ];
}

export function useVisualizer({
  analyserNode,
  canvasRef,
  color,
  isPlaying,
}: UseVisualizerOptions): void {
  const animFrameRef = useRef<number | null>(null);
  const colorRef = useRef(color);
  const isPlayingRef = useRef(isPlaying);
  const phaseRef = useRef(0);
  const smoothedRef = useRef<Float32Array | null>(null);

  colorRef.current = color;
  isPlayingRef.current = isPlaying;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let currentDpr = 1;

    const resizeCanvas = () => {
      currentDpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * currentDpr;
      canvas.height = rect.height * currentDpr;
      // Don't use ctx.scale - we'll handle DPR in the draw loop
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    let freqData: Uint8Array<ArrayBuffer> | null = null;
    let timeData: Uint8Array<ArrayBuffer> | null = null;
    let bufferLength = 0;

    if (analyserNode) {
      bufferLength = analyserNode.frequencyBinCount;
      freqData = new Uint8Array(bufferLength) as Uint8Array<ArrayBuffer>;
      timeData = new Uint8Array(analyserNode.fftSize) as Uint8Array<ArrayBuffer>;
      if (!smoothedRef.current || smoothedRef.current.length !== 128) {
        smoothedRef.current = new Float32Array(128);
      }
    }

    const NUM_BARS = 96;
    const SMOOTHING = 0.75;

    // ---------------------------------------------------------------
    // Idle mode
    // ---------------------------------------------------------------
    const drawIdle = (w: number, h: number) => {
      const [r, g, b] = hexToRgb(colorRef.current);
      const cx = w / 2;
      const cy = h / 2;
      const baseR = Math.min(w, h) * 0.22;

      phaseRef.current += 0.005;
      const phase = phaseRef.current;

      const breath = 1 + 0.05 * Math.sin(phase * 0.8);

      // Outer radial glow
      const glowGrad = ctx.createRadialGradient(cx, cy, baseR * 0.3, cx, cy, baseR * 2.0);
      glowGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.06)`);
      glowGrad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.02)`);
      glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glowGrad;
      ctx.fillRect(0, 0, w, h);

      // Three concentric rings
      const rings = [
        { radiusMult: 0.7, speed: 1.0, direction: 1, opacity: 0.1, lineWidth: 1.0, dashLen: 4 },
        { radiusMult: 1.0, speed: 0.6, direction: -1, opacity: 0.18, lineWidth: 1.5, dashLen: 0 },
        { radiusMult: 1.3, speed: 0.35, direction: 1, opacity: 0.07, lineWidth: 1.0, dashLen: 8 },
      ];

      for (const ring of rings) {
        const radius = baseR * ring.radiusMult * breath;
        const rotation = phase * ring.speed * ring.direction;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rotation);

        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${ring.opacity})`;
        ctx.lineWidth = ring.lineWidth;
        if (ring.dashLen > 0) {
          ctx.setLineDash([ring.dashLen, ring.dashLen * 1.5]);
        } else {
          ctx.setLineDash([]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Orbiting dots
      const dotCount = 8;
      const dotRadius = baseR * 1.0 * breath;
      const dotRotation = phase * 0.6 * -1;

      for (let i = 0; i < dotCount; i++) {
        const angle = dotRotation + (i / dotCount) * Math.PI * 2;
        const wobble = 1 + 0.04 * Math.sin(phase * 2.5 + i * 1.3);
        const dx = cx + Math.cos(angle) * dotRadius * wobble;
        const dy = cy + Math.sin(angle) * dotRadius * wobble;
        const dotOpacity = 0.25 + 0.15 * Math.sin(phase * 1.5 + i * 0.8);
        const dotSize = 1.8 + 0.6 * Math.sin(phase * 2.0 + i);

        ctx.beginPath();
        ctx.arc(dx, dy, dotSize, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${dotOpacity})`;
        ctx.fill();
      }

      // Soft center glow
      const centerGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR * 0.45);
      centerGlow.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.08)`);
      centerGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = centerGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, baseR * 0.45, 0, Math.PI * 2);
      ctx.fill();
    };

    // ---------------------------------------------------------------
    // Active mode
    // ---------------------------------------------------------------
    const drawActive = (w: number, h: number) => {
      if (!freqData || !timeData || !analyserNode || !smoothedRef.current) return;

      analyserNode.getByteFrequencyData(freqData);
      analyserNode.getByteTimeDomainData(timeData);

      const [r, g, b] = hexToRgb(colorRef.current);
      const cx = w / 2;
      const cy = h / 2;
      const baseRadius = Math.min(w, h) * 0.2;
      const maxBarHeight = Math.min(w, h) * 0.22;

      phaseRef.current += 0.004;
      const phase = phaseRef.current;
      const rotation = phase * 0.2;

      // Smooth frequency data with logarithmic binning
      const smoothed = smoothedRef.current;
      const usableBins = Math.min(bufferLength, 96);

      for (let i = 0; i < NUM_BARS; i++) {
        // Map bar index to frequency bin with slight log weighting
        // This spreads the low frequencies across more bars
        const t = i / NUM_BARS;
        const binIdx = Math.floor(t * t * usableBins); // quadratic mapping
        const raw = freqData[binIdx] / 255;
        // Apply power curve to tame loud peaks and boost quiet bars
        const shaped = Math.pow(raw, 0.7);
        smoothed[i] = smoothed[i] * SMOOTHING + shaped * (1 - SMOOTHING);
      }

      // Average amplitude
      let totalAmp = 0;
      for (let i = 0; i < NUM_BARS; i++) totalAmp += smoothed[i];
      const avgAmp = totalAmp / NUM_BARS;

      // Center pulsing glow
      const glowR = baseRadius * (1.0 + avgAmp * 1.5);
      const centerGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
      centerGlow.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.1 + avgAmp * 0.15})`);
      centerGlow.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${0.03 + avgAmp * 0.04})`);
      centerGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = centerGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
      ctx.fill();

      // Frequency bars as strokes radiating outward
      const angleStep = (Math.PI * 2) / NUM_BARS;
      // Draw bars as lines with rounded caps (no shadow, no fillRect)
      ctx.lineCap = 'round';

      // Glow pass (thicker, dimmer)
      for (let i = 0; i < NUM_BARS; i++) {
        const angle = i * angleStep + rotation;
        const value = smoothed[i];
        const barLen = value * maxBarHeight + 1;
        const barOpacity = 0.08 + value * 0.12;

        const x1 = cx + Math.cos(angle) * baseRadius;
        const y1 = cy + Math.sin(angle) * baseRadius;
        const x2 = cx + Math.cos(angle) * (baseRadius + barLen);
        const y2 = cy + Math.sin(angle) * (baseRadius + barLen);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${barOpacity})`;
        ctx.lineWidth = 4 + value * 3;
        ctx.stroke();
      }

      // Sharp pass (thinner, brighter)
      for (let i = 0; i < NUM_BARS; i++) {
        const angle = i * angleStep + rotation;
        const value = smoothed[i];
        const barLen = value * maxBarHeight + 1;
        const barOpacity = 0.3 + value * 0.7;

        const x1 = cx + Math.cos(angle) * baseRadius;
        const y1 = cy + Math.sin(angle) * baseRadius;
        const x2 = cx + Math.cos(angle) * (baseRadius + barLen);
        const y2 = cy + Math.sin(angle) * (baseRadius + barLen);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${barOpacity})`;
        ctx.lineWidth = 1.5 + value * 1;
        ctx.stroke();
      }

      // Outer ring at base radius
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.2)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Inner decorative ring
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius * 0.7, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.1)`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Waveform ring (time domain)
      const wavePoints = timeData.length;
      const waveRadius = baseRadius * 0.85;
      ctx.beginPath();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.35)`;

      for (let i = 0; i <= wavePoints; i++) {
        const idx = i % wavePoints;
        const angle = (idx / wavePoints) * Math.PI * 2 - Math.PI / 2;
        const sample = (timeData[idx] / 128.0 - 1.0);
        const wobble = waveRadius + sample * baseRadius * 0.25;
        const px = cx + Math.cos(angle) * wobble;
        const py = cy + Math.sin(angle) * wobble;

        if (i === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      }

      ctx.closePath();
      ctx.stroke();

      // Mirrored inner bars (shorter, pointed inward) for symmetry
      for (let i = 0; i < NUM_BARS; i++) {
        const angle = i * angleStep + rotation;
        const value = smoothed[i];
        const barLen = value * maxBarHeight * 0.3 + 1;
        const barOpacity = 0.15 + value * 0.3;

        const x1 = cx + Math.cos(angle) * (baseRadius * 0.68);
        const y1 = cy + Math.sin(angle) * (baseRadius * 0.68);
        const x2 = cx + Math.cos(angle) * (baseRadius * 0.68 - barLen);
        const y2 = cy + Math.sin(angle) * (baseRadius * 0.68 - barLen);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${barOpacity})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    };

    // ---------------------------------------------------------------
    // Animation loop
    // ---------------------------------------------------------------
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      // Reset transform and apply DPR scaling fresh each frame
      ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      if (analyserNode && isPlayingRef.current) {
        drawActive(w, h);
      } else {
        drawIdle(w, h);
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
  }, [analyserNode, canvasRef]);
}
