#!/usr/bin/env python3
"""
Prepare MIDI data for training the MIDI Transformer.

Workflow:
  1. Scan data_dir for .mid/.midi files
  2. Filter files by instrument, tempo, and duration
  3. Tokenize with miditok REMI tokenizer
  4. Assign mood labels via musical heuristics
  5. Save tokenized sequences + mood labels as .pt files

Usage:
    python data/prepare_data.py --config configs/default.yaml
"""

from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
import signal
import sys
from collections import Counter
from pathlib import Path
from typing import Optional

import numpy as np
import torch
import yaml
from tqdm import tqdm

# miditok / symusic imports
from miditok import REMI, TokenizerConfig
from symusic import Score


# ============================================================================
# Constants
# ============================================================================

# General MIDI program numbers for instruments we want to keep
PIANO_PROGRAMS = set(range(0, 8))         # Acoustic/electric piano, harpsichord, clavinet
SYNTH_PROGRAMS = set(range(80, 104))      # Synth leads, pads, effects
STRING_PROGRAMS = set(range(40, 52))      # Strings, ensemble, orchestral
ORGAN_PROGRAMS = set(range(16, 24))       # Organs
GUITAR_PROGRAMS = set(range(24, 32))      # Guitars
ALLOWED_PROGRAMS = (
    PIANO_PROGRAMS | SYNTH_PROGRAMS | STRING_PROGRAMS | ORGAN_PROGRAMS | GUITAR_PROGRAMS
)

MIN_TEMPO = 60
MAX_TEMPO = 140
MIN_DURATION_SEC = 30.0

MOOD_CATEGORIES = [
    "cosmic", "melancholic", "night_drive", "dream",
    "tension", "euphoria", "rain", "horizon",
]


# ============================================================================
# MIDI Analysis Helpers
# ============================================================================

def _get_dominant_tempo(score: Score) -> float:
    """Return the most common tempo from a Score, defaulting to 120 BPM."""
    if not score.tempos:
        return 120.0
    # Use the first tempo as a simple heuristic (most MIDI files set it once)
    return float(score.tempos[0].qpm)


def _get_duration_seconds(score: Score) -> float:
    """Estimate duration of the score in seconds."""
    if score.end() is None or score.end() == 0:
        return 0.0
    ticks = score.end()
    tpq = score.ticks_per_quarter
    tempo = _get_dominant_tempo(score)
    if tpq == 0 or tempo == 0:
        return 0.0
    beats = ticks / tpq
    return beats * (60.0 / tempo)


def _has_allowed_instruments(score: Score) -> bool:
    """Check that at least one track uses an allowed instrument program."""
    for track in score.tracks:
        if track.is_drum:
            continue
        if track.program in ALLOWED_PROGRAMS:
            return True
    return False


def _get_programs_present(score: Score) -> set[int]:
    """Return the set of GM program numbers present (excluding drums)."""
    return {t.program for t in score.tracks if not t.is_drum and len(t.notes) > 0}


def _compute_features(score: Score) -> dict:
    """Extract musical features for mood classification.

    Returns a dict with keys: tempo, is_minor, avg_pitch, pitch_range,
    note_density, instrument_density, has_piano, has_synth, has_strings,
    has_guitar, velocity_mean, velocity_std.
    """
    tempo = _get_dominant_tempo(score)
    programs = _get_programs_present(score)
    duration = _get_duration_seconds(score)

    all_pitches: list[int] = []
    all_velocities: list[int] = []
    total_notes = 0

    for track in score.tracks:
        if track.is_drum:
            continue
        for note in track.notes:
            all_pitches.append(note.pitch)
            all_velocities.append(note.velocity)
            total_notes += 1

    if total_notes == 0:
        return {}

    avg_pitch = float(np.mean(all_pitches))
    pitch_range = int(np.max(all_pitches)) - int(np.min(all_pitches))
    note_density = total_notes / max(duration, 1.0)  # notes per second
    vel_mean = float(np.mean(all_velocities))
    vel_std = float(np.std(all_velocities)) if len(all_velocities) > 1 else 0.0

    # Simple minor-key heuristic: check pitch-class histogram for minor 3rd prevalence
    pc_hist = np.zeros(12)
    for p in all_pitches:
        pc_hist[p % 12] += 1
    # Estimate root as most common pitch class
    root = int(np.argmax(pc_hist))
    # Check if minor 3rd (root+3) is more prevalent than major 3rd (root+4)
    minor_3rd_count = pc_hist[(root + 3) % 12]
    major_3rd_count = pc_hist[(root + 4) % 12]
    is_minor = minor_3rd_count > major_3rd_count

    # Check for 7th chords (jazz indicator): prevalence of 10 or 11 semitones above root
    seventh_count = pc_hist[(root + 10) % 12] + pc_hist[(root + 11) % 12]
    has_sevenths = seventh_count > (total_notes * 0.05)

    return {
        "tempo": tempo,
        "is_minor": is_minor,
        "avg_pitch": avg_pitch,
        "pitch_range": pitch_range,
        "note_density": note_density,
        "instrument_density": len(programs),
        "has_piano": bool(programs & PIANO_PROGRAMS),
        "has_synth": bool(programs & SYNTH_PROGRAMS),
        "has_strings": bool(programs & STRING_PROGRAMS),
        "has_guitar": bool(programs & GUITAR_PROGRAMS),
        "vel_mean": vel_mean,
        "vel_std": vel_std,
        "has_sevenths": has_sevenths,
        "total_notes": total_notes,
        "duration": duration,
    }


