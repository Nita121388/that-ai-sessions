# that-ai-sessions

Local session monitor for Codex/OpenClaw style workflows. Preview-first, low bandwidth, and CLI-friendly.
Includes time filtering, JSON timeline rendering, and paging for large lists.

## Quick start

```bash
# optional: write config with discovered roots
./scripts/init.sh

# run server
./scripts/run.sh
```

Open the web UI:

- `http://localhost:8787`
- Tailscale example: `http://100.87.174.7:8787`

## CLI

```bash
python3 -m tas status
python3 -m tas list --json
python3 -m tas list --since \"2026-03-01 00:00\" --until \"2026-03-14 23:59\"
python3 -m tas show --id <session_id> --full --confirm
python3 -m tas serve --host 0.0.0.0 --port 8787
```

## Config

Path: `~/.config/that-ai-sessions/config.toml`

```toml
session_roots = ["/path/to/sessions"]
include_globs = ["**/*.jsonl", "**/*.json", "**/*.log", "**/*.txt", "**/*.md"]
exclude_globs = [".git", "node_modules", ".venv", "__pycache__", ".cache"]
refresh_interval_sec = 30
host = "0.0.0.0"
port = 8787
preview_bytes = 16384
full_bytes = 1000000
confirm_bytes = 131072
max_recent = 200
update_targets = []
```

## Notes

- Preview is default to save bandwidth; full text requires an explicit action.
- Large full-text reads trigger a warning and require confirmation.
- Only files under `session_roots` are served.
- JSON/JSONL sessions are rendered as a timeline with field-based styling.
