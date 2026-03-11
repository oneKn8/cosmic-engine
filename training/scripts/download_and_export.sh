#!/bin/bash
# Download best checkpoint from Brev and export for local inference.
#
# Usage:
#   bash scripts/download_and_export.sh                    # auto-pick latest checkpoint
#   bash scripts/download_and_export.sh step_050000.pt     # specific checkpoint
#   bash scripts/download_and_export.sh --best             # pick lowest-loss checkpoint
set -euo pipefail

REMOTE="cosmic"
REMOTE_TRAINING_DIR="~/training"
REMOTE_CKPT_DIR="$REMOTE_TRAINING_DIR/checkpoints"
REMOTE_TOKENIZER="$REMOTE_TRAINING_DIR/data/tokenizer.json"

LOCAL_TRAINING_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_CKPT_DIR="$LOCAL_TRAINING_DIR/checkpoints"
LOCAL_EXPORT_DIR="$LOCAL_TRAINING_DIR/../backend/exported"

mkdir -p "$LOCAL_CKPT_DIR" "$LOCAL_EXPORT_DIR"

# ── Step 0: Check remote is reachable ──
echo "Checking connection to $REMOTE..."
if ! ssh -o ConnectTimeout=5 "$REMOTE" "echo ok" >/dev/null 2>&1; then
    echo "ERROR: Cannot reach $REMOTE. Is the Brev instance running?"
    exit 1
fi

# ── Step 1: Check training status ──
echo ""
echo "=== Remote Training Status ==="
ssh "$REMOTE" "
    if pgrep -f train.py >/dev/null 2>&1; then
        echo 'STATUS: Training is RUNNING'
    elif pgrep -f prepare_data.py >/dev/null 2>&1; then
        echo 'STATUS: Data prep is still RUNNING'
    else
        echo 'STATUS: No training process detected'
    fi
    echo ''
    echo 'Checkpoints available:'
    ls -lh $REMOTE_CKPT_DIR/*.pt 2>/dev/null || echo '  (none yet)'
    echo ''
    if [ -f $REMOTE_TRAINING_DIR/data/processed/_progress.json ]; then
        echo 'Data prep progress:'
        cat $REMOTE_TRAINING_DIR/data/processed/_progress.json
        echo ''
    fi
    if [ -f $REMOTE_TRAINING_DIR/checkpoints/train_log.json ]; then
        echo 'Latest training log entry:'
        tail -1 $REMOTE_TRAINING_DIR/checkpoints/train_log.json
    fi
"

# ── Step 2: Select checkpoint ──
CKPT_NAME="${1:-}"

if [ "$CKPT_NAME" = "--best" ]; then
    echo ""
    echo "=== Selecting best (lowest-loss) checkpoint ==="
    CKPT_NAME=$(ssh "$REMOTE" "
        if [ -f $REMOTE_CKPT_DIR/train_log.json ]; then
            python3 -c \"
import json, sys
best_step, best_loss = None, float('inf')
for line in open('$REMOTE_CKPT_DIR/train_log.json'):
    entry = json.loads(line)
    if 'val_loss' in entry and entry['val_loss'] < best_loss:
        best_loss = entry['val_loss']
        best_step = entry['step']
if best_step:
    print(f'step_{best_step:06d}.pt')
else:
    print('NONE')
\"
        else
            echo 'NONE'
        fi
    ")
    if [ "$CKPT_NAME" = "NONE" ]; then
        echo "No validation logs found. Falling back to latest checkpoint."
        CKPT_NAME=""
    else
        echo "Best checkpoint: $CKPT_NAME"
    fi
fi

if [ -z "$CKPT_NAME" ]; then
    echo ""
    echo "=== Selecting latest checkpoint ==="
    CKPT_NAME=$(ssh "$REMOTE" "ls -t $REMOTE_CKPT_DIR/step_*.pt 2>/dev/null | head -1 | xargs -r basename")
    if [ -z "$CKPT_NAME" ]; then
        echo "ERROR: No checkpoints found on remote. Training hasn't saved any yet."
        exit 1
    fi
    echo "Latest checkpoint: $CKPT_NAME"
fi

# ── Step 3: Download checkpoint + tokenizer ──
echo ""
echo "=== Downloading checkpoint ==="
LOCAL_CKPT="$LOCAL_CKPT_DIR/$CKPT_NAME"

if [ -f "$LOCAL_CKPT" ]; then
    echo "Checkpoint already exists locally: $LOCAL_CKPT"
else
    echo "Downloading $CKPT_NAME..."
    scp "$REMOTE:$REMOTE_CKPT_DIR/$CKPT_NAME" "$LOCAL_CKPT"
    echo "Downloaded: $LOCAL_CKPT ($(du -h "$LOCAL_CKPT" | cut -f1))"
fi

echo ""
echo "=== Downloading tokenizer ==="
LOCAL_TOKENIZER="$LOCAL_TRAINING_DIR/data/tokenizer.json"
mkdir -p "$(dirname "$LOCAL_TOKENIZER")"
scp "$REMOTE:$REMOTE_TOKENIZER" "$LOCAL_TOKENIZER" 2>/dev/null && \
    echo "Tokenizer downloaded: $LOCAL_TOKENIZER" || \
    echo "WARNING: Tokenizer not found on remote (data prep may not be done yet)"

# ── Step 4: Export for inference ──
echo ""
echo "=== Exporting model ==="
cd "$LOCAL_TRAINING_DIR"

# Activate backend venv (has torch + dependencies)
if [ -f ../backend/.venv/bin/activate ]; then
    source ../backend/.venv/bin/activate
elif [ -f .venv/bin/activate ]; then
    source .venv/bin/activate
fi

python export_model.py \
    --checkpoint "$LOCAL_CKPT" \
    --output "$LOCAL_EXPORT_DIR" \
    --tokenizer "$LOCAL_TOKENIZER"

# ── Step 5: Verify ──
echo ""
echo "=== Exported artifacts ==="
ls -lh "$LOCAL_EXPORT_DIR/"

echo ""
echo "=== Done ==="
echo "Model exported to: $LOCAL_EXPORT_DIR"
echo ""
echo "To use it, set ENGINE_TYPE=midi_transformer in your backend .env"
echo "Then start the backend: cd backend && python -m app.main"
