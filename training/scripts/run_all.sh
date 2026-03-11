#!/bin/bash
# Run data preparation (auto-restart on segfault) then training
set -uo pipefail

cd ~/training
source .venv/bin/activate

echo "=== Starting data preparation (crash-resilient) ==="
MAX_RETRIES=50
RETRY=0
while [ $RETRY -lt $MAX_RETRIES ]; do
    python data/prepare_data.py --config configs/default.yaml
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 0 ]; then
        echo "Data preparation completed successfully."
        break
    elif [ $EXIT_CODE -eq 139 ] || [ $EXIT_CODE -eq 134 ] || [ $EXIT_CODE -eq 137 ]; then
        RETRY=$((RETRY + 1))
        echo ""
        echo ">>> Crash detected (exit code $EXIT_CODE), restarting from saved progress (attempt $RETRY/$MAX_RETRIES) <<<"
        echo ""
        sleep 2
    else
        echo "Data preparation failed with exit code $EXIT_CODE"
        exit $EXIT_CODE
    fi
done

if [ $RETRY -ge $MAX_RETRIES ]; then
    echo "Too many crashes ($MAX_RETRIES). Aborting."
    exit 1
fi

echo ""
echo "=== Starting training ==="
python train.py --config configs/default.yaml
