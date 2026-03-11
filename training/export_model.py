#!/usr/bin/env python3
"""
Export a trained MIDI Transformer checkpoint for CPU inference.

Creates a self-contained directory with:
  - model.pt          (float32 state dict)
  - model_config.json (model hyperparameters)
  - tokenizer.json    (miditok tokenizer)
  - train_config.yaml (training config snapshot)
  - model.onnx        (optional ONNX export for faster CPU inference)

Usage:
    python export_model.py --checkpoint checkpoints/step_0100000.pt --output ./exported/
    python export_model.py --checkpoint checkpoints/step_0100000.pt --output ./exported/ --onnx
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path

import torch
import yaml

from model import MidiTransformer, MidiTransformerConfig


def export_model(
    checkpoint_path: str,
    output_dir: str,
    tokenizer_path: str = "./data/tokenizer.json",
    export_onnx: bool = False,
) -> None:
    """Export a trained model for CPU inference."""
    os.makedirs(output_dir, exist_ok=True)

    # --- Load checkpoint ---
    print(f"Loading checkpoint: {checkpoint_path}")
    ckpt = torch.load(checkpoint_path, map_location="cpu", weights_only=False)

    model_config_dict = ckpt["model_config"]
    train_config = ckpt.get("train_config", {})
    step = ckpt.get("step", 0)

    # --- Reconstruct model ---
    model_config = MidiTransformerConfig(**model_config_dict)
    model = MidiTransformer(model_config)
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()
    model = model.float()  # ensure float32

    print(f"Model loaded (step {step}, {model.num_parameters() / 1e6:.2f}M params).")

    # --- Save model weights ---
    weights_path = os.path.join(output_dir, "model.pt")
    torch.save(model.state_dict(), weights_path)
    print(f"  Weights saved: {weights_path}")

    # --- Save model config ---
    config_path = os.path.join(output_dir, "model_config.json")
    with open(config_path, "w") as f:
        json.dump(model_config_dict, f, indent=2)
    print(f"  Model config saved: {config_path}")

    # --- Copy tokenizer ---
    if os.path.exists(tokenizer_path):
        dst = os.path.join(output_dir, "tokenizer.json")
        shutil.copy2(tokenizer_path, dst)
        print(f"  Tokenizer copied: {dst}")
    else:
        print(f"  WARNING: Tokenizer not found at {tokenizer_path}")

    # --- Save training config snapshot ---
    if train_config:
        tc_path = os.path.join(output_dir, "train_config.yaml")
        with open(tc_path, "w") as f:
            yaml.dump(train_config, f, default_flow_style=False)
        print(f"  Training config saved: {tc_path}")

    # --- Optional ONNX export ---
    if export_onnx:
        onnx_path = os.path.join(output_dir, "model.onnx")
        print(f"\nExporting to ONNX: {onnx_path}")
        _export_onnx(model, model_config, onnx_path)

    # --- Summary ---
    total_size_mb = sum(
        os.path.getsize(os.path.join(output_dir, f))
        for f in os.listdir(output_dir)
    ) / (1024 * 1024)

    print(f"\nExport complete.")
    print(f"  Output directory: {output_dir}")
    print(f"  Total size: {total_size_mb:.1f} MB")
    print(f"  Training step: {step}")
    print(f"  Parameters: {model.num_parameters() / 1e6:.2f}M")


def _export_onnx(
    model: MidiTransformer,
    config: MidiTransformerConfig,
    onnx_path: str,
) -> None:
    """Export the model to ONNX format for CPU inference."""
    try:
        import onnx
    except ImportError:
        print("  onnx package not installed. Skipping ONNX export.")
        return

    model.eval()
    seq_len = 64  # small example for tracing

    # Create dummy inputs
    dummy_ids = torch.randint(0, config.vocab_size, (1, seq_len), dtype=torch.long)
    input_names = ["input_ids"]
    dynamic_axes = {"input_ids": {1: "seq_len"}, "logits": {1: "seq_len"}}

    if config.use_mood_conditioning:
        dummy_mood = torch.tensor([0], dtype=torch.long)
        inputs = (dummy_ids, dummy_mood)
        input_names.append("mood_ids")
        dynamic_axes["mood_ids"] = {}
    else:
        inputs = (dummy_ids,)

    torch.onnx.export(
        model,
        inputs,
        onnx_path,
        input_names=input_names,
        output_names=["logits"],
        dynamic_axes=dynamic_axes,
        opset_version=17,
        do_constant_folding=True,
    )

    # Validate
    onnx_model = onnx.load(onnx_path)
    onnx.checker.check_model(onnx_model)
    size_mb = os.path.getsize(onnx_path) / (1024 * 1024)
    print(f"  ONNX model saved ({size_mb:.1f} MB), validated OK.")


# ============================================================================
# CLI
# ============================================================================

def main() -> None:
    parser = argparse.ArgumentParser(description="Export trained MIDI Transformer.")
    parser.add_argument(
        "--checkpoint", type=str, required=True,
        help="Path to training checkpoint (.pt).",
    )
    parser.add_argument(
        "--output", type=str, default="./exported/",
        help="Output directory for exported model.",
    )
    parser.add_argument(
        "--tokenizer", type=str, default="./data/tokenizer.json",
        help="Path to tokenizer.json.",
    )
    parser.add_argument(
        "--onnx", action="store_true",
        help="Also export to ONNX format.",
    )
    args = parser.parse_args()

    export_model(
        checkpoint_path=args.checkpoint,
        output_dir=args.output,
        tokenizer_path=args.tokenizer,
        export_onnx=args.onnx,
    )


if __name__ == "__main__":
    main()
