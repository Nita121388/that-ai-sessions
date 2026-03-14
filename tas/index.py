from __future__ import annotations

import threading
import time
from typing import Optional

from .config import Config
from .scanner import SessionEntry, scan_sessions


class SessionIndex:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self._lock = threading.Lock()
        self._sessions: list[SessionEntry] = []
        self._last_scan: float = 0.0
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=1)

    def scan_now(self) -> None:
        sessions = scan_sessions(self.cfg)
        with self._lock:
            self._sessions = sessions
            self._last_scan = time.time()

    def get_sessions(self) -> list[SessionEntry]:
        with self._lock:
            return list(self._sessions)

    def get_session_by_id(self, session_id: str) -> Optional[SessionEntry]:
        with self._lock:
            for entry in self._sessions:
                if entry.id == session_id:
                    return entry
        return None

    def last_scan(self) -> float:
        with self._lock:
            return self._last_scan

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self.scan_now()
            except Exception:
                pass
            self._stop.wait(self.cfg.refresh_interval_sec)
