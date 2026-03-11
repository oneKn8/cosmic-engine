"""Streaming session manager -- handles per-client infinite generation loops."""

from __future__ import annotations

import asyncio
import io
import logging
import struct
import time
from enum import Enum, auto
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    from numpy.typing import NDArray

from app.config import settings
from app.engine import MusicEngine

logger = logging.getLogger(__name__)

# -- Adaptive segment/crossfade duration tables --------------------------------
# Maps generation_ratio thresholds to (segment_duration, crossfade_duration).
# Ordered from fastest (lowest ratio) to slowest (highest ratio).
_ADAPTIVE_TIERS: list[tuple[float, float, float]] = [
    # (max_ratio, segment_seconds, crossfade_seconds)
    (0.5, 15.0, 2.0),   # GPU fast: ratio < 0.5
    (2.0, 10.0, 1.5),   # ratio 0.5 - 2.0
    (6.0, 5.0, 1.0),    # ratio 2.0 - 6.0
]
_SLOWEST_TIER = (3.0, 0.5)  # ratio > 6: segment=3s, crossfade=0.5s


def _adaptive_durations(generation_ratio: float) -> tuple[float, float]:
    """Return ``(segment_duration, crossfade_duration)`` for a given ratio.

    The generation ratio is ``wall_clock_time / audio_duration``.  A ratio
    below 1.0 means the engine generates faster than real-time.
    """
    for max_ratio, seg_dur, xfade_dur in _ADAPTIVE_TIERS:
        if generation_ratio < max_ratio:
            return seg_dur, xfade_dur
    return _SLOWEST_TIER


class SessionState(Enum):
    """Lifecycle states for a streaming session."""

    IDLE = auto()
    PLAYING = auto()
    PAUSED = auto()
    STOPPED = auto()


# -- Audio utilities -----------------------------------------------------------


def raised_cosine_crossfade(
    tail: NDArray[np.float32],
    head: NDArray[np.float32],
) -> NDArray[np.float32]:
    """Apply a raised-cosine crossfade between *tail* (end of seg A) and *head* (start of seg B).

    Both arrays must be the same length (the overlap region).
    Returns the blended overlap as a new array.
    """
    n = len(tail)
    if len(head) != n:
        raise ValueError(
            f"tail and head must be equal length, got {len(tail)} and {len(head)}"
        )
    # Raised cosine windows: fade_out goes 1->0, fade_in goes 0->1
    t = np.linspace(0.0, 1.0, n, dtype=np.float32)
    fade_out = 0.5 * (1.0 + np.cos(np.pi * t))   # 1 -> 0
    fade_in = 0.5 * (1.0 - np.cos(np.pi * t))     # 0 -> 1
    return tail * fade_out + head * fade_in


def audio_to_wav_bytes(
    audio: NDArray[np.float32],
    sample_rate: int,
) -> bytes:
    """Encode a float32 mono audio array as 16-bit PCM WAV bytes."""
    # Clip and convert to int16
    clipped = np.clip(audio, -1.0, 1.0)
    pcm = (clipped * 32767).astype(np.int16)
    raw = pcm.tobytes()

    num_channels = 1
    sample_width = 2  # 16-bit
    byte_rate = sample_rate * num_channels * sample_width
    block_align = num_channels * sample_width
    data_size = len(raw)

    buf = io.BytesIO()
    # RIFF header
    buf.write(b"RIFF")
    buf.write(struct.pack("<I", 36 + data_size))
    buf.write(b"WAVE")
    # fmt sub-chunk
    buf.write(b"fmt ")
    buf.write(struct.pack("<I", 16))                     # sub-chunk size
    buf.write(struct.pack("<H", 1))                      # PCM format
    buf.write(struct.pack("<H", num_channels))
    buf.write(struct.pack("<I", sample_rate))
    buf.write(struct.pack("<I", byte_rate))
    buf.write(struct.pack("<H", block_align))
    buf.write(struct.pack("<H", sample_width * 8))       # bits per sample
    # data sub-chunk
    buf.write(b"data")
    buf.write(struct.pack("<I", data_size))
    buf.write(raw)
    return buf.getvalue()


# -- Stream session ------------------------------------------------------------


