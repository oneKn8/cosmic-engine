"""Music generation engines - abstract interface with mock, API, and local implementations."""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import random
import sys
import tempfile
from abc import ABC, abstractmethod
from functools import partial
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np

if TYPE_CHECKING:
    from numpy.typing import NDArray

from app.config import settings
from app.moods import Mood, get_mood

logger = logging.getLogger(__name__)

# Type alias for the metadata dict returned alongside audio.
GenerationMetadata = dict[str, Any]


class MusicEngine(ABC):
    """Abstract base for audio generation backends."""

    @abstractmethod
    async def load(self) -> None:
        """Load model weights / initialise resources.  Called once at startup."""

    @abstractmethod
    async def generate(
        self,
        mood: str,
        duration: float,
        continuation_audio: NDArray[np.float32] | None = None,
        seed: int | None = None,
    ) -> tuple[NDArray[np.float32], GenerationMetadata]:
        """Generate a mono audio segment conditioned on *mood*.

        Args:
            mood: Name of a registered mood preset.
            duration: Desired length in seconds.
            continuation_audio: Optional tail of the previous segment (mono
                float32 at engine sample rate) used for seamless continuation.
                Engines that do not support continuation simply ignore it.
            seed: Optional random seed for reproducible generation.  If ``None``
                a random seed is chosen and reported in the returned metadata.

        Returns:
            A tuple of ``(audio, metadata)`` where *audio* is a 1-D float32
            numpy array at ``get_sample_rate()`` Hz and *metadata* is a dict
            containing at least ``{"seed": int}``.
        """

    @abstractmethod
    def get_sample_rate(self) -> int:
        """Return the native sample rate of the generated audio."""


# -- Real MusicGen engine -----------------------------------------------------


class MusicGenEngine(MusicEngine):
    """Production engine backed by Meta's MusicGen (via *audiocraft*)."""

    def __init__(self) -> None:
        self._model: object | None = None
        self._device: str = settings.resolved_device()
        self._sample_rate: int = settings.sample_rate

    async def load(self) -> None:
        """Load the MusicGen model in a thread so the event-loop isn't blocked."""
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self._load_sync)

    def _load_sync(self) -> None:
        from audiocraft.models import MusicGen  # type: ignore[import-untyped]

        logger.info(
            "Loading MusicGen model '%s' on %s ...",
            settings.model_name,
            self._device,
        )
        self._model = MusicGen.get_pretrained(
            settings.model_name, device=self._device
        )
        self._sample_rate = self._model.sample_rate  # type: ignore[union-attr]
        logger.info("MusicGen model loaded.  Sample rate: %d", self._sample_rate)

    async def generate(
        self,
        mood: str,
        duration: float,
        continuation_audio: NDArray[np.float32] | None = None,
        seed: int | None = None,
    ) -> tuple[NDArray[np.float32], GenerationMetadata]:
        """Generate audio in a thread-pool executor (model inference is blocking)."""
        if self._model is None:
            raise RuntimeError("Engine not loaded - call load() first")
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, partial(self._generate_sync, mood, duration, continuation_audio, seed)
        )

    def _generate_sync(
        self,
        mood: str,
        duration: float,
        continuation_audio: NDArray[np.float32] | None,
        seed: int | None,
    ) -> tuple[NDArray[np.float32], GenerationMetadata]:
        import torch  # noqa: WPS433

        mood_preset: Mood = get_mood(mood)
        model = self._model  # type: ignore[assignment]

        # -- Seed handling --
        if seed is None:
            seed = random.randint(0, 2**31 - 1)
        torch.manual_seed(seed)

        model.set_generation_params(  # type: ignore[union-attr]
            duration=duration,
            temperature=mood_preset.temperature,
            cfg_coef=mood_preset.guidance_scale,
        )

        with torch.no_grad():
            if continuation_audio is not None:
                # Reshape mono (samples,) -> (1, 1, samples) for audiocraft API
                prompt_waveform = torch.from_numpy(continuation_audio).unsqueeze(0).unsqueeze(0)
                prompt_waveform = prompt_waveform.to(self._device)
                wav = model.generate_continuation(  # type: ignore[union-attr]
                    prompt_waveform,
                    self._sample_rate,
                    descriptions=[mood_preset.prompt],
                    progress=False,
                )
            else:
                wav = model.generate([mood_preset.prompt])  # type: ignore[union-attr]

        # wav shape: (batch, channels, samples) -> squeeze to 1-D float32 numpy
        audio: NDArray[np.float32] = (
            wav[0, 0].cpu().numpy().astype(np.float32)
        )
        return audio, {"seed": seed}

    def get_sample_rate(self) -> int:
        return self._sample_rate


