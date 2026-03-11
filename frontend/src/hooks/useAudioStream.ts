import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlaybackState, ConnectionStatus } from '../types.ts';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8888/ws/stream';

const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

/** Maximum seconds of decoded audio to keep in the rolling buffer. */
const ROLLING_BUFFER_MAX_SECONDS = 35;

interface AudioStreamState {
  playbackState: PlaybackState;
  connectionStatus: ConnectionStatus;
  currentMood: string | null;
  elapsed: number;
  segmentCount: number;
  analyserNode: AnalyserNode | null;
  volume: number;
  isMuted: boolean;
  currentSeed: number | null;
  isSeedLocked: boolean;
}

interface AudioStreamActions {
  connect: () => void;
  disconnect: () => void;
  start: (mood: string) => void;
  startWithSeed: (mood: string, seed: number) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  changeMood: (mood: string) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  lockSeed: () => void;
  unlockSeed: () => void;
}

export interface UseAudioStreamReturn extends AudioStreamState, AudioStreamActions {
  /** Expose AudioContext for external consumers (e.g. recorder). */
  audioContext: AudioContext | null;
  /** Expose GainNode for external consumers (e.g. recorder destination). */
  gainNode: GainNode | null;
  /** Rolling buffer of recently decoded AudioBuffers (most recent last). */
  decodedBuffers: AudioBuffer[];
}