# ============================================================================
# Mood Classification
# ============================================================================

def classify_mood(features: dict) -> str:
    """Classify a MIDI file into one of the mood categories based on heuristics.

    This is intentionally rule-based and approximate. The mood labels serve as
    conditioning signals during training; they do not need to be perfect.
    """
    tempo = features["tempo"]
    is_minor = features["is_minor"]
    avg_pitch = features["avg_pitch"]
    pitch_range = features["pitch_range"]
    density = features["note_density"]
    has_piano = features["has_piano"]
    has_synth = features["has_synth"]
    has_strings = features["has_strings"]
    has_guitar = features["has_guitar"]
    has_sevenths = features["has_sevenths"]
    vel_std = features["vel_std"]

    scores: dict[str, float] = {mood: 0.0 for mood in MOOD_CATEGORIES}

    # cosmic: slow tempo, major/lydian, sparse, high register
    if tempo < 100:
        scores["cosmic"] += 1.0
    if not is_minor:
        scores["cosmic"] += 1.0
    if avg_pitch > 72:
        scores["cosmic"] += 1.5
    if density < 3.0:
        scores["cosmic"] += 1.0
    if has_synth or has_strings:
        scores["cosmic"] += 0.5

    # melancholic: slow, minor key, piano-heavy, low-mid register
    if tempo < 100:
        scores["melancholic"] += 1.0
    if is_minor:
        scores["melancholic"] += 2.0
    if has_piano:
        scores["melancholic"] += 1.5
    if avg_pitch < 65:
        scores["melancholic"] += 1.0
    if density < 4.0:
        scores["melancholic"] += 0.5

    # night_drive: mid-fast tempo, synth-heavy, rhythmic
    if 90 <= tempo <= 130:
        scores["night_drive"] += 1.5
    if has_synth:
        scores["night_drive"] += 2.0
    if density > 3.0:
        scores["night_drive"] += 1.0
    if not is_minor:
        scores["night_drive"] += 0.5

    # dream: slow, major, sparse, wide pitch range
    if tempo < 95:
        scores["dream"] += 1.0
    if not is_minor:
        scores["dream"] += 1.5
    if density < 2.5:
        scores["dream"] += 1.5
    if pitch_range > 48:
        scores["dream"] += 1.5
    if has_piano or has_strings:
        scores["dream"] += 0.5

    # tension: minor/diminished, dense, building dynamics
    if is_minor:
        scores["tension"] += 2.0
    if density > 5.0:
        scores["tension"] += 1.5
    if vel_std > 25:
        scores["tension"] += 1.5
    if tempo > 80:
        scores["tension"] += 0.5

    # euphoria: fast, major, dense, high energy
    if tempo > 110:
        scores["euphoria"] += 1.5
    if not is_minor:
        scores["euphoria"] += 1.5
    if density > 6.0:
        scores["euphoria"] += 1.5
    if avg_pitch > 65:
        scores["euphoria"] += 0.5

    # rain: slow, jazzy chords (7ths, extensions), piano
    if tempo < 100:
        scores["rain"] += 1.0
    if has_sevenths:
        scores["rain"] += 2.5
    if has_piano:
        scores["rain"] += 1.5
    if density < 4.0:
        scores["rain"] += 0.5

    # horizon: building dynamics, guitar-like instruments, crescendo patterns
    if has_guitar:
        scores["horizon"] += 2.0
    if has_strings:
        scores["horizon"] += 1.0
    if vel_std > 20:
        scores["horizon"] += 1.5
    if 80 <= tempo <= 120:
        scores["horizon"] += 1.0
    if not is_minor:
        scores["horizon"] += 0.5

    return max(scores, key=scores.get)  # type: ignore[arg-type]


# ============================================================================
# Data Preparation Pipeline
# ============================================================================

def find_midi_files(data_dir: str) -> list[Path]:
    """Recursively find all .mid and .midi files in data_dir."""
    root = Path(data_dir)
    files: list[Path] = []
    for ext in ("*.mid", "*.midi", "*.MID", "*.MIDI"):
        files.extend(root.rglob(ext))
    return sorted(files)


