from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import json
import gzip
import hashlib
import time

from ..config import Config
from ..index import SessionIndex
from ..scanner import SessionEntry
from ..util import read_text_limited, parse_time, bucket_start
from ..updates import check_updates


class AppServer:
    def __init__(self, cfg: Config, index: SessionIndex) -> None:
        self.cfg = cfg
        self.index = index
        self.static_dir = Path(__file__).resolve().parent / "static"

    def serve(self) -> None:
        server = ThreadingHTTPServer((self.cfg.host, self.cfg.port), self._handler())
        try:
            server.serve_forever()
        finally:
            server.server_close()

    def _handler(self):
        app = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                parsed = urlparse(self.path)
                if parsed.path.startswith("/api/"):
                    self._handle_api(parsed)
                    return
                self._handle_static(parsed.path)

            def _handle_api(self, parsed):
                if parsed.path == "/api/status":
                    self._handle_status()
                    return
                if parsed.path == "/api/sessions":
                    self._handle_sessions(parsed)
                    return
                if parsed.path == "/api/session":
                    self._handle_session(parsed)
                    return
                if parsed.path == "/api/updates":
                    self._handle_updates()
                    return
                if parsed.path == "/api/stats":
                    self._handle_stats(parsed)
                    return
                self._send_json(404, {"error": "not_found"})

            def _handle_status(self):
                payload = {
                    "session_count": len(app.index.get_sessions()),
                    "last_scan": app.index.last_scan(),
                    "refresh_interval_sec": app.cfg.refresh_interval_sec,
                    "roots": app.cfg.session_roots,
                    "confirm_bytes": app.cfg.confirm_bytes,
                    "preview_bytes": app.cfg.preview_bytes,
                    "full_bytes": app.cfg.full_bytes,
                }
                self._send_json(200, payload, cacheable=False)

            def _handle_sessions(self, parsed):
                qs = parse_qs(parsed.query)
                lite = _truthy(qs.get("lite", ["0"])[0])
                preview = _truthy(qs.get("preview", ["0"])[0])
                limit = int(qs.get("limit", [str(app.cfg.max_recent)])[0])
                offset = int(qs.get("offset", ["0"])[0])
                since = parse_time(qs.get("since", [""])[0])
                until = parse_time(qs.get("until", [""])[0])
                if lite:
                    payload = {
                        "session_count": len(app.index.get_sessions()),
                        "last_scan": app.index.last_scan(),
                    }
                    self._send_json(200, payload, cacheable=False)
                    return
                sessions = _filter_sessions(app.index.get_sessions(), since, until)
                total = len(sessions)
                if offset:
                    sessions = sessions[offset:]
                if limit and len(sessions) > limit:
                    sessions = sessions[:limit]
                items = []
                if preview:
                    for entry in sessions:
                        item = _entry_to_dict(entry)
                        path = Path(entry.path)
                        try:
                            text, truncated, _size = read_text_limited(path, app.cfg.preview_bytes)
                        except OSError:
                            continue
                        item["preview"] = text
                        item["preview_truncated"] = truncated
                        items.append(item)
                else:
                    items = [_entry_to_dict(entry) for entry in sessions]
                self._send_json(200, {"sessions": items, "total": total, "offset": offset, "limit": limit})

            def _handle_session(self, parsed):
                qs = parse_qs(parsed.query)
                full = _truthy(qs.get("full", ["0"])[0])
                confirm = _truthy(qs.get("confirm", ["0"])[0])
                path_param = qs.get("path", [""])[0]
                session_id = qs.get("id", [""])[0]

                entry = None
                if session_id:
                    entry = app.index.get_session_by_id(session_id)
                    if not entry:
                        self._send_json(404, {"error": "not_found"})
                        return
                    path = Path(entry.path)
                elif path_param:
                    path = Path(path_param).expanduser().resolve()
                    if not _is_under_roots(path, app.cfg.session_roots):
                        self._send_json(403, {"error": "forbidden"})
                        return
                else:
                    self._send_json(400, {"error": "missing_path"})
                    return

                try:
                    stat = path.stat()
                except OSError:
                    self._send_json(404, {"error": "not_found"})
                    return

                size = stat.st_size
                if full and size > app.cfg.confirm_bytes and not confirm:
                    self._send_json(
                        409,
                        {
                            "error": "confirm_required",
                            "size": size,
                            "confirm_bytes": app.cfg.confirm_bytes,
                        },
                    )
                    return

                max_bytes = app.cfg.full_bytes if full else app.cfg.preview_bytes
                try:
                    text, truncated, _size = read_text_limited(path, max_bytes)
                except OSError:
                    self._send_json(404, {"error": "not_found"})
                    return

                payload = {
                    "path": str(path),
                    "size": size,
                    "mtime": stat.st_mtime,
                    "text": text,
                    "truncated": truncated,
                    "full": full,
                    "ext": path.suffix.lower().lstrip(".") or "other",
                }
                self._send_json(200, payload)

            def _handle_updates(self):
                targets = list(app.cfg.update_targets)
                if not targets:
                    self._send_json(200, {"targets": [], "message": "no_targets"})
                    return
                qs = parse_qs(urlparse(self.path).query)
                do_check = _truthy(qs.get("check", ["0"])[0])
                if do_check:
                    results = check_updates(targets)
                    self._send_json(200, {"targets": results})
                    return
                self._send_json(200, {"targets": [{"target": t, "status": "not_checked"} for t in targets]})

            def _handle_stats(self, parsed):
                qs = parse_qs(parsed.query)
                since = parse_time(qs.get("since", [""])[0])
                until = parse_time(qs.get("until", [""])[0])
                bucket = qs.get("bucket", ["hour"])[0]
                if bucket not in {"hour", "day"}:
                    bucket = "hour"
                sessions = _filter_sessions(app.index.get_sessions(), since, until)
                total = len(sessions)
                type_counts: dict[str, int] = {}
                for entry in sessions:
                    ext = Path(entry.path).suffix.lower().lstrip(".") or "other"
                    type_counts[ext] = type_counts.get(ext, 0) + 1
                buckets: list[dict[str, float | int]] = []
                if sessions:
                    min_ts = since if since is not None else min(s.mtime for s in sessions)
                    max_ts = until if until is not None else max(s.mtime for s in sessions)
                    start = bucket_start(min_ts, bucket)
                    end = bucket_start(max_ts, bucket)
                    step = 3600 if bucket == "hour" else 86400
                    counts: dict[float, int] = {}
                    for entry in sessions:
                        b = bucket_start(entry.mtime, bucket)
                        counts[b] = counts.get(b, 0) + 1
                    current = start
                    while current <= end:
                        buckets.append({"start": current, "count": counts.get(current, 0)})
                        current += step
                payload = {
                    "total": total,
                    "types": type_counts,
                    "bucket": bucket,
                    "buckets": buckets,
                    "since": since,
                    "until": until,
                }
                self._send_json(200, payload)

            def _handle_static(self, path: str):
                if path == "/":
                    path = "/index.html"
                file_path = (app.static_dir / path.lstrip("/")).resolve()
                if not str(file_path).startswith(str(app.static_dir)):
                    self.send_error(403)
                    return
                if not file_path.exists() or not file_path.is_file():
                    self.send_error(404)
                    return
                content = file_path.read_bytes()
                content_type = _content_type(file_path.suffix)
                etag = _etag_bytes(content)
                if self.headers.get("If-None-Match") == etag:
                    self.send_response(304)
                    self.end_headers()
                    return
                self._send_bytes(200, content, content_type, etag)

            def _send_json(self, status: int, payload: dict, cacheable: bool = True) -> None:
                data = json.dumps(payload, ensure_ascii=True).encode("utf-8")
                etag = _etag_bytes(data)
                if cacheable and self.headers.get("If-None-Match") == etag:
                    self.send_response(304)
                    self.end_headers()
                    return
                self._send_bytes(status, data, "application/json", etag)

            def _send_bytes(self, status: int, data: bytes, content_type: str, etag: str | None = None) -> None:
                accept = self.headers.get("Accept-Encoding", "")
                compressed = False
                if "gzip" in accept:
                    data = gzip.compress(data)
                    compressed = True
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                if etag:
                    self.send_header("ETag", etag)
                if compressed:
                    self.send_header("Content-Encoding", "gzip")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, format: str, *args) -> None:
                return

        return Handler


