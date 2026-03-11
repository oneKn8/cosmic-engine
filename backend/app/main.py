"""FastAPI application -- HTTP endpoints and WebSocket streaming."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import uuid
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.engine import MusicEngine, create_engine
from app.moods import MOODS, get_mood, list_moods
from app.streaming import StreamSession

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)

# -- Application state ---------------------------------------------------------

_engine: MusicEngine | None = None
_engine_loaded: bool = False


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Startup: load the music engine.  Shutdown: nothing special needed."""
    global _engine, _engine_loaded  # noqa: PLW0603

    _engine = create_engine()
    await _engine.load()
    _engine_loaded = True
    logger.info("Engine ready")
    yield
    logger.info("Shutting down")


app = FastAPI(
    title="Infinite Music Generator",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -- REST endpoints -----------------------------------------------------------


@app.get("/api/moods")
async def api_moods() -> list[dict[str, object]]:
    """Return the catalogue of available moods."""
    return list_moods()


@app.get("/api/status")
async def api_status() -> dict[str, object]:
    """Return server / engine health information."""
    return {
        "engine_loaded": _engine_loaded,
        "engine_type": settings.engine_type,
        "device": settings.resolved_device(),
        "model": settings.model_name,
        "sample_rate": settings.sample_rate,
        "segment_duration": settings.segment_duration,
        "available_moods": len(MOODS),
    }


# -- WebSocket streaming ------------------------------------------------------


@app.websocket("/ws/stream")
async def ws_stream(ws: WebSocket) -> None:
    """Main streaming endpoint.

    Protocol (client -> server JSON messages):
        {"type": "start",       "mood": "<mood_name>"}
        {"type": "start",       "mood": "<mood_name>", "seed": 12345}
        {"type": "change_mood", "mood": "<mood_name>"}
        {"type": "pause"}
        {"type": "resume"}
        {"type": "stop"}

    Server -> client JSON messages:
        {"type": "audio",        "data": "<base64 WAV>"}
        {"type": "status",       "mood": "...", "segment": N, "elapsed": X, "seed": 12345}
        {"type": "generating",   "segment": N}
        {"type": "audio_ready"}
        {"type": "mood_changed", "mood": "..."}
        {"type": "error",        "message": "..."}
    """
    await ws.accept()
    session_id = uuid.uuid4().hex[:12]
    logger.info("WebSocket connected: %s", session_id)

    if _engine is None:
        await _send_error(ws, "Engine not loaded")
        await ws.close()
        return

    session = StreamSession(_engine, session_id)
    sender_task: asyncio.Task[None] | None = None

    try:
        async for raw in ws.iter_text():
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await _send_error(ws, "Invalid JSON")
                continue

            msg_type: str = msg.get("type", "")

            if msg_type == "start":
                mood_name = msg.get("mood", "")
                if not _validate_mood(mood_name):
                    await _send_error(ws, f"Unknown mood: {mood_name}")
                    continue

                # Extract optional seed from the start message.
                seed: int | None = msg.get("seed")
                if seed is not None:
                    try:
                        seed = int(seed)
                    except (TypeError, ValueError):
                        seed = None

                # Stop previous sender if running
                if sender_task is not None and not sender_task.done():
                    await session.stop()
                    sender_task.cancel()
                    try:
                        await sender_task
                    except asyncio.CancelledError:
                        pass

                session = StreamSession(_engine, session_id)
                await session.start(mood_name, seed=seed)
                sender_task = asyncio.create_task(
                    _audio_sender(ws, session),
                    name=f"sender-{session_id}",
                )

            elif msg_type == "change_mood":
                mood_name = msg.get("mood", "")
                if not _validate_mood(mood_name):
                    await _send_error(ws, f"Unknown mood: {mood_name}")
                    continue
                await session.change_mood(mood_name)
                await ws.send_json({"type": "mood_changed", "mood": mood_name})

            elif msg_type == "pause":
                await session.pause()

            elif msg_type == "resume":
                await session.resume()

            elif msg_type == "stop":
                await session.stop()
                if sender_task is not None and not sender_task.done():
                    sender_task.cancel()
                    try:
                        await sender_task
                    except asyncio.CancelledError:
                        pass

            else:
                await _send_error(ws, f"Unknown message type: {msg_type}")

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected: %s", session_id)
    except Exception:
        logger.exception("WebSocket error for session %s", session_id)
    finally:
        await session.stop()
        if sender_task is not None and not sender_task.done():
            sender_task.cancel()
            try:
                await sender_task
            except asyncio.CancelledError:
                pass
        logger.info("Session %s cleaned up", session_id)


async def _audio_sender(ws: WebSocket, session: StreamSession) -> None:
    """Background task: read chunks from the session queue and push to the client.

    Also drains the session's control queue to interleave status, generating,
    and audio_ready messages with the binary audio frames.
    """
    status_interval = 5.0  # send status every N seconds
    last_status = 0.0

    try:
        while True:
            # Drain all pending control messages before sending the next chunk.
            while True:
                ctrl = await session.get_next_control()
                if ctrl is None:
                    break
                await ws.send_json(ctrl)

            # Poll for chunks with a timeout so we can drain control messages
            # (like "generating") that arrive while waiting for audio.
            try:
                chunk = await asyncio.wait_for(session.get_next_chunk(), timeout=0.5)
            except asyncio.TimeoutError:
                continue
            if chunk is None:
                break

            encoded = base64.b64encode(chunk).decode("ascii")
            await ws.send_json({"type": "audio", "data": encoded})

            # Periodic status updates (now includes seed)
            now = session.elapsed
            if now - last_status >= status_interval:
                last_status = now
                await ws.send_json(
                    {
                        "type": "status",
                        "mood": session.current_mood,
                        "segment": session.segments_generated,
                        "elapsed": round(now, 1),
                        "seed": session.current_seed,
                    }
                )
    except asyncio.CancelledError:
        pass
    except Exception:
        logger.exception("Audio sender error for session %s", session.session_id)


def _validate_mood(name: str) -> bool:
    """Return True if *name* is a known mood."""
    try:
        get_mood(name)
        return True
    except KeyError:
        return False


async def _send_error(ws: WebSocket, message: str) -> None:
    """Send an error frame to the client."""
    try:
        await ws.send_json({"type": "error", "message": message})
    except Exception:
        pass
