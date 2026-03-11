# Adaptive Streaming, Save System, and Consistency

## Problem

1. UI shows "playing" before any audio arrives -- misleading
2. Each segment sounds different -- no musical continuity between segments
3. No way to save audio you like -- good generations lost forever
4. Fixed segment duration doesn't adapt to device speed

## Design

### 1. Adaptive Generation Pipeline

Backend measures generation speed on first segment and auto-adjusts.

**Flow:**
- First play: UI shows "Generating first segment..." with pulsing animation
- Timer does NOT start until first audio chunk arrives at browser
- Backend measures wall-clock time for first generation
- Computes generation_ratio = generation_time / segment_duration
- Auto-adjusts segment_duration:
  - GPU (ratio < 0.5): 15 seconds
  - Fast CPU (ratio 0.5-2): 10 seconds
  - Slow CPU (ratio 2-6): 5 seconds
  - Very slow (ratio > 6): 3 seconds
- Crossfade duration scales proportionally (min 0.5s, max 2s)
- Buffer target: always 1-2 segments ahead of playback
- If buffer empties: show brief "Generating..." overlay, don't play silence

**Backend changes (streaming.py):**
- Add generation timing to StreamSession
- Add adaptive segment_duration calculation after first generate()
- Add buffer queue depth tracking
- Report buffer health in status messages

**Frontend changes:**
- New PlaybackState: "generating" (distinct from "playing")
- Show generating indicator when connected but no audio yet
- Show brief buffering indicator if buffer runs dry mid-session
- Timer starts only when first audio chunk plays

### 2. Continuation Mode

Feed previous audio into next generation for musical coherence.

**Backend changes (engine.py MusicGenEngine):**
- Store last 3 seconds of generated audio as continuation_prompt
- On next generate(), use model.generate_continuation() instead of model.generate()
- First segment of a mood uses text prompt only
- Subsequent segments: text prompt + audio continuation
- On mood change: first segment uses new mood text prompt only, then continuation resumes

**Result:** Each segment is a natural musical extension of the previous one. Combined with crossfade, it sounds like one continuous evolving piece.

### 3. Seed Locking

Capture the random seed for any generation to recreate it later.

**Backend changes:**
- Track random seed per generation (torch manual_seed)
- Include seed in status messages sent to frontend
- Accept optional seed parameter in start/change_mood commands
- New endpoint: POST /api/preset with {mood, seed, generation_params}

**Frontend changes:**
- Display current seed in UI (small, non-intrusive)
- Lock icon on transport: saves current seed + mood as a "tone preset"
- Presets stored in IndexedDB
- Library panel shows presets, click to replay from that seed
- Preset format: {mood, seed, timestamp, name (optional)}

### 4. Save System

**Quick Save (clip):**
- Heart/bookmark icon on transport bar
- Saves last 30 seconds of audio (rolling buffer in frontend)
- Frontend keeps a circular buffer of recent decoded AudioBuffers
- On save: concatenate buffers, encode to OGG via Web Audio API + MediaRecorder
- Store in IndexedDB with metadata: mood, seed, duration, timestamp
- ~1 MB per 30 seconds (OGG compressed)

**Session Recording:**
- Record toggle (red dot) on transport bar
- Uses MediaRecorder API on the AudioContext destination
- Shows recording duration + estimated file size
- On stop: save as OGG file
- Under 1 hour: single file, offer download
- Over 1 hour: auto-split into chapter files

**Library panel (sidebar/drawer):**
- Lists saved clips and sessions
- Each entry: mood color dot, name/mood, duration, date
- Click to replay (clips play directly, sessions download)
- Delete button per entry
- Storage in IndexedDB (clips) + filesystem download prompt (large sessions)

### 5. Seamless Crossfade (tuning existing)

Already built with raised-cosine blending. Adjustments:

- Crossfade duration adapts to segment duration:
  - 15s segments: 2s crossfade
  - 10s segments: 1.5s crossfade
  - 5s segments: 1s crossfade
  - 3s segments: 0.5s crossfade
- Continuation mode makes crossfades nearly imperceptible since segments are musically related
- On mood change: slightly longer crossfade (1.5x normal) for smooth transition

## Implementation Order

1. Adaptive pipeline + loading state fix (highest impact, fixes current broken UX)
2. Continuation mode (fixes consistency, biggest quality improvement)
3. Save system -- quick save first, then session recording
4. Seed locking + presets
5. Library panel

## File Changes

**Backend:**
- backend/app/streaming.py -- adaptive timing, buffer management
- backend/app/engine.py -- continuation mode, seed tracking
- backend/app/main.py -- new endpoints, seed in WebSocket protocol

**Frontend:**
- frontend/src/hooks/useAudioStream.ts -- generating state, rolling buffer, save
- frontend/src/components/Transport.tsx -- save buttons, record toggle, lock icon
- frontend/src/components/Library.tsx -- new component, saved clips panel
- frontend/src/components/GeneratingOverlay.tsx -- new component, loading state
- frontend/src/App.tsx -- library panel integration
- frontend/src/hooks/useLibrary.ts -- new hook, IndexedDB storage
