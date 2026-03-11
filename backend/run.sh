#!/bin/bash
set -euo pipefail

# Default to mock engine for local UI development
# Set ENGINE_TYPE=replicate and REPLICATE_API_TOKEN for real music
export ENGINE_TYPE="${ENGINE_TYPE:-mock}"

uvicorn app.main:app --host 0.0.0.0 --port 8888 --reload