def _entry_to_dict(entry: SessionEntry) -> dict:
    ext = Path(entry.path).suffix.lower().lstrip(".") or "other"
    return {
        "id": entry.id,
        "path": entry.path,
        "mtime": entry.mtime,
        "size": entry.size,
        "preview_truncated": entry.preview_truncated,
        "ext": ext,
    }


def _etag_bytes(data: bytes) -> str:
    return hashlib.sha1(data).hexdigest()


def _content_type(suffix: str) -> str:
    if suffix == ".html":
        return "text/html; charset=utf-8"
    if suffix == ".css":
        return "text/css; charset=utf-8"
    if suffix == ".js":
        return "application/javascript; charset=utf-8"
    if suffix == ".json":
        return "application/json; charset=utf-8"
    return "application/octet-stream"


def _truthy(value: str) -> bool:
    return value.lower() in {"1", "true", "yes", "on"}


def _is_under_roots(path: Path, roots: list[str]) -> bool:
    for root in roots:
        root_path = Path(root).expanduser().resolve()
        try:
            path.relative_to(root_path)
            return True
        except ValueError:
            continue
    return False


def _filter_sessions(sessions: list[SessionEntry], since: float | None, until: float | None) -> list[SessionEntry]:
    if since is None and until is None:
        return sessions
    filtered: list[SessionEntry] = []
    for entry in sessions:
        if since is not None and entry.mtime < since:
            continue
        if until is not None and entry.mtime > until:
            continue
        filtered.append(entry)
    return filtered
