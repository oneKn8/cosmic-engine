"""Application configuration loaded from environment variables with sensible defaults."""

from __future__ import annotations

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Central configuration for the music generation backend.

    All values can be overridden via environment variables (case-insensitive).
    """

    # -- Engine selection: "mock", "replicate", "musicgen", "midi_transformer" --
    engine_type: str = "mock"

    # -- Model (for local MusicGen) --
    model_name: str = "facebook/musicgen-small"
    device: str = "auto"
    sample_rate: int = 32000

    # -- MIDI Transformer engine --
    midi_model_dir: str = "./exported"
    soundfont_path: str = "/usr/share/sounds/sf2/FluidR3_GM.sf2"

    # -- Replicate API --
    replicate_api_token: str = ""
    replicate_model: str = "meta/musicgen:671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedbb"

    # -- Generation --
    segment_duration: float = 15.0
    crossfade_duration: float = 2.0
    chunk_duration: float = 1.5

    # -- Server --
    host: str = "0.0.0.0"
    port: int = 8888
    cors_origins: list[str] = ["*"]

    model_config = {
        "env_prefix": "",
        "case_sensitive": False,
    }

    def resolved_device(self) -> str:
        """Return the actual torch device string after resolving 'auto'."""
        if self.device != "auto":
            return self.device
        try:
            import torch  # noqa: WPS433

            return "cuda" if torch.cuda.is_available() else "cpu"
        except ImportError:
            return "cpu"


settings = Settings()
