from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
import fnmatch

from .config import Config
from .util import hash_path, read_text_limited


@dataclass
class SessionEntry:
    id: str
    path: str
    mtime: float
    size: int
    preview: str | None = None
    preview_truncated: bool = False


def scan_sessions(cfg: Config, include_preview: bool = False) -> list[SessionEntry]:
    entries: list[SessionEntry] = []
    roots = [Path(p).expanduser() for p in cfg.session_roots]
    for root in roots:
        if not root.exists() or not root.is_dir():
            continue
        for path in _iter_files(root, cfg.include_globs, cfg.exclude_globs):
            try:
                stat = path.stat()
            except OSError:
                continue
            entry = SessionEntry(
                id=hash_path(path),
                path=str(path),
                mtime=stat.st_mtime,
                size=stat.st_size,
            )
            if include_preview:
                preview, truncated, _size = read_text_limited(path, cfg.preview_bytes)
                entry.preview = preview
                entry.preview_truncated = truncated
            entries.append(entry)
    entries.sort(key=lambda e: e.mtime, reverse=True)
    if cfg.max_recent and len(entries) > cfg.max_recent:
        return entries[: cfg.max_recent]
    return entries


def _iter_files(root: Path, include_globs: list[str], exclude_globs: list[str]) -> Iterable[Path]:
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if _is_excluded(path, root, exclude_globs):
            continue
        rel = path.relative_to(root).as_posix()
        if not _matches_any(rel, include_globs):
            continue
        yield path


def _matches_any(rel_path: str, patterns: list[str]) -> bool:
    for pattern in patterns:
        if fnmatch.fnmatch(rel_path, pattern):
            return True
    return False


def _is_excluded(path: Path, root: Path, exclude_globs: list[str]) -> bool:
    rel = path.relative_to(root).as_posix()
    parts = set(path.parts)
    for pattern in exclude_globs:
        if "*" not in pattern and "?" not in pattern and "/" not in pattern:
            if pattern in parts:
                return True
        if fnmatch.fnmatch(rel, pattern):
            return True
    return False
