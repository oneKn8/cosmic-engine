import { useCallback, useEffect, useRef, useState } from 'react';
import type { SavedClip } from '../types.ts';

export interface AudioRecorderState {
  isRecording: boolean;
  recordingDuration: number;
  clipsSaved: number;
}

export interface AudioRecorderActions {
  saveClip: () => Promise<SavedClip | null>;
  startRecording: () => void;
  stopRecording: () => Promise<SavedClip | null>;
}

export type UseAudioRecorderReturn = AudioRecorderState & AudioRecorderActions;

interface UseAudioRecorderOptions {
  audioContext: AudioContext | null;
  gainNode: GainNode | null;
  decodedBuffers: AudioBuffer[];
  currentMood: string | null;
  currentSeed: number | null;
  onClipSaved?: (clip: SavedClip) => void;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Merge an array of AudioBuffers into a single WAV blob.
 * Handles multi-channel by mixing down to stereo or preserving channels.
 */
function mergeBuffersToWav(
  buffers: AudioBuffer[],
  maxSeconds: number,
): Blob | null {
  if (buffers.length === 0) return null;

  const sampleRate = buffers[0].sampleRate;
  const numChannels = Math.min(buffers[0].numberOfChannels, 2);
  const maxSamples = Math.floor(maxSeconds * sampleRate);

  // Calculate total samples across all buffers.
  let totalSamples = 0;
  for (const buf of buffers) {
    totalSamples += buf.length;
  }
  // Cap to maxSamples, taking from the END of the combined audio.
  const skipSamples = Math.max(0, totalSamples - maxSamples);
  const outputSamples = totalSamples - skipSamples;

  if (outputSamples <= 0) return null;

  // Interleave channel data.
  const interleaved = new Float32Array(outputSamples * numChannels);
  let writeOffset = 0;
  let samplesSkipped = 0;

  for (const buf of buffers) {
    const len = buf.length;
    const samplesToSkip = Math.min(len, skipSamples - samplesSkipped);
    samplesSkipped += samplesToSkip;

    const startSample = samplesToSkip;
    for (let s = startSample; s < len; s++) {
      for (let ch = 0; ch < numChannels; ch++) {
        interleaved[writeOffset++] = buf.getChannelData(ch)[s];
      }
    }
  }

  // Encode WAV.
  const bytesPerSample = 2; // 16-bit
  const dataLength = outputSamples * numChannels * bytesPerSample;
  const headerLength = 44;
  const wavBuffer = new ArrayBuffer(headerLength + dataLength);
  const view = new DataView(wavBuffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // sub-chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  // Write samples (clamp to 16-bit range).
  let offset = 44;
  for (let i = 0; i < interleaved.length; i++) {
    const sample = Math.max(-1, Math.min(1, interleaved[i]));
    const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return new Blob([wavBuffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

export function useAudioRecorder({
  audioContext,
  gainNode,
  decodedBuffers,
  currentMood,
  currentSeed,
  onClipSaved,
}: UseAudioRecorderOptions): UseAudioRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [clipsSaved, setClipsSaved] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingStartTimeRef = useRef<number>(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  // Cleanup timer on unmount.
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current !== null) {
        clearInterval(recordingTimerRef.current);
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  /**
   * Quick save: encode the rolling buffer (last ~30 seconds) into a WAV clip.
   */
  const saveClip = useCallback(async (): Promise<SavedClip | null> => {
    if (decodedBuffers.length === 0) return null;

    const blob = mergeBuffersToWav(decodedBuffers, 30);
    if (!blob) return null;

    // Calculate actual duration from the buffers.
    let duration = 0;
    for (const buf of decodedBuffers) {
      duration += buf.duration;
    }
    duration = Math.min(duration, 30);

    const clip: SavedClip = {
      id: generateId(),
      mood: currentMood ?? 'unknown',
      seed: currentSeed,
      duration,
      createdAt: Date.now(),
      blob,
    };

    setClipsSaved((prev) => prev + 1);
    onClipSaved?.(clip);

    return clip;
  }, [decodedBuffers, currentMood, currentSeed, onClipSaved]);

  /**
   * Start session recording via MediaRecorder on a MediaStreamDestination.
   */
  const startRecording = useCallback(() => {
    if (!audioContext || !gainNode) return;
    if (isRecording) return;

    // Create a MediaStreamDestination and connect the gain node to it.
    const dest = audioContext.createMediaStreamDestination();
    gainNode.connect(dest);
    destinationRef.current = dest;

    const recorder = new MediaRecorder(dest.stream, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm',
    });

    recordingChunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        recordingChunksRef.current.push(e.data);
      }
    };

    recorder.start(1000); // Collect data every second.
    mediaRecorderRef.current = recorder;
    recordingStartTimeRef.current = Date.now();
    setIsRecording(true);
    setRecordingDuration(0);

    // Duration tick.
    recordingTimerRef.current = setInterval(() => {
      setRecordingDuration(
        Math.floor((Date.now() - recordingStartTimeRef.current) / 1000),
      );
    }, 250);
  }, [audioContext, gainNode, isRecording]);

  /**
   * Stop session recording and return the recorded clip.
   */
  const stopRecording = useCallback(async (): Promise<SavedClip | null> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'recording') {
      setIsRecording(false);
      return null;
    }

    // Clear duration timer.
    if (recordingTimerRef.current !== null) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    // Disconnect the destination to avoid leaking the connection.
    const dest = destinationRef.current;
    if (dest && gainNode) {
      try {
        gainNode.disconnect(dest);
      } catch {
        // May already be disconnected.
      }
    }
    destinationRef.current = null;

    return new Promise((resolve) => {
      recorder.onstop = () => {
        const chunks = recordingChunksRef.current;
        if (chunks.length === 0) {
          setIsRecording(false);
          resolve(null);
          return;
        }

        const blob = new Blob(chunks, { type: recorder.mimeType });
        const duration = (Date.now() - recordingStartTimeRef.current) / 1000;

        const clip: SavedClip = {
          id: generateId(),
          mood: currentMood ?? 'unknown',
          seed: currentSeed,
          duration,
          createdAt: Date.now(),
          blob,
        };

        setClipsSaved((prev) => prev + 1);
        setIsRecording(false);
        setRecordingDuration(0);
        mediaRecorderRef.current = null;
        recordingChunksRef.current = [];
        onClipSaved?.(clip);
        resolve(clip);
      };

      recorder.stop();
    });
  }, [currentMood, currentSeed, gainNode, onClipSaved]);

  return {
    isRecording,
    recordingDuration,
    clipsSaved,
    saveClip,
    startRecording,
    stopRecording,
  };
}
