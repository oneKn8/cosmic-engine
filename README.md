# Cosmic Engine

**Infinite AI music that never repeats. Pick a mood. Press play. Listen forever.**

Cosmic Engine is a real-time AI music generator that runs in your browser. A custom-trained 35M-parameter transformer model generates MIDI token sequences conditioned on mood, synthesizes them to audio with FluidSynth, and streams the result over WebSocket -- producing an endless, evolving soundtrack that responds to how you want to feel.

This is not procedural generation with random notes. This is a neural network that learned music from 178,000 MIDI files and generates coherent, mood-appropriate compositions from scratch, one token at a time.

---

## How It Works

```
Mood Selection --> MIDI Token Generation --> FluidSynth Synthesis --> WebSocket Stream --> Web Audio API
```

1. **You pick a mood.** Eight distinct emotional presets, each with tuned generation parameters -- temperature, guidance scale, BPM, and harmonic frequency profiles.

2. **The transformer generates MIDI tokens.** A GPT-2-style causal model with Rotary Positional Embeddings (RoPE) and mood conditioning autoregressively generates REMI-tokenized MIDI sequences. Top-k/top-p nucleus sampling with per-mood temperature controls the creative range.

3. **FluidSynth renders audio.** Raw MIDI token sequences are decoded back to MIDI events and synthesized to 32kHz audio using FluidSynth with GM soundfonts. Convolution reverb, normalization, and fade curves are applied.

4. **Adaptive streaming delivers it.** The backend measures generation speed and dynamically adjusts segment duration (3--15 seconds) to stay ahead of playback. Segments are crossfaded with a raised-cosine window and streamed as WAV chunks over WebSocket. A pre-generation buffer prefetches the next segment while the current one plays.

5. **Gapless playback in the browser.** The Web Audio API schedules buffers with sample-accurate timing for seamless transitions. A real-time frequency visualizer renders the audio. No gaps. No clicks. No interruptions.

---

## Features

- **8 mood presets** -- Cosmic, Melancholic, Night Drive, Dream, Tension, Euphoria, Rain, Horizon -- each with distinct harmonic profiles, BPM, and generation parameters
- **4 engine backends** -- swap between mock (development), MusicGen (local GPU), Replicate (cloud API), and MIDI Transformer (production) with a single environment variable
- **Adaptive segment generation** -- backend self-tunes segment duration based on generation throughput to prevent buffer underruns
- **Raised-cosine crossfade** -- smooth transitions between generated segments with configurable overlap
- **Pre-generation buffer** -- next segment generates while the current one plays
- **Real-time audio visualization** -- frequency spectrum analyzer driven by Web Audio API
- **Save and record** -- bookmark clips instantly or record full sessions; audio stored locally in IndexedDB
- **Library panel** -- browse, replay, and manage saved recordings
- **Seed control** -- lock a generation seed to reproduce a specific musical passage
- **Fullscreen immersive mode** -- distraction-free listening with visualization
- **Keyboard-driven** -- full shortcut support for hands-free control
- **Dark UI** -- designed for ambient listening, not productivity software

---

## Moods

| Mood | BPM | Character |
|------|-----|-----------|
| Cosmic | 85 | Deep space ambient with evolving synthesizer pads |
| Melancholic | 70 | Emotional piano with cinematic ambient pads |
| Night Drive | 100 | Synthwave with driving bass and neon arpeggios |
| Dream | 78 | Shoegaze-ambient with floating guitar textures |
| Tension | 90 | Dark cinematic suspense with building strings |
| Euphoria | 128 | Uplifting trance with ascending bright melodies |
| Rain | 75 | Lo-fi ambient piano with warm rain atmosphere |
| Horizon | 95 | Post-rock crescendo with delayed guitars building to climax |

---

## Architecture

```
frontend/                    React + Vite + TypeScript
  src/
    hooks/
      useKeyboardShortcuts   Keyboard shortcut handler
      useAudioRecorder        Rolling buffer save/record system
      useLibrary              IndexedDB storage layer
    components/
      Transport               Playback controls, seed lock, status
      SaveControls            Bookmark, record, library toggle
      Library                 Slide-out saved recordings panel

backend/                     FastAPI + Python
  app/
    config.py                Pydantic settings from environment
    moods.py                 8 mood presets with generation parameters
    engines/
      mock.py                Sine-wave test engine
      musicgen.py            Meta MusicGen (local GPU inference)
      replicate.py           Replicate API client
      midi_transformer.py    Production engine: MIDI generation + FluidSynth

training/                    Full training pipeline
  model.py                   35M-param transformer (RoPE, mood conditioning)
  train.py                   Training loop (AdamW, cosine LR, gradient clipping)
  export_model.py            Export state dict + config + optional ONNX
  scripts/                   GPU setup, data download, run automation
  data/                      Lakh MIDI dataset processing
```

