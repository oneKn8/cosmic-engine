#!/bin/bash
# ============================================================================
# Setup script for NVIDIA Brev GPU instance
# Run this after SSH-ing into the Brev instance.
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "=== Setting up MIDI Transformer training environment ==="
echo "Working directory: $PROJECT_DIR"

# System deps
echo "--- Installing system dependencies ---"
sudo apt-get update -qq && sudo apt-get install -y -qq git wget fluidsynth

# Python env
echo "--- Creating Python virtual environment ---"
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip -q

# Install training requirements
echo "--- Installing Python packages ---"
pip install -r requirements.txt -q

# Download Lakh MIDI dataset
echo "--- Downloading Lakh MIDI Full dataset ---"
mkdir -p data/midi
cd data
if [ ! -d "midi/lmd_full" ]; then
    wget -q --show-progress http://hog.ee.columbia.edu/craffel/lmd/lmd_full.tar.gz
    echo "Extracting (this takes a while)..."
    tar xzf lmd_full.tar.gz -C midi/
    rm lmd_full.tar.gz
    echo "Dataset extracted."
else
    echo "Dataset already exists, skipping download."
fi
cd "$PROJECT_DIR"

# Prepare tokenized dataset
echo "--- Preparing tokenized dataset ---"
source .venv/bin/activate
python data/prepare_data.py --config configs/default.yaml

echo ""
echo "=== Setup complete ==="
echo "Activate the environment:  source .venv/bin/activate"
echo "Start training:            python train.py --config configs/default.yaml"
echo "Resume training:           python train.py --config configs/default.yaml --resume checkpoints/step_XXXXX.pt"
