from __future__ import annotations

from pathlib import Path
import hashlib
import time
from typing import Tuple
from datetime import datetime, date, timezone, timedelta


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


DEFAULT_TZ = timezone(timedelta(hours=8))


def parse_time(value: str | None) -> float | None:
    if not value:
        return None
    value = value.strip()
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        pass
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        dt = None
    if dt is None:
        try:
            d = date.fromisoformat(value)
            dt = datetime(d.year, d.month, d.day)
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=DEFAULT_TZ)
    return dt.timestamp()


def bucket_start(ts: float, bucket: str) -> float:
    dt = datetime.fromtimestamp(ts, tz=DEFAULT_TZ)
    if bucket == "day":
        dt = dt.replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        dt = dt.replace(minute=0, second=0, microsecond=0)
    return dt.timestamp()
