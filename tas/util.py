from __future__ import annotations

from pathlib import Path
import hashlib
import time
from typing import Tuple


def hash_path(path: Path) -> str:
    digest = hashlib.sha1(str(path).encode("utf-8")).hexdigest()
    return digest[:12]


def read_text_limited(path: Path, max_bytes: int) -> Tuple[str, bool, int]:
    size = path.stat().st_size
    with path.open("rb") as f:
        data = f.read(max_bytes + 1)
    truncated = len(data) > max_bytes
    if truncated:
        data = data[:max_bytes]
    text = data.decode("utf-8", errors="replace")
    return text, truncated, size


def iso_time(ts: float | None = None) -> str:
    if ts is None:
        ts = time.time()
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))