def create_tokenizer() -> REMI:
    """Create and return a REMI tokenizer with our config."""
    config = TokenizerConfig(
        pitch_range=(21, 109),
        beat_res={(0, 4): 8, (4, 12): 4},
        num_velocities=32,
        special_tokens=["PAD", "BOS", "EOS", "MASK"],
        use_tempos=True,
        use_time_signatures=True,
        use_programs=False,  # single-stream, no program tokens
    )
    return REMI(tokenizer_config=config)


def process_file(
    midi_path: Path,
    tokenizer: REMI,
) -> Optional[tuple[list[int], str]]:
    """Load, filter, tokenize, and classify a single MIDI file.

    Returns (token_ids, mood_label) or None if the file should be skipped.
    """
    try:
        score = Score(str(midi_path))
    except Exception:
        return None

    # --- Filtering ---
    if not score.tracks:
        return None

    if not _has_allowed_instruments(score):
        return None

    tempo = _get_dominant_tempo(score)
    if not (MIN_TEMPO <= tempo <= MAX_TEMPO):
        return None

    duration = _get_duration_seconds(score)
    if duration < MIN_DURATION_SEC:
        return None

    # --- Feature extraction & mood classification ---
    features = _compute_features(score)
    if not features:
        return None
    mood = classify_mood(features)

    # --- Tokenization ---
    try:
        tok_result = tokenizer.encode(score)
        # REMI returns a TokSequence or list of TokSequence
        if isinstance(tok_result, list):
            # Concatenate all sequences (multiple tracks)
            ids: list[int] = []
            for ts in tok_result:
                ids.extend(ts.ids)
        else:
            ids = tok_result.ids
    except Exception:
        return None

    if len(ids) < 32:
        return None

    return ids, mood


def _worker_init():
    """Worker initializer: ignore SIGTERM so pool cleanup works cleanly."""
    signal.signal(signal.SIGTERM, signal.SIG_DFL)


def _worker_process_file(midi_path_str: str) -> Optional[tuple[list[int], str, str]]:
    """Worker function for multiprocessing -- isolates each file in its own process
    so a segfault in symusic/miditok only kills the worker, not the whole pipeline."""
    midi_path = Path(midi_path_str)
    try:
        tokenizer = create_tokenizer()
        result = process_file(midi_path, tokenizer)
        if result is None:
            return None
        token_ids, mood = result
        return (token_ids, mood, str(midi_path.name))
    except Exception:
        return None


