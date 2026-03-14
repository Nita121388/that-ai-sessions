#!/usr/bin/env bash
set -euo pipefail

HOST="${TAS_HOST:-0.0.0.0}"
PORT="${TAS_PORT:-8787}"

python3 -m tas serve --host "$HOST" --port "$PORT"
