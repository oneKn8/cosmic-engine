#!/usr/bin/env python3
"""
Training script for the MIDI Transformer.

Usage:
    python train.py --config configs/default.yaml
    python train.py --config configs/default.yaml --resume checkpoints/step_50000.pt

Features:
  - AdamW optimizer with cosine LR schedule + linear warmup
  - bf16 mixed precision when GPU supports it
  - torch.compile for training speed (PyTorch 2.x)
  - Gradient clipping
  - Periodic checkpoint saving with optimizer state for resume
  - Validation loss evaluation
  - Optional Weights & Biases logging
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import time
from pathlib import Path
from typing import Optional

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset, random_split
import yaml
from tqdm import tqdm

from model import MidiTransformer, MidiTransformerConfig


# ============================================================================
# Dataset
# ============================================================================

class MidiTokenDataset(Dataset):
    """Dataset that loads pre-tokenized .pt files and creates fixed-length
    sequences via a sliding window."""

    def __init__(
        self,
        processed_dir: str,
        max_seq_len: int,
        stride: Optional[int] = None,
    ) -> None:
        self.max_seq_len = max_seq_len
        self.stride = stride or (max_seq_len // 2)

        # Load all .pt files
        pt_files = sorted(Path(processed_dir).glob("seq_*.pt"))
        if not pt_files:
            raise FileNotFoundError(
                f"No seq_*.pt files found in {processed_dir}. "
                "Run data/prepare_data.py first."
            )

        print(f"Loading {len(pt_files)} tokenized files from {processed_dir} ...")
        self.sequences: list[tuple[torch.Tensor, int]] = []

        for pt_file in tqdm(pt_files, desc="Loading data"):
            data = torch.load(pt_file, map_location="cpu", weights_only=True)
            ids = data["input_ids"]
            mood_id = int(data["mood_id"])

            # Create sliding-window sequences
            if len(ids) <= max_seq_len:
                # Pad short sequences
                padded = torch.zeros(max_seq_len, dtype=torch.long)
                padded[:len(ids)] = ids
                self.sequences.append((padded, mood_id))
            else:
                for start in range(0, len(ids) - max_seq_len + 1, self.stride):
                    chunk = ids[start : start + max_seq_len]
                    self.sequences.append((chunk, mood_id))

        print(f"Created {len(self.sequences)} training sequences "
              f"(max_seq_len={max_seq_len}, stride={self.stride}).")

    def __len__(self) -> int:
        return len(self.sequences)

    def __getitem__(self, idx: int) -> dict[str, torch.Tensor]:
        ids, mood_id = self.sequences[idx]
        return {
            "input_ids": ids,
            "mood_id": torch.tensor(mood_id, dtype=torch.long),
        }


# ============================================================================
# Learning Rate Schedule
# ============================================================================

def get_lr(
    step: int,
    warmup_steps: int,
    max_steps: int,
    max_lr: float,
    min_lr_ratio: float = 0.1,
) -> float:
    """Cosine decay with linear warmup."""
    if step < warmup_steps:
        return max_lr * (step + 1) / warmup_steps
    if step >= max_steps:
        return max_lr * min_lr_ratio
    # Cosine decay
    progress = (step - warmup_steps) / (max_steps - warmup_steps)
    coeff = 0.5 * (1.0 + math.cos(math.pi * progress))
    return max_lr * (min_lr_ratio + (1.0 - min_lr_ratio) * coeff)


# ============================================================================
# Training Loop
# ============================================================================

def train(config: dict, resume_path: Optional[str] = None) -> None:
    """Main training function."""
    seed = config.get("seed", 42)
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)

    # --- Device ---
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")
    use_bf16 = (
        device.type == "cuda"
        and torch.cuda.is_bf16_supported()
    )
    if use_bf16:
        print("Using bf16 mixed precision training.")
    dtype = torch.bfloat16 if use_bf16 else torch.float32

    # --- Load tokenizer vocab size ---
    tokenizer_path = config["tokenizer_path"]
    if os.path.exists(tokenizer_path):
        with open(tokenizer_path) as f:
            tok_data = json.load(f)
        # miditok saves vocab in the JSON; count entries
        # The vocab is stored under the key "model" -> "vocab" or at top level
        if "model" in tok_data and "vocab" in tok_data["model"]:
            vocab_size = len(tok_data["model"]["vocab"])
        else:
            # Fallback: load from metadata
            meta_path = os.path.join(config.get("processed_dir", "./data/processed"), "metadata.json")
            with open(meta_path) as f:
                meta = json.load(f)
            vocab_size = meta["vocab_size"]
    else:
        meta_path = os.path.join(config.get("processed_dir", "./data/processed"), "metadata.json")
        with open(meta_path) as f:
            meta = json.load(f)
        vocab_size = meta["vocab_size"]

    print(f"Vocabulary size: {vocab_size}")

    # --- Dataset ---
    processed_dir = config.get("processed_dir", "./data/processed")
    max_seq_len = config["max_seq_len"]
    dataset = MidiTokenDataset(processed_dir, max_seq_len)

    # Train/val split
    val_split = config.get("val_split", 0.05)
    val_size = max(1, int(len(dataset) * val_split))
    train_size = len(dataset) - val_size
    train_dataset, val_dataset = random_split(
        dataset, [train_size, val_size],
        generator=torch.Generator().manual_seed(seed),
    )
    print(f"Train: {train_size} sequences, Val: {val_size} sequences.")

    batch_size = config["batch_size"]
    train_loader = DataLoader(
        train_dataset,
        batch_size=batch_size,
        shuffle=True,
        num_workers=4,
        pin_memory=(device.type == "cuda"),
        drop_last=True,
        persistent_workers=True,
    )
    val_loader = DataLoader(
        val_dataset,
        batch_size=batch_size,
        shuffle=False,
        num_workers=2,
        pin_memory=(device.type == "cuda"),
    )

    # --- Model ---
    mood_categories = config.get("mood_categories", [])
    model_config = MidiTransformerConfig(
        vocab_size=vocab_size,
        d_model=config["d_model"],
        n_heads=config["n_heads"],
        n_layers=config["n_layers"],
        d_ff=config["d_ff"],
        max_seq_len=max_seq_len,
        dropout=config["dropout"],
        n_moods=len(mood_categories),
        use_mood_conditioning=config.get("use_mood_conditioning", True),
    )
    model = MidiTransformer(model_config).to(device)

    # Try torch.compile for speed (PyTorch 2.x)
    compiled_model = model
    if hasattr(torch, "compile"):
        try:
            compiled_model = torch.compile(model)
            print("torch.compile enabled.")
        except Exception as e:
            print(f"torch.compile not available: {e}")
            compiled_model = model

    # --- Optimizer ---
    lr = config["learning_rate"]
    weight_decay = config.get("weight_decay", 0.1)

    # Separate weight-decay and no-weight-decay parameter groups
    decay_params = []
    no_decay_params = []
    for name, param in model.named_parameters():
        if not param.requires_grad:
            continue
        if param.dim() < 2 or "ln" in name or "bias" in name:
            no_decay_params.append(param)
        else:
            decay_params.append(param)

    optimizer = torch.optim.AdamW(
        [
            {"params": decay_params, "weight_decay": weight_decay},
            {"params": no_decay_params, "weight_decay": 0.0},
        ],
        lr=lr,
        betas=(0.9, 0.95),
        fused=(device.type == "cuda"),
    )

    # --- Gradient scaler for mixed precision ---
    scaler = torch.amp.GradScaler(enabled=use_bf16)

    # --- Resume ---
    start_step = 0
    if resume_path is not None and os.path.exists(resume_path):
        print(f"Resuming from {resume_path} ...")
        ckpt = torch.load(resume_path, map_location=device, weights_only=False)
        model.load_state_dict(ckpt["model_state_dict"])
        optimizer.load_state_dict(ckpt["optimizer_state_dict"])
        start_step = ckpt.get("step", 0)
        if "scaler_state_dict" in ckpt:
            scaler.load_state_dict(ckpt["scaler_state_dict"])
        print(f"Resumed at step {start_step}.")

    # --- Wandb ---
    use_wandb = "WANDB_API_KEY" in os.environ
    if use_wandb:
        import wandb
        wandb.init(
            project="midi-transformer",
            config={**config, "vocab_size": vocab_size, "num_params": model.num_parameters()},
        )
        wandb.watch(model, log_freq=500)
        print("Weights & Biases logging enabled.")
    else:
        print("WANDB_API_KEY not set; skipping wandb logging.")

    # --- Training ---
    max_steps = config["max_steps"]
    grad_clip = config["grad_clip"]
    save_every = config["save_every"]
    eval_every = config["eval_every"]
    log_every = config.get("log_every", 100)
    warmup_steps = config["warmup_steps"]
    checkpoint_dir = config["checkpoint_dir"]
    os.makedirs(checkpoint_dir, exist_ok=True)

    use_mood = config.get("use_mood_conditioning", True)

    print(f"\nStarting training from step {start_step} to {max_steps} ...")
    print(f"Batch size: {batch_size}, LR: {lr}, Grad clip: {grad_clip}")
    print(f"Checkpoints: {checkpoint_dir}, Save every: {save_every}\n")

    model.train()
    step = start_step
    running_loss = 0.0
    tokens_processed = 0
    t0 = time.time()

    data_iter = iter(train_loader)

    while step < max_steps:
        # Get next batch (cycle through data)
        try:
            batch = next(data_iter)
        except StopIteration:
            data_iter = iter(train_loader)
            batch = next(data_iter)

        input_ids = batch["input_ids"].to(device)      # (B, T)
        mood_ids = batch["mood_id"].to(device) if use_mood else None  # (B,)

        # LR schedule
        current_lr = get_lr(step, warmup_steps, max_steps, lr)
        for pg in optimizer.param_groups:
            pg["lr"] = current_lr

        # Forward
        with torch.amp.autocast(device_type=device.type, dtype=dtype, enabled=use_bf16):
            logits = compiled_model(input_ids[:, :-1], mood_ids=mood_ids)
            targets = input_ids[:, 1:]
            loss = nn.functional.cross_entropy(
                logits.reshape(-1, logits.size(-1)),
                targets.reshape(-1),
                ignore_index=0,  # PAD token = 0
            )

        # Backward
        optimizer.zero_grad(set_to_none=True)
        scaler.scale(loss).backward()
        scaler.unscale_(optimizer)
        torch.nn.utils.clip_grad_norm_(model.parameters(), grad_clip)
        scaler.step(optimizer)
        scaler.update()

        # Bookkeeping
        loss_val = loss.item()
        running_loss += loss_val
        tokens_processed += input_ids.numel()
        step += 1

        # --- Logging ---
        if step % log_every == 0:
            avg_loss = running_loss / log_every
            elapsed = time.time() - t0
            tok_per_sec = tokens_processed / elapsed
            print(
                f"step {step:>7d}/{max_steps} | "
                f"loss {avg_loss:.4f} | "
                f"lr {current_lr:.2e} | "
                f"tok/s {tok_per_sec:.0f} | "
                f"elapsed {elapsed:.1f}s"
            )
            if use_wandb:
                wandb.log({
                    "train/loss": avg_loss,
                    "train/lr": current_lr,
                    "train/tokens_per_sec": tok_per_sec,
                }, step=step)
            running_loss = 0.0
            tokens_processed = 0
            t0 = time.time()

        # --- Evaluation ---
        if step % eval_every == 0:
            val_loss = evaluate(compiled_model, val_loader, device, dtype, use_bf16, use_mood)
            print(f"  >> val_loss: {val_loss:.4f}")
            if use_wandb:
                wandb.log({"val/loss": val_loss}, step=step)
            model.train()

        # --- Checkpoint ---
        if step % save_every == 0:
            save_checkpoint(
                model, optimizer, scaler, step, model_config, config, checkpoint_dir,
            )

    # Final save
    save_checkpoint(model, optimizer, scaler, step, model_config, config, checkpoint_dir)
    print("\nTraining complete.")

    if use_wandb:
        wandb.finish()


# ============================================================================
# Evaluation
# ============================================================================

@torch.no_grad()
def evaluate(
    model: nn.Module,
    val_loader: DataLoader,
    device: torch.device,
    dtype: torch.dtype,
    use_bf16: bool,
    use_mood: bool,
) -> float:
    """Compute average validation loss."""
    model.eval()
    total_loss = 0.0
    total_batches = 0

    for batch in val_loader:
        input_ids = batch["input_ids"].to(device)
        mood_ids = batch["mood_id"].to(device) if use_mood else None

        with torch.amp.autocast(device_type=device.type, dtype=dtype, enabled=use_bf16):
            logits = model(input_ids[:, :-1], mood_ids=mood_ids)
            targets = input_ids[:, 1:]
            loss = nn.functional.cross_entropy(
                logits.reshape(-1, logits.size(-1)),
                targets.reshape(-1),
                ignore_index=0,
            )
        total_loss += loss.item()
        total_batches += 1

    return total_loss / max(total_batches, 1)


# ============================================================================
# Checkpoint
# ============================================================================

def save_checkpoint(
    model: MidiTransformer,
    optimizer: torch.optim.Optimizer,
    scaler: torch.amp.GradScaler,
    step: int,
    model_config: MidiTransformerConfig,
    train_config: dict,
    checkpoint_dir: str,
) -> None:
    """Save a training checkpoint."""
    path = os.path.join(checkpoint_dir, f"step_{step:07d}.pt")
    torch.save(
        {
            "step": step,
            "model_state_dict": model.state_dict(),
            "optimizer_state_dict": optimizer.state_dict(),
            "scaler_state_dict": scaler.state_dict(),
            "model_config": model_config.__dict__,
            "train_config": train_config,
        },
        path,
    )
    print(f"  >> Checkpoint saved: {path}")


# ============================================================================
# CLI
# ============================================================================

def main() -> None:
    parser = argparse.ArgumentParser(description="Train MIDI Transformer.")
    parser.add_argument(
        "--config", type=str, default="configs/default.yaml",
        help="Path to YAML config file.",
    )
    parser.add_argument(
        "--resume", type=str, default=None,
        help="Path to checkpoint to resume from.",
    )
    args = parser.parse_args()

    with open(args.config) as f:
        config = yaml.safe_load(f)

    train(config, resume_path=args.resume)


if __name__ == "__main__":
    main()
