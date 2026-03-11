import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAudioStream } from './hooks/useAudioStream.ts';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.ts';
import { useSessionStats } from './hooks/useSessionStats.ts';
import { useAudioRecorder } from './hooks/useAudioRecorder.ts';
import { useLibrary } from './hooks/useLibrary.ts';
import { Visualizer } from './components/Visualizer.tsx';
import { Transport } from './components/Transport.tsx';
import { MoodSelector } from './components/MoodSelector.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { ParticleBackground } from './components/ParticleBackground.tsx';
import { KeyboardHelp } from './components/KeyboardHelp.tsx';
import { SessionStats } from './components/SessionStats.tsx';
import { Library } from './components/Library.tsx';
import { getMoodColor } from './types.ts';
import type { Mood, SavedClip } from './types.ts';

const DEFAULT_MOOD = 'cosmic';

function App() {
  const {
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
    start,
    stop,
    pause,
    resume,
    changeMood,
    setVolume,
    toggleMute,
    lockSeed,
    unlockSeed,
    audioContext,
    gainNode,
    decodedBuffers,
  } = useAudioStream();

  const moodsRef = useRef<Mood[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const sessionStats = useSessionStats(playbackState, currentMood);

  const moodColor = useMemo(() => getMoodColor(currentMood ?? DEFAULT_MOOD), [currentMood]);

  // Library hook
  const library = useLibrary();

  // Audio recorder hook
  const handleClipSaved = useCallback(
    (clip: SavedClip) => {
      library.addClip(clip);
    },
    [library],
  );

  const recorder = useAudioRecorder({
    audioContext,
    gainNode,
    decodedBuffers,
    currentMood,
    currentSeed,
    onClipSaved: handleClipSaved,
  });

  // Connect to WebSocket on mount
  useEffect(() => {
    connect();
  }, [connect]);

  // Get current mood data for Transport
  const currentMoodData = useMemo(() => {
    if (!currentMood) return null;
    return moodsRef.current.find((m) => m.name === currentMood) ?? null;
  }, [currentMood]);

  // Update CSS custom property for mood-based background gradient
  useEffect(() => {
    document.documentElement.style.setProperty('--mood-color', moodColor);
  }, [moodColor]);

  const handleSelectMood = useCallback(
    (moodName: string) => {
      if (playbackState === 'playing' || playbackState === 'paused' || playbackState === 'generating') {
        changeMood(moodName);
      } else {
        start(moodName);
      }
    },
    [playbackState, changeMood, start],
  );

  const handleStart = useCallback(() => {
    const mood = currentMood ?? DEFAULT_MOOD;
    start(mood);
  }, [currentMood, start]);

  const handleSelectMoodByIndex = useCallback(
    (index: number) => {
      const moods = moodsRef.current;
      if (index >= 0 && index < moods.length) {
        handleSelectMood(moods[index].name);
      }
    },
    [handleSelectMood],
  );

  const toggleHelp = useCallback(() => {
    setShowHelp((prev) => !prev);
  }, []);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  const handleSaveClip = useCallback(() => {
    recorder.saveClip();
  }, [recorder]);

  const handleStopRecording = useCallback(() => {
    recorder.stopRecording();
  }, [recorder]);

  const canSave = decodedBuffers.length > 0 && (playbackState === 'playing' || playbackState === 'paused');

  // Keyboard shortcuts
  useKeyboardShortcuts({
    playbackState,
    volume,
    onStart: handleStart,
    onStop: stop,
    onPause: pause,
    onResume: resume,
    onToggleMute: toggleMute,
    onVolumeChange: setVolume,
    onSelectMood: handleSelectMoodByIndex,
    onToggleHelp: toggleHelp,
    onToggleFullscreen: toggleFullscreen,
    onToggleLibrary: library.toggleLibrary,
    onSaveClip: canSave ? handleSaveClip : undefined,
    onToggleRecording: playbackState === 'playing'
      ? (recorder.isRecording ? handleStopRecording : recorder.startRecording)
      : undefined,
  });

  const isActive = playbackState === 'playing' || playbackState === 'generating';

  // Transport props shared between fullscreen and normal mode.
  const transportProps = {
    playbackState,
    currentMood,
    currentMoodData,
    elapsed,
    segmentCount,
    moodColor,
    volume,
    isMuted,
    isFullscreen,
    currentSeed,
    isSeedLocked,
    isRecording: recorder.isRecording,
    recordingDuration: recorder.recordingDuration,
    clipCount: library.clips.length,
    canSave,
    onStart: handleStart,
    onStop: stop,
    onPause: pause,
    onResume: resume,
    onVolumeChange: setVolume,
    onToggleMute: toggleMute,
    onToggleFullscreen: toggleFullscreen,
    onLockSeed: lockSeed,
    onUnlockSeed: unlockSeed,
    onSaveClip: handleSaveClip,
    onStartRecording: recorder.startRecording,
    onStopRecording: handleStopRecording,
    onOpenLibrary: library.openLibrary,
  };

  // Fullscreen immersive mode
  if (isFullscreen) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          animation: 'fullscreen-fade 400ms ease',
        }}
      >
        {/* Particle background */}
        <ParticleBackground
          analyserNode={analyserNode}
          moodColor={moodColor}
          isPlaying={isActive}
        />

        {/* Visualizer takes center stage */}
        <div
          style={{
            position: 'relative',
            zIndex: 1,
            width: '100%',
            maxWidth: '800px',
          }}
        >
          <Visualizer
            analyserNode={analyserNode}
            moodColor={moodColor}
            isPlaying={isActive}
            height="60vh"
          />
        </div>

        {/* Minimal transport */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <Transport {...transportProps} />
        </div>

        {/* Fullscreen hint */}
        <div
          style={{
            position: 'fixed',
            bottom: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            fontSize: '0.65rem',
            color: 'rgba(107, 107, 123, 0.4)',
            zIndex: 1,
          }}
        >
          Press F to exit fullscreen | ? for help
        </div>

        {/* Keyboard help overlay */}
        <KeyboardHelp isOpen={showHelp} onClose={toggleHelp} moodColor={moodColor} />

        {/* Library panel */}
        <Library
          isOpen={library.isOpen}
          clips={library.clips}
          moodColor={moodColor}
          onClose={library.closeLibrary}
          onDeleteClip={library.deleteClip}
          onDownloadClip={library.downloadClip}
          onRenameClip={library.renameClip}
        />
      </div>
    );
  }

  // Normal mode
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        maxWidth: '1024px',
        margin: '0 auto',
        paddingBottom: '48px',
        width: '100%',
        zIndex: 1,
      }}
    >
      {/* Particle background */}
      <ParticleBackground
        analyserNode={analyserNode}
        moodColor={moodColor}
        isPlaying={isActive}
      />

      {/* Header */}
      <header
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: '24px',
          paddingBottom: '4px',
          gap: '8px',
        }}
      >
        <h1
          style={{
            color: moodColor,
            fontSize: '1.125rem',
            fontWeight: 300,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            transition: 'color 500ms',
          }}
        >
          Cosmic Engine
        </h1>

        {/* Session stats */}
        <SessionStats
          totalListeningTime={sessionStats.totalListeningTime}
          moodsExplored={sessionStats.moodsExplored.size}
          moodColor={moodColor}
          isVisible={sessionStats.totalListeningTime > 0}
        />
      </header>

      {/* Visualizer */}
      <section style={{ flexShrink: 0, padding: '0 16px' }}>
        <Visualizer
          analyserNode={analyserNode}
          moodColor={moodColor}
          isPlaying={isActive}
        />
      </section>

      {/* Transport controls */}
      <section style={{ flexShrink: 0, padding: '4px 0' }}>
        <Transport {...transportProps} />
      </section>

      {/* Mood selector */}
      <section style={{ flex: 1, paddingTop: '8px' }}>
        <MoodSelector
          activeMood={currentMood}
          playbackState={playbackState}
          onSelectMood={handleSelectMood}
          onMoodsLoaded={(moods) => { moodsRef.current = moods; }}
        />
      </section>

      {/* Status bar */}
      <StatusBar connectionStatus={connectionStatus} />

      {/* Keyboard help overlay */}
      <KeyboardHelp isOpen={showHelp} onClose={toggleHelp} moodColor={moodColor} />

      {/* Library panel */}
      <Library
        isOpen={library.isOpen}
        clips={library.clips}
        moodColor={moodColor}
        onClose={library.closeLibrary}
        onDeleteClip={library.deleteClip}
        onDownloadClip={library.downloadClip}
        onRenameClip={library.renameClip}
      />
    </div>
  );
}

export default App;