# -- Mock engine for local development without GPU ----------------------------


class MockEngine(MusicEngine):
    """Synthesises simple chord tones so the full pipeline can be tested locally.

    Each mood produces a distinct harmonic character with amplitude modulation
    to keep the output from being a static drone.
    """

    def __init__(self) -> None:
        self._sample_rate: int = settings.sample_rate

    async def load(self) -> None:
        logger.info("MockEngine loaded (sample rate %d)", self._sample_rate)

    async def generate(
        self,
        mood: str,
        duration: float,
        continuation_audio: NDArray[np.float32] | None = None,
        seed: int | None = None,
    ) -> tuple[NDArray[np.float32], GenerationMetadata]:
        """Generate a synthesised chord with amplitude modulation."""
        mood_preset: Mood = get_mood(mood)
        sr = self._sample_rate
        n_samples = int(duration * sr)
        t = np.linspace(0, duration, n_samples, endpoint=False, dtype=np.float32)

        signal = np.zeros(n_samples, dtype=np.float32)

        # Sum sine waves for each chord frequency with slight detuning
        for i, freq in enumerate(mood_preset.base_frequencies):
            # Slight random-ish detune per partial (deterministic from index)
            detune = 1.0 + (i * 0.0013)
            partial_signal = np.sin(
                2.0 * np.pi * freq * detune * t, dtype=np.float32
            )
            # Weight higher partials lower for a warmer sound
            weight = 1.0 / (1.0 + 0.4 * i)
            signal += partial_signal * weight

        # Normalise to prevent clipping before modulation
        peak = np.max(np.abs(signal))
        if peak > 0:
            signal /= peak

        # Amplitude modulation: slow LFO for movement
        mod_rate = mood_preset.modulation_rate
        lfo = 0.5 + 0.5 * np.sin(
            2.0 * np.pi * mod_rate * t, dtype=np.float32
        )
        signal *= lfo

        # Second, faster LFO for subtle shimmer
        shimmer = 0.85 + 0.15 * np.sin(
            2.0 * np.pi * (mod_rate * 3.7) * t, dtype=np.float32
        )
        signal *= shimmer

        # Gentle fade-in / fade-out to avoid clicks (50 ms each)
        fade_len = min(int(0.05 * sr), n_samples // 4)
        if fade_len > 0:
            fade_in = np.linspace(0.0, 1.0, fade_len, dtype=np.float32)
            fade_out = np.linspace(1.0, 0.0, fade_len, dtype=np.float32)
            signal[:fade_len] *= fade_in
            signal[-fade_len:] *= fade_out

        # Final normalise to 0.7 peak to leave headroom
        peak = np.max(np.abs(signal))
        if peak > 0:
            signal = signal * (0.7 / peak)

        return signal, {"seed": 0}

    def get_sample_rate(self) -> int:
        return self._sample_rate


class ReplicateEngine(MusicEngine):
    """Production engine that calls MusicGen via Replicate API -- no local GPU needed."""

    def __init__(self) -> None:
        self._sample_rate: int = 32000
        self._client: object | None = None

    async def load(self) -> None:
        """Validate the API token and initialise the Replicate client."""
        import replicate  # type: ignore[import-untyped]

        token = settings.replicate_api_token
        if not token:
            token = os.environ.get("REPLICATE_API_TOKEN", "")
        if not token:
            raise RuntimeError(
                "REPLICATE_API_TOKEN is required for ReplicateEngine. "
                "Get one at https://replicate.com/account/api-tokens"
            )
        self._client = replicate.Client(api_token=token)
        logger.info("ReplicateEngine loaded (model: %s)", settings.replicate_model)

    async def generate(
        self,
        mood: str,
        duration: float,
        continuation_audio: NDArray[np.float32] | None = None,
        seed: int | None = None,
    ) -> tuple[NDArray[np.float32], GenerationMetadata]:
        """Call Replicate's MusicGen API and return audio as numpy array."""
        if self._client is None:
            raise RuntimeError("Engine not loaded - call load() first")

        mood_preset: Mood = get_mood(mood)

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, partial(self._generate_sync, mood_preset, duration)
        )

    def _generate_sync(
        self, mood_preset: Mood, duration: float
    ) -> tuple[NDArray[np.float32], GenerationMetadata]:
        import httpx
        from scipy.io import wavfile  # type: ignore[import-untyped]

        client = self._client  # type: ignore[assignment]

        logger.info("Calling Replicate MusicGen: '%s' (%ss)", mood_preset.name, duration)

        output = client.run(
            settings.replicate_model,
            input={
                "prompt": mood_preset.prompt,
                "duration": int(duration),
                "model_version": "stereo-melody-large",
                "output_format": "wav",
                "normalization_strategy": "peak",
            },
        )

        # output is a URL string to the generated audio file
        audio_url = str(output)
        logger.info("Downloading generated audio from Replicate...")

        response = httpx.get(audio_url, timeout=60.0)
        response.raise_for_status()

        # Write to temp file, read with scipy
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as tmp:
            tmp.write(response.content)
            tmp.flush()
            sr, data = wavfile.read(tmp.name)

        # Convert to mono float32
        if data.ndim > 1:
            data = data.mean(axis=1)

        if data.dtype == np.int16:
            audio = data.astype(np.float32) / 32768.0
        elif data.dtype == np.int32:
            audio = data.astype(np.float32) / 2147483648.0
        elif data.dtype == np.float32:
            audio = data
        else:
            audio = data.astype(np.float32)

        # Resample if needed to match our configured sample rate
        if sr != self._sample_rate:
            from scipy.signal import resample  # type: ignore[import-untyped]

            target_len = int(len(audio) * self._sample_rate / sr)
            audio = resample(audio, target_len).astype(np.float32)

        logger.info(
            "Replicate generation complete: %d samples at %d Hz",
            len(audio),
            self._sample_rate,
        )
        return audio, {"seed": 0}

    def get_sample_rate(self) -> int:
        return self._sample_rate


