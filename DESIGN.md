# Design: that-ai-sessions

## Goals
- Show session count, recent activity, and session content preview.
- Provide a simple web UI (mobile friendly via Tailscale).
- Provide a CLI for all interfaces (list, show, status, updates).
- Keep structure clean, easy to extend, and low-dependency.
- Minimize bandwidth: preview-first, on-demand full text.

## Non-goals (for v1)
- True real-time streaming.
- Parsing proprietary formats (only best-effort file viewing).
- Automatic upgrades without user approval.

## Architecture (v1)
- Language: Python 3 (stdlib-only where possible).
- Config: TOML at `~/.config/that-ai-sessions/config.toml`.
- Data: `~/.local/share/that-ai-sessions/`.
- Web: built-in HTTP server + static UI.
- Scanner: periodic file scan over configured session roots.
- Response optimization: gzip when client accepts, ETag/If-Modified-Since for JSON + static assets.

### Core Modules
- `config.py`: load/validate config, defaults.
- `scanner.py`: discover session roots, scan files, build session list.
- `index.py`: in-memory index + periodic refresh.
- `web/server.py`: HTTP API + static UI.
- `cli.py`: argparse-based CLI.

## Data Model (in-memory)
SessionEntry:
- `id`: stable id (hash of path)
- `path`: absolute file path
- `mtime`: last modified time (unix)
- `size`: bytes
- `preview`: truncated text
- `preview_truncated`: bool
- `full_truncated`: bool (when full fetch capped)

## Session Discovery
- `tas discover` scans common locations and suggests roots:
  - `~/.local/share` (codex/openai)
  - `~/.config` (codex/openai)
  - `~/.cache` (codex/openai)
- Default config uses discovered roots if found.

## Scanning Rules
- Include glob list (default): `**/*.jsonl`, `**/*.json`, `**/*.log`, `**/*.txt`, `**/*.md`.
- Exclude globs: `.git`, `node_modules`, `.venv`, `__pycache__`, `.cache` (optional).
- Session count = number of matched files.
- Recent activity = top N by `mtime`.

## API
- `GET /api/status` -> counts + last scan time.
- `GET /api/sessions` -> list of sessions (metadata only).
- `GET /api/sessions?lite=1` -> counts + recent list without previews (lowest bandwidth).
- `GET /api/session?path=...&full=0|1` -> preview or full text.
- `GET /api/session?path=...&full=1&confirm=1` -> allow full text even if over confirm threshold.
- `GET /api/updates` -> update check results (optional config).

## UI
- Single-page view with:
  - Summary (count, last scan, refresh interval)
  - Recent sessions list
  - Detail panel: preview + button to view full
- Code folding:
  - Long lines are truncated in preview; full view shows full content.
  - Optional toggle for line wrap.
- Full text warning:
  - If content length exceeds `confirm_bytes`, show ⚠️ and require a second confirm click.
- "Show all full text" view is supported but guarded by the same warning/confirm when large.

## CLI
- `tas status`
- `tas list`
- `tas show --path <file> [--full]`
- `tas serve --host 0.0.0.0 --port 8787`
- `tas discover`
- `tas updates check`

## Update Checks (optional)
- Config `update_targets = ["owner/repo", ...]`.
- Uses GitHub API `releases/latest`.
- Reports only (no auto-update by default).

## Security
- Only serve files under configured roots.
- Max preview bytes; max full bytes (configurable).
- Full-text requests can be denied unless `confirm=1` when content exceeds threshold.

## Extensibility
- Add new scanners via a small plugin interface (`plugins/`).
- Add new UI panels via `web/app.js`.

## Default Config (proposed)
- refresh_interval_sec = 30
- host = "0.0.0.0"
- port = 8787
- preview_bytes = 16_384
- full_bytes = 1_000_000
- confirm_bytes = 131_072

## Milestones
1) Repo scaffold + config/CLI/server + basic UI
2) Session discovery + scanning + preview
3) Update checker + polish + docs
