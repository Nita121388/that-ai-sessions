from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from .config import Config, config_path, discover_roots, load_config, save_config
from .index import SessionIndex
from .scanner import scan_sessions
from .updates import check_updates
from .util import read_text_limited, parse_time
from .web.server import AppServer


def main() -> None:
    parser = argparse.ArgumentParser(prog="tas", description="that-ai-sessions CLI")
    parser.add_argument("--config", help="Path to config.toml")

    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("status", help="Show scan status")

    list_p = sub.add_parser("list", help="List sessions")
    list_p.add_argument("--limit", type=int, default=0, help="Max items")
    list_p.add_argument("--offset", type=int, default=0, help="Skip first N items")
    list_p.add_argument("--since", help="Filter mtime >= since (timestamp or ISO date)")
    list_p.add_argument("--until", help="Filter mtime <= until (timestamp or ISO date)")
    list_p.add_argument("--preview", action="store_true", help="Include preview text")
    list_p.add_argument("--json", action="store_true", help="JSON output")

    show_p = sub.add_parser("show", help="Show a session")
    show_p.add_argument("--path", help="Absolute path to session file")
    show_p.add_argument("--id", help="Session id from list")
    show_p.add_argument("--full", action="store_true", help="Read full content")
    show_p.add_argument("--confirm", action="store_true", help="Confirm large content")
    show_p.add_argument("--json", action="store_true", help="JSON output")

    serve_p = sub.add_parser("serve", help="Run web server")
    serve_p.add_argument("--host", help="Bind host")
    serve_p.add_argument("--port", type=int, help="Bind port")

    sub.add_parser("discover", help="Suggest session roots")

    config_p = sub.add_parser("config", help="Config commands")
    config_sub = config_p.add_subparsers(dest="config_cmd", required=True)
    config_init = config_sub.add_parser("init", help="Write default config")
    config_init.add_argument("--force", action="store_true", help="Overwrite existing config")

    updates_p = sub.add_parser("updates", help="Update checks")
    updates_sub = updates_p.add_subparsers(dest="updates_cmd", required=True)
    updates_sub.add_parser("check", help="Check update targets")

    args = parser.parse_args()

    cfg = load_config(_config_path(args.config))

    if args.cmd == "status":
        _cmd_status(cfg)
        return
    if args.cmd == "list":
        _cmd_list(cfg, args)
        return
    if args.cmd == "show":
        _cmd_show(cfg, args)
        return
    if args.cmd == "serve":
        _cmd_serve(cfg, args)
        return
    if args.cmd == "discover":
        _cmd_discover()
        return
    if args.cmd == "config" and args.config_cmd == "init":
        _cmd_config_init(cfg, args)
        return
    if args.cmd == "updates" and args.updates_cmd == "check":
        _cmd_updates(cfg)
        return


def _config_path(value: str | None) -> Path | None:
    if value:
        return Path(value).expanduser()
    return None


def _cmd_status(cfg: Config) -> None:
    sessions = scan_sessions(cfg)
    payload = {
        "session_count": len(sessions),
        "last_scan": time.time(),
        "roots": cfg.session_roots,
    }
    print(json.dumps(payload, ensure_ascii=True))


def _cmd_list(cfg: Config, args: argparse.Namespace) -> None:
    sessions = scan_sessions(cfg, include_preview=args.preview)
    since = parse_time(args.since)
    until = parse_time(args.until)
    if since is not None or until is not None:
        filtered = []
        for entry in sessions:
            if since is not None and entry.mtime < since:
                continue
            if until is not None and entry.mtime > until:
                continue
            filtered.append(entry)
        sessions = filtered
    if args.offset:
        sessions = sessions[args.offset :]
    if args.limit:
        sessions = sessions[: args.limit]
    if args.json:
        payload = {
            "sessions": [s.__dict__ for s in sessions],
        }
        print(json.dumps(payload, ensure_ascii=True))
        return
    for entry in sessions:
        preview_flag = " preview" if entry.preview_truncated else ""
        print(f"{entry.mtime:.0f} {entry.size:>8} {entry.path}{preview_flag}")
        if args.preview and entry.preview:
            print(entry.preview)
            print("---")


def _cmd_show(cfg: Config, args: argparse.Namespace) -> None:
    if not args.path and not args.id:
        print("--path or --id required", file=sys.stderr)
        sys.exit(2)
    path = None
    if args.id:
        sessions = scan_sessions(cfg)
        for entry in sessions:
            if entry.id == args.id:
                path = Path(entry.path)
                break
        if not path:
            print("id not found", file=sys.stderr)
            sys.exit(2)
    else:
        path = Path(args.path).expanduser().resolve()
    if not _is_under_roots(path, cfg.session_roots):
        print("path not under session_roots", file=sys.stderr)
        sys.exit(3)
    size = path.stat().st_size
    if args.full and size > cfg.confirm_bytes and not args.confirm:
        print("WARNING: content is large, re-run with --confirm", file=sys.stderr)
        sys.exit(4)
    max_bytes = cfg.full_bytes if args.full else cfg.preview_bytes
    text, truncated, _size = read_text_limited(path, max_bytes)
    payload = {
        "path": str(path),
        "size": size,
        "text": text,
        "truncated": truncated,
        "full": bool(args.full),
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=True))
        return
    print(text)
    if truncated:
        print("[truncated]")


def _cmd_serve(cfg: Config, args: argparse.Namespace) -> None:
    if args.host:
        cfg.host = args.host
    if args.port:
        cfg.port = args.port
    index = SessionIndex(cfg)
    index.scan_now()
    index.start()
    server = AppServer(cfg, index)
    print(f"Serving on http://{cfg.host}:{cfg.port}")
    server.serve()


def _cmd_discover() -> None:
    roots = discover_roots()
    payload = {"roots": roots}
    print(json.dumps(payload, ensure_ascii=True))


def _cmd_config_init(cfg: Config, args: argparse.Namespace) -> None:
    path = config_path()
    if path.exists() and not args.force:
        print(f"config exists: {path}")
        return
    save_config(cfg, path)
    print(f"wrote config: {path}")


def _cmd_updates(cfg: Config) -> None:
    if not cfg.update_targets:
        print("no update_targets configured")
        return
    results = check_updates(cfg.update_targets)
    print(json.dumps({"targets": results}, ensure_ascii=True))


def _is_under_roots(path: Path, roots: list[str]) -> bool:
    for root in roots:
        root_path = Path(root).expanduser().resolve()
        try:
            path.relative_to(root_path)
            return True
        except ValueError:
            continue
    return False