export function useAudioStream(): UseAudioStreamReturn {
  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [currentMood, setCurrentMood] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [segmentCount, setSegmentCount] = useState(0);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [volume, setVolumeState] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [currentSeed, setCurrentSeed] = useState<number | null>(null);
  const [isSeedLocked, setIsSeedLocked] = useState(false);

  const volumeRef = useRef(0.8);
  const preMuteVolumeRef = useRef(0.8);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const nextPlayTimeRef = useRef(0);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedStartRef = useRef<number | null>(null);
  const pauseOffsetRef = useRef(0);
  const isPlayingRef = useRef(false);
  /** True once audio_ready is received for the current session; reset on start/stop. */
  const hasReceivedAudioRef = useRef(false);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  /** Locked seed value to send on next start / mood change. */
  const lockedSeedRef = useRef<number | null>(null);

  /** Rolling buffer of decoded AudioBuffers (kept under ROLLING_BUFFER_MAX_SECONDS). */
  const decodedBuffersRef = useRef<AudioBuffer[]>([]);
  const [decodedBuffers, setDecodedBuffers] = useState<AudioBuffer[]>([]);

  // Expose AudioContext and GainNode for external consumers.
  const [audioContextState, setAudioContextState] = useState<AudioContext | null>(null);
  const [gainNodeState, setGainNodeState] = useState<GainNode | null>(null);

  const ensureAudioContext = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;

      const gain = ctx.createGain();
      gain.gain.value = volumeRef.current;

      gain.connect(analyser);
      analyser.connect(ctx.destination);

      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      gainNodeRef.current = gain;
      setAnalyserNode(analyser);
      setAudioContextState(ctx);
      setGainNodeState(gain);
    }

    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }

    return audioCtxRef.current;
  }, []);

  const clearElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current !== null) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  const startElapsedTimer = useCallback(() => {
    clearElapsedTimer();
    elapsedStartRef.current = Date.now() - pauseOffsetRef.current * 1000;
    elapsedTimerRef.current = setInterval(() => {
      if (elapsedStartRef.current !== null) {
        setElapsed(Math.floor((Date.now() - elapsedStartRef.current) / 1000));
      }
    }, 250);
  }, [clearElapsedTimer]);

  const stopAllSources = useCallback(() => {
    for (const source of activeSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // source may already have stopped
      }
    }
    activeSourcesRef.current.clear();
  }, []);

  /** Push a decoded buffer into the rolling ring buffer. */
  const pushDecodedBuffer = useCallback((buffer: AudioBuffer) => {
    const buffers = decodedBuffersRef.current;
    buffers.push(buffer);

    // Trim from front until total duration is within limit.
    let total = 0;
    for (let i = buffers.length - 1; i >= 0; i--) {
      total += buffers[i].duration;
      if (total > ROLLING_BUFFER_MAX_SECONDS) {
        // Remove everything before index i
        decodedBuffersRef.current = buffers.slice(i);
        break;
      }
    }

    // Expose a snapshot for external consumers.
    setDecodedBuffers([...decodedBuffersRef.current]);
  }, []);

  const scheduleAudioBuffer = useCallback((buffer: AudioBuffer) => {
    const ctx = audioCtxRef.current;
    const gain = gainNodeRef.current;
    if (!ctx || !gain) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);

    const now = ctx.currentTime;
    const startTime = Math.max(nextPlayTimeRef.current, now);

    source.start(startTime);
    nextPlayTimeRef.current = startTime + buffer.duration;

    activeSourcesRef.current.add(source);
    source.onended = () => {
      activeSourcesRef.current.delete(source);
    };
  }, []);

  const handleMessage = useCallback((event: MessageEvent) => {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(event.data as string) as Record<string, unknown>;
    } catch {
      return;
    }

    const msgType = data.type as string;

    if (msgType === 'generating') {
      // Backend is generating audio -- show generating state.
      // Only transition to 'generating' before the first audio_ready
      // for this session. After that, ignore subsequent generating
      // messages (they arrive for every segment).
      if (!hasReceivedAudioRef.current) {
        setPlaybackState('generating');
      }
    } else if (msgType === 'audio_ready') {
      // First audio chunk is available -- transition to playing.
      isPlayingRef.current = true;
      hasReceivedAudioRef.current = true;
      setPlaybackState('playing');
      startElapsedTimer();
    } else if (msgType === 'audio' && typeof data.data === 'string') {
      if (!isPlayingRef.current) return;

      const binaryStr = atob(data.data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const ctx = audioCtxRef.current;
      if (!ctx) return;

      ctx.decodeAudioData(
        bytes.buffer.slice(0) as ArrayBuffer,
        (decodedBuffer) => {
          if (isPlayingRef.current) {
            scheduleAudioBuffer(decodedBuffer);
            pushDecodedBuffer(decodedBuffer);
          }
        },
        (err) => {
          console.error('Failed to decode audio data:', err);
        },
      );
    } else if (msgType === 'status') {
      if (typeof data.segment === 'number') {
        setSegmentCount(data.segment);
      }
      if (typeof data.elapsed === 'number') {
        setElapsed(Math.floor(data.elapsed));
      }
      if (typeof data.seed === 'number') {
        setCurrentSeed(data.seed);
      }
    } else if (msgType === 'mood_changed' && typeof data.mood === 'string') {
      setCurrentMood(data.mood);
    } else if (msgType === 'error') {
      console.error('Server error:', data.message);
    }
  }, [scheduleAudioBuffer, startElapsedTimer, pushDecodedBuffer]);

  const sendMessage = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return;
    }

    setConnectionStatus('connecting');

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionStatus('connected');
      reconnectAttemptsRef.current = 0;
    };

    ws.onmessage = handleMessage;

    ws.onclose = () => {
      setConnectionStatus('disconnected');

      if (isPlayingRef.current) {
        setPlaybackState('stopped');
        isPlayingRef.current = false;
        clearElapsedTimer();
        stopAllSources();
      }

      // Auto-reconnect
      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current += 1;
        reconnectTimerRef.current = setTimeout(() => {
          connect();
        }, RECONNECT_DELAY_MS);
      }
    };

    ws.onerror = () => {
      // onclose will fire after onerror
    };
  }, [handleMessage, clearElapsedTimer, stopAllSources]);

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptsRef.current = MAX_RECONNECT_ATTEMPTS; // prevent auto-reconnect

    const ws = wsRef.current;
    if (ws) {
      ws.close();
      wsRef.current = null;
    }

    setConnectionStatus('disconnected');
    setPlaybackState('idle');
    isPlayingRef.current = false;
    hasReceivedAudioRef.current = false;
    clearElapsedTimer();
    stopAllSources();
  }, [clearElapsedTimer, stopAllSources]);

  const start = useCallback((mood: string) => {
    const ctx = ensureAudioContext();
    nextPlayTimeRef.current = ctx.currentTime;

    // Don't set isPlayingRef yet -- wait for audio_ready.
    hasReceivedAudioRef.current = false;
    setPlaybackState('connecting');
    setCurrentMood(mood);
    setElapsed(0);
    setSegmentCount(0);
    pauseOffsetRef.current = 0;
    decodedBuffersRef.current = [];
    setDecodedBuffers([]);

    const msg: Record<string, unknown> = { type: 'start', mood };
    if (lockedSeedRef.current !== null) {
      msg.seed = lockedSeedRef.current;
    }
    sendMessage(msg);

    // Fallback: if server doesn't send generating/audio_ready, transition
    // to 'generating' after a brief delay so we don't get stuck on 'connecting'.
    setTimeout(() => {
      // Only advance if we're still in 'connecting' state (no server message arrived yet).
      setPlaybackState((prev) => {
        if (prev === 'connecting') {
          return 'generating';
        }
        return prev;
      });
    }, 200);
  }, [ensureAudioContext, sendMessage]);

  const startWithSeed = useCallback((mood: string, seed: number) => {
    lockedSeedRef.current = seed;
    setIsSeedLocked(true);
    start(mood);
  }, [start]);

  const stop = useCallback(() => {
    isPlayingRef.current = false;
    hasReceivedAudioRef.current = false;
    setPlaybackState('stopped');
    clearElapsedTimer();
    stopAllSources();
    pauseOffsetRef.current = 0;
    nextPlayTimeRef.current = 0;
    sendMessage({ type: 'stop' });

    // Reset to idle after a moment
    setTimeout(() => {
      setPlaybackState('idle');
      setCurrentMood(null);
      setElapsed(0);
      setSegmentCount(0);
      setCurrentSeed(null);
    }, 300);
  }, [sendMessage, clearElapsedTimer, stopAllSources]);

  const pause = useCallback(() => {
    if (playbackState !== 'playing') return;

    isPlayingRef.current = false;
    setPlaybackState('paused');

    // Store current elapsed for resume
    if (elapsedStartRef.current !== null) {
      pauseOffsetRef.current = (Date.now() - elapsedStartRef.current) / 1000;
    }
    clearElapsedTimer();

    // Suspend audio context to pause playback
    audioCtxRef.current?.suspend();

    sendMessage({ type: 'pause' });
  }, [playbackState, sendMessage, clearElapsedTimer]);

  const resume = useCallback(() => {
    if (playbackState !== 'paused') return;

    isPlayingRef.current = true;
    setPlaybackState('playing');

    audioCtxRef.current?.resume();
    startElapsedTimer();

    sendMessage({ type: 'resume' });
  }, [playbackState, sendMessage, startElapsedTimer]);

  const changeMood = useCallback((mood: string) => {
    setCurrentMood(mood);
    const msg: Record<string, unknown> = { type: 'change_mood', mood };
    if (lockedSeedRef.current !== null) {
      msg.seed = lockedSeedRef.current;
    }
    sendMessage(msg);
  }, [sendMessage]);

  const lockSeed = useCallback(() => {
    if (currentSeed !== null) {
      lockedSeedRef.current = currentSeed;
      setIsSeedLocked(true);
    }
  }, [currentSeed]);

  const unlockSeed = useCallback(() => {
    lockedSeedRef.current = null;
    setIsSeedLocked(false);
  }, []);

  const setVolume = useCallback((vol: number) => {
    const clamped = Math.max(0, Math.min(1, vol));
    volumeRef.current = clamped;
    setVolumeState(clamped);
    setIsMuted(clamped === 0);

    const gain = gainNodeRef.current;
    if (gain) {
      gain.gain.setTargetAtTime(clamped, gain.context.currentTime, 0.015);
    }
  }, []);

  const toggleMute = useCallback(() => {
    const gain = gainNodeRef.current;
    if (!gain) return;

    if (isMuted) {
      const restored = preMuteVolumeRef.current || 0.8;
      volumeRef.current = restored;
      setVolumeState(restored);
      setIsMuted(false);
      gain.gain.setTargetAtTime(restored, gain.context.currentTime, 0.015);
    } else {
      preMuteVolumeRef.current = volumeRef.current;
      volumeRef.current = 0;
      setVolumeState(0);
      setIsMuted(true);
      gain.gain.setTargetAtTime(0, gain.context.currentTime, 0.015);
    }
  }, [isMuted]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
      }
      clearElapsedTimer();
      stopAllSources();

      const ws = wsRef.current;
      if (ws) {
        ws.close();
      }

      const ctx = audioCtxRef.current;
      if (ctx && ctx.state !== 'closed') {
        ctx.close();
      }
    };
  }, [clearElapsedTimer, stopAllSources]);

  return {
    playbackState,
    connectionStatus,
    currentMood,
    elapsed,
    segmentCount,
    analyserNode,
    volume,
    isMuted,
    currentSeed,
    isSeedLocked,
    connect,
    disconnect,
    start,
    startWithSeed,
    stop,
    pause,
    resume,
    changeMood,
    setVolume,
    toggleMute,
    lockSeed,
    unlockSeed,
    audioContext: audioContextState,
    gainNode: gainNodeState,
    decodedBuffers,
  };
}