# -- MIDI Transformer engine --------------------------------------------------

# Mood name -> training mood index (must match training data categories)
_MOOD_INDEX: dict[str, int] = {
    "cosmic": 0,
    "melancholic": 1,
    "night_drive": 2,
    "dream": 3,
    "tension": 4,
    "euphoria": 5,
    "rain": 6,
    "horizon": 7,
}


class MidiTransformerEngine(MusicEngine):
    """Inference engine that loads a trained MIDI Transformer checkpoint,
    generates MIDI token sequences autoregressively, converts to MIDI via
    miditok, and synthesises audio through FluidSynth.

    Designed for CPU inference on machines without a GPU.
    """

    def __init__(self) -> None:
        self._model: object | None = None
        self._tokenizer: object | None = None
        self._sample_rate: int = settings.sample_rate
        self._model_dir: Path = Path(settings.midi_model_dir)
        self._soundfont_path: str = settings.soundfont_path

    async def load(self) -> None:
        """Load model weights, config, and tokenizer in a thread executor."""
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self._load_sync)

    def _load_sync(self) -> None:
        import torch
        from miditok import REMI

        model_dir = self._model_dir

        # --- Load model config ---
        config_path = model_dir / "model_config.json"
        if not config_path.exists():
            raise FileNotFoundError(
                f"Model config not found at {config_path}. "
                f"Run export_model.py first."
            )

        with open(config_path) as f:
            model_config_dict = json.load(f)

        # --- Import the model class from the training module ---
        # Add training directory to sys.path so we can import model.py
        training_dir = str(Path(__file__).resolve().parents[2] / "training")
        if training_dir not in sys.path:
            sys.path.insert(0, training_dir)

        from model import MidiTransformer, MidiTransformerConfig  # type: ignore[import-not-found]

        config = MidiTransformerConfig(**model_config_dict)
        self._model = MidiTransformer(config)

        # --- Load state dict ---
        weights_path = model_dir / "model.pt"
        if not weights_path.exists():
            raise FileNotFoundError(
                f"Model weights not found at {weights_path}. "
                f"Run export_model.py first."
            )

        state_dict = torch.load(
            weights_path, map_location="cpu", weights_only=True,
        )
        self._model.load_state_dict(state_dict)  # type: ignore[union-attr]
        self._model.eval()  # type: ignore[union-attr]
        self._model = self._model.float()  # type: ignore[union-attr]

        logger.info(
            "MIDI Transformer loaded from %s (%s params, device=cpu)",
            model_dir,
            f"{self._model.num_parameters() / 1e6:.2f}M",  # type: ignore[union-attr]
        )

        # --- Load miditok tokenizer ---
        tokenizer_path = model_dir / "tokenizer.json"
        if not tokenizer_path.exists():
            raise FileNotFoundError(
                f"Tokenizer not found at {tokenizer_path}. "
                f"Run export_model.py first."
            )

        self._tokenizer = REMI(params=str(tokenizer_path))
        logger.info("REMI tokenizer loaded (%d tokens)", len(self._tokenizer))

        # --- Validate soundfont ---
        if not os.path.isfile(self._soundfont_path):
            logger.warning(
                "SoundFont not found at %s. FluidSynth will fail. "
                "Install: sudo apt install fluid-soundfont-gm",
                self._soundfont_path,
            )

    async def generate(
        self,
        mood: str,
        duration: float,
        continuation_audio: NDArray[np.float32] | None = None,
        seed: int | None = None,
    ) -> tuple[NDArray[np.float32], GenerationMetadata]:
        """Generate audio: MIDI tokens -> MIDI file -> FluidSynth -> numpy array."""
        if self._model is None or self._tokenizer is None:
            raise RuntimeError("Engine not loaded -- call load() first")

        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None, partial(self._generate_sync, mood, duration, seed),
        )

    def _generate_sync(
        self, mood: str, duration: float, seed: int | None
    ) -> tuple[NDArray[np.float32], GenerationMetadata]:
        import torch
        from midi2audio import FluidSynth
        from scipy.io import wavfile  # type: ignore[import-untyped]

        mood_preset: Mood = get_mood(mood)
        mood_idx = _MOOD_INDEX.get(mood)

        # -- Seed handling --
        if seed is None:
            seed = random.randint(0, 2**31 - 1)
        torch.manual_seed(seed)

        # Estimate how many tokens we need.
        # REMI encodes roughly 8-12 tokens per beat. With mood BPM and
        # requested duration, compute a generous upper bound so the model
        # produces enough MIDI content. Pad by 1.5x to ensure we have
        # enough material (we trim the audio to exact duration afterwards).
        beats = (mood_preset.bpm / 60.0) * duration
        tokens_per_beat = 12  # conservative upper estimate for REMI
        estimated_tokens = int(beats * tokens_per_beat * 1.5)
        # Clamp to model's max_seq_len minus prompt length
        max_gen = min(estimated_tokens, self._model.config.max_seq_len - 1)  # type: ignore[union-attr]
        max_gen = max(max_gen, 128)  # at least 128 tokens

        logger.info(
            "Generating MIDI: mood=%s (idx=%s), duration=%.1fs, max_tokens=%d, temp=%.2f, seed=%d",
            mood, mood_idx, duration, max_gen, mood_preset.temperature, seed,
        )

        # --- BOS token as prompt ---
        # miditok tokenizers expose a vocab; the special BOS token is
        # typically index 0 or accessible via the tokenizer. We use the
        # tokenizer's vocab to find it, falling back to 0.
        bos_id = 0
        vocab = self._tokenizer.vocab  # type: ignore[union-attr]
        for name, idx in vocab.items():
            if "BOS" in str(name).upper():
                bos_id = idx
                break

        prompt = torch.tensor([[bos_id]], dtype=torch.long)

        # --- Generate token sequence ---
        # Find EOS token for early stopping if available
        eos_id = None
        for name, idx in vocab.items():
            if "EOS" in str(name).upper():
                eos_id = idx
                break

        generated_ids = self._model.generate(  # type: ignore[union-attr]
            prompt_ids=prompt,
            mood_id=mood_idx,
            max_len=max_gen,
            temperature=mood_preset.temperature,
            top_k=50,
            top_p=0.92,
            eos_token_id=eos_id,
        )

        # generated_ids shape: (1, total_len) including prompt
        token_ids = generated_ids[0].tolist()
        logger.info("Generated %d tokens", len(token_ids))

        # --- Decode tokens back to MIDI Score via miditok ---
        score = self._tokenizer.decode(token_ids)  # type: ignore[union-attr]

        # --- Write MIDI to temp file, synthesise with FluidSynth ---
        with tempfile.TemporaryDirectory() as tmpdir:
            midi_path = os.path.join(tmpdir, "generated.mid")
            wav_path = os.path.join(tmpdir, "generated.wav")

            score.dump_midi(midi_path)

            fs = FluidSynth(
                sound_font=self._soundfont_path,
                sample_rate=self._sample_rate,
            )
            fs.midi_to_audio(midi_path, wav_path)

            sr, data = wavfile.read(wav_path)

        # --- Convert to mono float32 ---
        if data.ndim > 1:
            data = data.mean(axis=1)

        if data.dtype == np.int16:
            audio = data.astype(np.float32) / 32768.0
        elif data.dtype == np.int32:
            audio = data.astype(np.float32) / 2147483648.0
        elif data.dtype == np.float32:
            audio = data
        else:
            audio = data.astype(np.float32)

        # --- Resample if FluidSynth output rate differs ---
        if sr != self._sample_rate:
            from scipy.signal import resample  # type: ignore[import-untyped]

            target_len = int(len(audio) * self._sample_rate / sr)
            audio = resample(audio, target_len).astype(np.float32)

        # --- Trim or pad to exact requested duration ---
        target_samples = int(duration * self._sample_rate)
        if len(audio) > target_samples:
            audio = audio[:target_samples]
        elif len(audio) < target_samples:
            pad = np.zeros(target_samples - len(audio), dtype=np.float32)
            audio = np.concatenate([audio, pad])

        # --- Post-processing: gentle synthetic reverb ---
        audio = self._apply_reverb(audio, self._sample_rate)

        # --- Fade in/out to avoid clicks (50 ms each) ---
        fade_len = min(int(0.05 * self._sample_rate), len(audio) // 4)
        if fade_len > 0:
            fade_in = np.linspace(0.0, 1.0, fade_len, dtype=np.float32)
            fade_out = np.linspace(1.0, 0.0, fade_len, dtype=np.float32)
            audio[:fade_len] *= fade_in
            audio[-fade_len:] *= fade_out

        # --- Final normalise to 0.7 peak headroom ---
        peak = np.max(np.abs(audio))
        if peak > 0:
            audio = audio * (0.7 / peak)

        logger.info(
            "MIDI Transformer generation complete: %d samples (%.1fs) at %d Hz, seed=%d",
            len(audio), len(audio) / self._sample_rate, self._sample_rate, seed,
        )
        return audio, {"seed": seed}

    @staticmethod
    def _apply_reverb(
        audio: NDArray[np.float32],
        sample_rate: int,
        decay_time: float = 1.5,
        wet_mix: float = 0.25,
    ) -> NDArray[np.float32]:
        """Apply a gentle synthetic reverb using convolution with an
        exponential-decay impulse response.

        This softens the dry MIDI synthesis output without requiring an
        external reverb plugin.

        Args:
            audio: Input audio signal (1-D float32).
            sample_rate: Sample rate in Hz.
            decay_time: RT60-like decay time in seconds.
            wet_mix: Blend ratio of wet signal (0.0 = dry, 1.0 = full wet).

        Returns:
            Blended audio with reverb applied.
        """
        from scipy.signal import fftconvolve  # type: ignore[import-untyped]

        # Build a simple exponential-decay impulse response with early
        # reflections modelled as a sparse noise burst followed by a
        # smooth tail.
        ir_len = int(decay_time * sample_rate)
        if ir_len < 1:
            return audio

        t = np.arange(ir_len, dtype=np.float32) / sample_rate

        # Exponential decay envelope
        decay_rate = -6.9 / decay_time  # ln(0.001) ~ -6.9 for -60 dB
        envelope = np.exp(decay_rate * t).astype(np.float32)

        # Noise excitation for diffuse tail
        rng = np.random.default_rng(42)  # deterministic for reproducibility
        noise = rng.standard_normal(ir_len).astype(np.float32)

        # Early reflections: a few sparse taps in the first 50 ms
        early = np.zeros(ir_len, dtype=np.float32)
        tap_positions = [
            int(0.007 * sample_rate),
            int(0.013 * sample_rate),
            int(0.023 * sample_rate),
            int(0.037 * sample_rate),
        ]
        for pos in tap_positions:
            if pos < ir_len:
                early[pos] = 0.6

        ir = early + noise * envelope
        # Normalise the IR so it doesn't blow up the signal
        ir_peak = np.max(np.abs(ir))
        if ir_peak > 0:
            ir /= ir_peak

        # Convolve and blend
        wet = fftconvolve(audio, ir, mode="full")[:len(audio)].astype(np.float32)
        blended = (1.0 - wet_mix) * audio + wet_mix * wet
        return blended

    def get_sample_rate(self) -> int:
        return self._sample_rate


def create_engine() -> MusicEngine:
    """Factory: return the appropriate engine based on configuration."""
    engine_type = settings.engine_type.lower()

    if engine_type == "mock":
        logger.info("Using MockEngine")
        return MockEngine()
    elif engine_type == "replicate":
        logger.info("Using ReplicateEngine (API-based, no GPU required)")
        return ReplicateEngine()
    elif engine_type == "musicgen":
        logger.info("Using MusicGenEngine (local GPU, model=%s)", settings.model_name)
        return MusicGenEngine()
    elif engine_type == "midi_transformer":
        logger.info(
            "Using MidiTransformerEngine (CPU, model_dir=%s)",
            settings.midi_model_dir,
        )
        return MidiTransformerEngine()
    else:
        raise ValueError(
            f"Unknown engine_type '{engine_type}'. "
            f"Use: mock, replicate, musicgen, or midi_transformer"
        )