def prepare_dataset(config: dict) -> None:
    """Main data preparation pipeline.

    Resilient to segfaults: processes files in batches, saves progress
    incrementally, and can resume from where it left off.
    """
    data_dir = config["data_dir"]
    processed_dir = config.get("processed_dir", "./data/processed")
    tokenizer_path = config["tokenizer_path"]
    mood_categories = config.get("mood_categories", MOOD_CATEGORIES)

    mood_to_idx = {m: i for i, m in enumerate(mood_categories)}

    os.makedirs(processed_dir, exist_ok=True)

    # Step 1: Find MIDI files
    print(f"Scanning for MIDI files in {data_dir} ...")
    midi_files = find_midi_files(data_dir)
    print(f"Found {len(midi_files)} MIDI files.")

    if not midi_files:
        print("No MIDI files found. Exiting.")
        sys.exit(1)

    # Check for resume: see how many seq_*.pt files already exist
    existing_seqs = sorted(Path(processed_dir).glob("seq_*.pt"))
    resume_offset = 0
    progress_path = os.path.join(processed_dir, "_progress.json")

    if os.path.exists(progress_path):
        with open(progress_path) as f:
            progress = json.load(f)
        resume_offset = progress.get("files_scanned", 0)
        saved_count = progress.get("saved_count", len(existing_seqs))
        skipped = progress.get("skipped", 0)
        total_tokens = progress.get("total_tokens", 0)
        mood_counter = Counter(progress.get("mood_counter", {}))
        print(f"Resuming from file index {resume_offset} "
              f"({saved_count} sequences saved so far).")
    else:
        saved_count = 0
        skipped = 0
        total_tokens = 0
        mood_counter = Counter()

    # Step 3: Process files with subprocess isolation
    # Each worker handles ONE file then exits (maxtasksperchild=1).
    # If a C-level segfault kills a worker, the pool replaces it automatically.
    # No more crash-restart loop.
    BATCH_SAVE_EVERY = 500  # save progress every N files scanned
    NUM_WORKERS = max(1, mp.cpu_count() - 1)

    print(f"Processing MIDI files ({NUM_WORKERS} workers, subprocess-isolated) ...")
    files_to_process = midi_files[resume_offset:]
    file_paths_str = [str(p) for p in files_to_process]
    crash_files: list[str] = []

    pool = mp.Pool(
        processes=NUM_WORKERS,
        initializer=_worker_init,
        maxtasksperchild=1,  # new process per file = segfault isolation
    )

    try:
        results_iter = pool.imap(
            _worker_process_file,
            file_paths_str,
            chunksize=1,  # one file per task = max isolation
        )

        for i in range(len(files_to_process)):
            file_idx = resume_offset + i

            try:
                result = next(results_iter)
            except (StopIteration, Exception) as e:
                # Worker died (segfault, timeout, etc.) -- skip this file
                result = None
                crash_files.append(file_paths_str[i])

            if result is None:
                skipped += 1
            else:
                token_ids, mood, source_name = result
                mood_idx = mood_to_idx.get(mood, 0)
                mood_counter[mood] += 1
                total_tokens += len(token_ids)

                out_path = os.path.join(processed_dir, f"seq_{saved_count:06d}.pt")
                torch.save(
                    {
                        "input_ids": torch.tensor(token_ids, dtype=torch.long),
                        "mood_id": mood_idx,
                        "mood_label": mood,
                        "source_file": source_name,
                    },
                    out_path,
                )
                saved_count += 1

            # Periodic progress save + stdout
            if (i + 1) % BATCH_SAVE_EVERY == 0 or (i + 1) == len(files_to_process):
                pct = (file_idx + 1) / len(midi_files) * 100
                print(f"  [{pct:5.1f}%] scanned={file_idx+1}/{len(midi_files)} "
                      f"saved={saved_count} skipped={skipped} crashes={len(crash_files)}")
                _save_progress(progress_path, file_idx + 1, saved_count,
                              skipped, total_tokens, mood_counter)
    finally:
        pool.terminate()
        pool.join()

    # Final progress save
    _save_progress(progress_path, len(midi_files), saved_count,
                  skipped, total_tokens, mood_counter)

    if crash_files:
        crash_path = os.path.join(processed_dir, "_crash_files.txt")
        with open(crash_path, "w") as f:
            f.write("\n".join(crash_files))
        print(f"\n{len(crash_files)} files caused crashes (logged to {crash_path})")

    # Step 4: Save tokenizer
    tokenizer = create_tokenizer()
    tokenizer.save(Path(tokenizer_path).parent, filename=Path(tokenizer_path).name)
    print(f"\nTokenizer saved to {tokenizer_path}")
    print(f"Vocabulary size: {len(tokenizer)}")

    # Step 5: Save metadata
    metadata = {
        "vocab_size": len(tokenizer),
        "total_files_scanned": len(midi_files),
        "total_files_processed": saved_count,
        "total_files_skipped": skipped,
        "total_tokens": total_tokens,
        "mood_distribution": dict(mood_counter),
        "mood_to_idx": mood_to_idx,
    }
    meta_path = os.path.join(processed_dir, "metadata.json")
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2)

    # Print summary
    print("\n" + "=" * 60)
    print("DATA PREPARATION COMPLETE")
    print("=" * 60)
    print(f"  Files scanned:    {len(midi_files)}")
    print(f"  Files processed:  {saved_count}")
    print(f"  Files skipped:    {skipped}")
    print(f"  Total tokens:     {total_tokens:,}")
    print(f"  Vocab size:       {len(tokenizer)}")
    print(f"  Processed dir:    {processed_dir}")
    print(f"\n  Mood distribution:")
    for mood in mood_categories:
        count = mood_counter.get(mood, 0)
        pct = (count / saved_count * 100) if saved_count > 0 else 0
        bar = "#" * int(pct / 2)
        print(f"    {mood:<14s} {count:>6d}  ({pct:5.1f}%)  {bar}")
    print("=" * 60)

    # Clean up progress file on successful completion
    if os.path.exists(progress_path):
        os.remove(progress_path)


def _save_progress(
    path: str, files_scanned: int, saved_count: int,
    skipped: int, total_tokens: int, mood_counter: Counter,
) -> None:
    """Save incremental progress so we can resume after crashes."""
    with open(path, "w") as f:
        json.dump({
            "files_scanned": files_scanned,
            "saved_count": saved_count,
            "skipped": skipped,
            "total_tokens": total_tokens,
            "mood_counter": dict(mood_counter),
        }, f)


# ============================================================================
# CLI
# ============================================================================

def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare MIDI dataset for training.")
    parser.add_argument(
        "--config", type=str, default="configs/default.yaml",
        help="Path to YAML config file.",
    )
    args = parser.parse_args()

    with open(args.config) as f:
        config = yaml.safe_load(f)

    prepare_dataset(config)


if __name__ == "__main__":
    main()
