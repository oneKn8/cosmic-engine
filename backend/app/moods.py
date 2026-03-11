"""Mood presets that map user-facing moods to MusicGen prompts and parameters."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Mood:
    """A single mood preset containing generation parameters for MusicGen."""

    name: str
    display_name: str
    description: str
    prompt: str
    temperature: float
    guidance_scale: float
    bpm: int
    base_frequencies: tuple[float, ...]
    modulation_rate: float


# ── Mood catalogue ────────────────────────────────────────────────────────────

MOODS: dict[str, Mood] = {}


def _register(*moods: Mood) -> None:
    for m in moods:
        MOODS[m.name] = m


_register(
    Mood(
        name="cosmic",
        display_name="Cosmic",
        description="Deep space ambient with evolving synthesizer pads",
        prompt=(
            "atmospheric ambient electronic music, slow evolving synthesizer "
            "pads, deep space textures, ethereal drones, reverb-heavy, "
            "shimmering overtones, weightless and vast, 85 BPM"
        ),
        temperature=1.0,
        guidance_scale=4.0,
        bpm=85,
        base_frequencies=(130.81, 196.00, 261.63, 329.63),  # C3-E4 spread
        modulation_rate=0.15,
    ),
    Mood(
        name="melancholic",
        display_name="Melancholic",
        description="Emotional piano with cinematic ambient pads",
        prompt=(
            "melancholic piano with lush ambient pads, emotional and "
            "reflective, minor key, slow tempo, cinematic strings in the "
            "background, gentle reverb, introspective and deeply moving, 70 BPM"
        ),
        temperature=0.8,
        guidance_scale=5.0,
        bpm=70,
        base_frequencies=(220.00, 261.63, 311.13),  # A3 C4 Eb4 (A minor)
        modulation_rate=0.1,
    ),
    Mood(
        name="night_drive",
        display_name="Night Drive",
        description="Synthwave with driving bass and neon arpeggios",
        prompt=(
            "synthwave retrowave music, driving pulsing bass, arpeggiated "
            "synthesizers, neon-lit nocturnal atmosphere, punchy drums, "
            "analog warmth, 80s inspired electronic, 100 BPM"
        ),
        temperature=0.9,
        guidance_scale=5.5,
        bpm=100,
        base_frequencies=(146.83, 220.00, 293.66, 369.99),  # D3 A3 D4 F#4
        modulation_rate=0.35,
    ),
    Mood(
        name="dream",
        display_name="Dream",
        description="Shoegaze-ambient with floating guitar textures",
        prompt=(
            "dreamy shoegaze ambient, floating distorted guitar textures, "
            "thick reverb and delay, ethereal distant vocals, hazy and warm, "
            "washed-out soundscapes, gentle swells, 78 BPM"
        ),
        temperature=1.1,
        guidance_scale=3.5,
        bpm=78,
        base_frequencies=(196.00, 246.94, 293.66, 392.00),  # G3 B3 D4 G4
        modulation_rate=0.12,
    ),
    Mood(
        name="tension",
        display_name="Tension",
        description="Dark cinematic suspense with building strings",
        prompt=(
            "dark cinematic tension music, building orchestral strings, "
            "suspenseful dissonant harmonies, minor key, low rumbling bass, "
            "unsettling texture, thriller soundtrack feel, 90 BPM"
        ),
        temperature=0.85,
        guidance_scale=6.0,
        bpm=90,
        base_frequencies=(138.59, 164.81, 207.65, 277.18),  # C#3 E3 G#3 C#4 (dim)
        modulation_rate=0.5,
    ),
    Mood(
        name="euphoria",
        display_name="Euphoria",
        description="Uplifting trance with ascending bright melodies",
        prompt=(
            "uplifting euphoric trance music, ascending melodic synthesizer "
            "leads, bright supersaw chords, major key, energetic driving beat, "
            "soaring pads, festival anthem feeling, 128 BPM"
        ),
        temperature=0.9,
        guidance_scale=5.0,
        bpm=128,
        base_frequencies=(261.63, 329.63, 392.00, 523.25),  # C4 E4 G4 C5
        modulation_rate=0.45,
    ),
    Mood(
        name="rain",
        display_name="Rain",
        description="Lo-fi ambient piano with warm rain atmosphere",
        prompt=(
            "lo-fi ambient piano, soft rain atmosphere in background, warm "
            "cozy texture, jazzy extended chords, vinyl crackle, relaxing "
            "and nostalgic, gentle bass, mellow and soothing, 75 BPM"
        ),
        temperature=0.7,
        guidance_scale=4.5,
        bpm=75,
        base_frequencies=(174.61, 220.00, 261.63, 311.13, 349.23),  # F3 A3 C4 Eb4 F4
        modulation_rate=0.08,
    ),
    Mood(
        name="horizon",
        display_name="Horizon",
        description="Post-rock crescendo with delayed guitars building to climax",
        prompt=(
            "post-rock crescendo, delayed electric guitars building slowly "
            "to powerful climax, epic and emotional, tremolo picking, layered "
            "reverb, soaring dynamics, cathartic release, 95 BPM"
        ),
        temperature=1.0,
        guidance_scale=4.5,
        bpm=95,
        base_frequencies=(164.81, 246.94, 329.63, 493.88),  # E3 B3 E4 B4
        modulation_rate=0.25,
    ),
)


def get_mood(name: str) -> Mood:
    """Retrieve a mood by name.

    Raises:
        KeyError: If the mood name is not found in the catalogue.
    """
    try:
        return MOODS[name]
    except KeyError:
        available = ", ".join(sorted(MOODS))
        raise KeyError(f"Unknown mood '{name}'. Available: {available}") from None


def list_moods() -> list[dict[str, object]]:
    """Return all moods as serialisable dictionaries (for the API)."""
    return [
        {
            "name": m.name,
            "display_name": m.display_name,
            "description": m.description,
            "bpm": m.bpm,
        }
        for m in MOODS.values()
    ]