class StreamSession:
    """Manages a continuous audio generation loop for a single WebSocket client.

    Audio segments are generated in a background task, crossfaded, sliced into
    small chunks, and pushed to an asyncio queue for the WebSocket handler to
    consume.

    Features:
        - Adaptive segment duration based on measured generation speed.
        - Audio continuation: passes the tail of the previous segment to the
          engine for seamless transitions.
        - Seed tracking: the seed used by the engine is exposed and included
          in control messages.
        - Pre-generation buffer: tries to stay 1-2 segments ahead by starting
          the next generation while the current segment is being consumed.
    """

    # Duration of audio tail passed to the engine for continuation (seconds).
    CONTINUATION_SECONDS: float = 3.0

    def __init__(self, engine: MusicEngine, session_id: str) -> None:
        self._engine = engine
        self.session_id = session_id
        self.state = SessionState.IDLE
        self.current_mood: str | None = None
        self.segments_generated: int = 0
        self.started_at: float | None = None

        # -- Adaptive generation state --
        self.generation_ratio: float | None = None
        self.adaptive_segment_duration: float = settings.segment_duration
        self.adaptive_crossfade_duration: float = settings.crossfade_duration

        # -- Seed tracking --
        self.current_seed: int | None = None
        self._requested_seed: int | None = None  # seed supplied via start()

        # -- Control messages queue (JSON-serialisable dicts) --
        # The audio sender reads from both _chunk_queue (binary audio) and
        # _control_queue (status / generating / audio_ready messages).
        self._chunk_queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=20)
        self._control_queue: asyncio.Queue[dict | None] = asyncio.Queue(maxsize=50)

        self._gen_task: asyncio.Task[None] | None = None
        self._mood_changed = asyncio.Event()
        self._pause_event = asyncio.Event()
        self._pause_event.set()  # not paused initially

    # -- Public API ------------------------------------------------------------

    async def start(self, mood: str, seed: int | None = None) -> None:
        """Begin generating audio for *mood*.

        Args:
            mood: Name of a registered mood preset.
            seed: Optional seed forwarded to the engine for the first segment.
                  Subsequent segments receive ``None`` (engine picks random).
        """
        if self.state in (SessionState.PLAYING, SessionState.PAUSED):
            await self.stop()

        self.current_mood = mood
        self.segments_generated = 0
        self.started_at = time.monotonic()
        self.state = SessionState.PLAYING
        self._requested_seed = seed
        self.generation_ratio = None
        self.adaptive_segment_duration = settings.segment_duration
        self.adaptive_crossfade_duration = settings.crossfade_duration
        self.current_seed = None
        self._pause_event.set()
        self._gen_task = asyncio.create_task(
            self._generation_loop(), name=f"gen-{self.session_id}"
        )
        logger.info("Session %s started with mood '%s' (seed=%s)", self.session_id, mood, seed)

    async def change_mood(self, mood: str) -> None:
        """Change the mood for subsequent segments (current segment finishes first)."""
        self.current_mood = mood
        self._mood_changed.set()
        logger.info("Session %s mood changed to '%s'", self.session_id, mood)

    async def pause(self) -> None:
        """Pause chunk delivery (generation may still finish the current segment)."""
        if self.state == SessionState.PLAYING:
            self.state = SessionState.PAUSED
            self._pause_event.clear()
            logger.info("Session %s paused", self.session_id)

    async def resume(self) -> None:
        """Resume chunk delivery."""
        if self.state == SessionState.PAUSED:
            self.state = SessionState.PLAYING
            self._pause_event.set()
            logger.info("Session %s resumed", self.session_id)

    async def stop(self) -> None:
        """Stop the generation loop and drain the queue."""
        self.state = SessionState.STOPPED
        self._pause_event.set()  # unblock if paused so task can exit
        if self._gen_task is not None and not self._gen_task.done():
            self._gen_task.cancel()
            try:
                await self._gen_task
            except asyncio.CancelledError:
                pass
        # Drain queues
        for q in (self._chunk_queue, self._control_queue):
            while not q.empty():
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    break
        # Push sentinels so consumers unblock
        await self._chunk_queue.put(None)
        await self._control_queue.put(None)
        logger.info("Session %s stopped", self.session_id)

    async def get_next_chunk(self) -> bytes | None:
        """Return the next WAV-encoded audio chunk, or ``None`` if the session ended."""
        # Respect pause
        await self._pause_event.wait()
        return await self._chunk_queue.get()

    async def get_next_control(self) -> dict | None:
        """Return the next control message, or ``None`` if the session ended.

        Non-blocking drain: returns immediately if nothing is queued.
        This is called from the audio sender so it can interleave control
        messages with audio frames.
        """
        try:
            return self._control_queue.get_nowait()
        except asyncio.QueueEmpty:
            return None

    @property
    def elapsed(self) -> float:
        """Seconds since the session started."""
        if self.started_at is None:
            return 0.0
        return time.monotonic() - self.started_at

    # -- Internal: emit control messages ----------------------------------------

    def _emit_control(self, msg: dict) -> None:
        """Best-effort enqueue of a control message (non-blocking, drops if full)."""
        try:
            self._control_queue.put_nowait(msg)
        except asyncio.QueueFull:
            logger.debug("Control queue full, dropping message: %s", msg.get("type"))

    # -- Internal generation loop -----------------------------------------------

    async def _generation_loop(self) -> None:
        """Background coroutine: generate segments, crossfade, enqueue chunks.

        The loop implements:
        1. Adaptive timing -- measures the first segment and adjusts durations.
        2. Audio continuation -- passes the last 3 seconds of the previous
           segment to the engine for seamless transitions.
        3. Pre-generation buffering -- begins generating the next segment
           concurrently while the current one is being chunked and consumed.
        """
        sr = self._engine.get_sample_rate()
        chunk_samples = int(settings.chunk_duration * sr)
        continuation_samples = int(self.CONTINUATION_SECONDS * sr)

        prev_tail: NDArray[np.float32] | None = None
        prev_segment_audio: NDArray[np.float32] | None = None
        first_audio_sent = False

        # Handle to a pre-generation task that runs concurrently with chunking.
        prefetch_task: asyncio.Task | None = None
        prefetch_mood: str | None = None

        try:
            while self.state in (SessionState.PLAYING, SessionState.PAUSED):
                mood = self.current_mood
                if mood is None:
                    break

                # Clear the mood-changed flag before generating so we detect
                # changes that arrive during generation.
                self._mood_changed.clear()

                # Determine segment duration (adaptive after first segment).
                seg_dur = self.adaptive_segment_duration
                crossfade_dur = self.adaptive_crossfade_duration
                crossfade_samples = int(crossfade_dur * sr)

                # Determine continuation audio for the engine.
                continuation: NDArray[np.float32] | None = None
                if prev_segment_audio is not None and len(prev_segment_audio) >= continuation_samples:
                    continuation = prev_segment_audio[-continuation_samples:]
                # On mood change, drop continuation (fresh start for new mood).
                if self._mood_changed.is_set():
                    continuation = None
                    prev_tail = None
                    prev_segment_audio = None

                # Determine seed: use requested seed only for the very first
                # segment, then let the engine pick randomly.
                seed_for_segment: int | None = None
                if self.segments_generated == 0 and self._requested_seed is not None:
                    seed_for_segment = self._requested_seed

                # Emit "generating" status before generation starts.
                self._emit_control({
                    "type": "generating",
                    "segment": self.segments_generated + 1,
                })

                # -- Generate (or reuse prefetch result) --
                segment: NDArray[np.float32]
                metadata: dict

                if (
                    prefetch_task is not None
                    and not prefetch_task.cancelled()
                    and prefetch_mood == mood
                ):
                    # We already started generating this segment in the background.
                    t0 = time.monotonic()
                    segment, metadata = await prefetch_task
                    gen_wall = time.monotonic() - t0
                    prefetch_task = None
                    prefetch_mood = None
                else:
                    # Cancel stale prefetch if mood changed.
                    if prefetch_task is not None and not prefetch_task.done():
                        prefetch_task.cancel()
                        try:
                            await prefetch_task
                        except (asyncio.CancelledError, Exception):
                            pass
                    prefetch_task = None
                    prefetch_mood = None

                    t0 = time.monotonic()
                    segment, metadata = await self._engine.generate(
                        mood, seg_dur, continuation_audio=continuation, seed=seed_for_segment,
                    )
                    gen_wall = time.monotonic() - t0

                self.segments_generated += 1
                self.current_seed = metadata.get("seed")

                # -- Measure generation speed on the first segment --
                if self.generation_ratio is None:
                    audio_dur = len(segment) / sr
                    self.generation_ratio = gen_wall / audio_dur if audio_dur > 0 else 1.0
                    new_seg, new_xfade = _adaptive_durations(self.generation_ratio)
                    self.adaptive_segment_duration = new_seg
                    self.adaptive_crossfade_duration = new_xfade
                    logger.info(
                        "Session %s adaptive timing: ratio=%.2f -> segment=%.1fs, crossfade=%.1fs",
                        self.session_id,
                        self.generation_ratio,
                        new_seg,
                        new_xfade,
                    )
                    # Recalculate crossfade_samples for the *current* segment,
                    # even though this first segment used the default duration.
                    # We keep crossfade_samples as-is for this segment (it was
                    # generated at the default duration), but update for next.

                logger.debug(
                    "Session %s generated segment %d (%s, %d samples, %.2fs wall, seed=%s)",
                    self.session_id,
                    self.segments_generated,
                    mood,
                    len(segment),
                    gen_wall,
                    self.current_seed,
                )

                # Save the full segment for continuation on the next iteration.
                prev_segment_audio = segment

                # -- Start pre-generating the NEXT segment concurrently --
                # We kick this off now so it runs while we chunk the current one.
                next_mood = self.current_mood  # may have changed
                if self.state in (SessionState.PLAYING, SessionState.PAUSED) and next_mood is not None:
                    next_seg_dur = self.adaptive_segment_duration
                    next_continuation: NDArray[np.float32] | None = None
                    if len(segment) >= continuation_samples:
                        next_continuation = segment[-continuation_samples:]
                    prefetch_mood = next_mood
                    prefetch_task = asyncio.create_task(
                        self._engine.generate(
                            next_mood, next_seg_dur,
                            continuation_audio=next_continuation,
                            seed=None,
                        ),
                        name=f"prefetch-{self.session_id}-{self.segments_generated + 1}",
                    )

                # -- Crossfade with previous segment --
                if prev_tail is not None and crossfade_samples > 0:
                    head = segment[:crossfade_samples]
                    overlap_len = min(len(prev_tail), len(head))
                    if overlap_len > 0:
                        blended = raised_cosine_crossfade(
                            prev_tail[:overlap_len], head[:overlap_len]
                        )
                        # Enqueue the crossfaded region as chunks
                        await self._enqueue_audio(blended, sr, chunk_samples)
                    # The rest of the segment starts after the overlap
                    body = segment[crossfade_samples:]
                else:
                    body = segment

                # Save the tail for crossfading with the next segment
                if crossfade_samples > 0 and len(body) > crossfade_samples:
                    prev_tail = body[-crossfade_samples:].copy()
                    sendable = body[:-crossfade_samples]
                else:
                    prev_tail = None
                    sendable = body

                # Emit "audio_ready" the first time audio is enqueued.
                if not first_audio_sent:
                    self._emit_control({"type": "audio_ready"})
                    first_audio_sent = True

                # Enqueue the non-overlapping body as chunks
                await self._enqueue_audio(sendable, sr, chunk_samples)

        except asyncio.CancelledError:
            logger.debug("Session %s generation loop cancelled", self.session_id)
        except Exception:
            logger.exception("Session %s generation loop error", self.session_id)
        finally:
            # Cancel any in-flight prefetch.
            if prefetch_task is not None and not prefetch_task.done():
                prefetch_task.cancel()
                try:
                    await prefetch_task
                except (asyncio.CancelledError, Exception):
                    pass
            # Signal end of stream
            try:
                self._chunk_queue.put_nowait(None)
            except asyncio.QueueFull:
                pass

    async def _enqueue_audio(
        self,
        audio: NDArray[np.float32],
        sample_rate: int,
        chunk_samples: int,
    ) -> None:
        """Slice *audio* into fixed-size chunks, encode as WAV, push to queue."""
        offset = 0
        while offset < len(audio):
            if self.state == SessionState.STOPPED:
                return
            end = min(offset + chunk_samples, len(audio))
            chunk = audio[offset:end]
            wav_bytes = audio_to_wav_bytes(chunk, sample_rate)
            await self._chunk_queue.put(wav_bytes)
            offset = end