---

## The Model

The MIDI Transformer is a GPT-2-style causal language model purpose-built for music generation.

| Parameter | Value |
|-----------|-------|
| Parameters | ~35M |
| Embedding dim | 512 |
| Attention heads | 8 |
| Transformer layers | 8 |
| FFN dim | 2048 |
| Max sequence length | 1024 tokens |
| Positional encoding | Rotary (RoPE) |
| Activation | GELU |
| Normalization | Pre-norm (LayerNorm) |
| Attention | PyTorch SDPA (FlashAttention when available) |
| Weight tying | Token embedding tied to LM head |
| Tokenization | REMI (relative MIDI encoding) |
| Mood conditioning | Learned embedding added to token embeddings |
| Sampling | Top-k + nucleus (top-p) with temperature |
| Training data | Lakh MIDI Dataset (~178K files) |
| Optimizer | AdamW, cosine schedule, 1000-step warmup |

---

## Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+
- FluidSynth and a GM soundfont (for MIDI Transformer engine)

```bash
# Install FluidSynth (Ubuntu/Debian)
sudo apt install fluidsynth fluid-soundfont-gm
```

### Backend

```bash
cd backend

# Create virtualenv and install dependencies
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Start with mock engine (no GPU needed)
ENGINE_TYPE=mock python -m uvicorn app.main:app --host 0.0.0.0 --port 8888

# Or with the trained MIDI Transformer model
ENGINE_TYPE=midi_transformer MIDI_MODEL_DIR=./exported python -m uvicorn app.main:app --host 0.0.0.0 --port 8888
```

### Frontend

```bash
cd frontend

npm install
npm run dev
```

Open `http://localhost:5173` in your browser. Pick a mood. Press play.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENGINE_TYPE` | `mock` | Engine backend: `mock`, `musicgen`, `replicate`, `midi_transformer` |
| `MODEL_NAME` | `facebook/musicgen-small` | HuggingFace model ID (MusicGen engine) |
| `DEVICE` | `auto` | PyTorch device: `auto`, `cpu`, `cuda` |
| `SAMPLE_RATE` | `32000` | Audio sample rate in Hz |
| `MIDI_MODEL_DIR` | `./exported` | Path to exported MIDI Transformer weights |
| `SOUNDFONT_PATH` | `/usr/share/sounds/sf2/FluidR3_GM.sf2` | FluidSynth soundfont file |
| `REPLICATE_API_TOKEN` | -- | Replicate API key (Replicate engine only) |
| `SEGMENT_DURATION` | `15.0` | Base segment duration in seconds |
| `CROSSFADE_DURATION` | `2.0` | Crossfade overlap in seconds |
| `PORT` | `8888` | Backend server port |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause / Resume |
| `Escape` | Stop |
| `1`--`8` | Select mood |
| `M` | Toggle mute |
| `Up` / `Down` | Volume up / down |
| `F` | Toggle fullscreen |
| `S` | Save current clip |
| `R` | Toggle recording |
| `L` | Toggle library panel |
| `?` | Toggle help overlay |

---

## Training Your Own Model

The full training pipeline is included. You need a GPU with at least 16GB VRAM.

```bash
cd training

# Install training dependencies
pip install -r requirements.txt

# Prepare the Lakh MIDI dataset (downloads + tokenizes ~178K files)
python scripts/prepare_data.py

# Train (100K steps, ~35-40 hours on A4000)
python train.py

# Export for inference
python export_model.py --checkpoint checkpoints/best.pt --output ../backend/exported/
```

Training configuration lives in `training/configs/`. The default config trains with batch size 16, learning rate 3e-4, cosine schedule with 1000-step warmup, and saves checkpoints every 5000 steps.

---

## Tech Stack

**Frontend:** React, Vite, TypeScript, Web Audio API, IndexedDB

**Backend:** FastAPI, Python, WebSocket, FluidSynth, NumPy/SciPy

**Model:** PyTorch, custom GPT-2 architecture, REMI tokenization

**Infrastructure:** Runs on CPU (mock/MIDI Transformer) or GPU (MusicGen). Cloud option via Replicate API.

---

## License

MIT
