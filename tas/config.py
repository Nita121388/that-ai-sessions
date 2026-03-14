from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
import os
import tomllib

APP_NAME = "that-ai-sessions"

DEFAULT_INCLUDE_GLOBS = [
    "**/*.jsonl",
    "**/*.json",
    "**/*.log",
    "**/*.txt",
    "**/*.md",
]

DEFAULT_EXCLUDE_GLOBS = [
    ".git",
    "node_modules",
    ".venv",
    "__pycache__",
    ".cache",
]


@dataclass
class Config:
    session_roots: list[str] = field(default_factory=list)
    include_globs: list[str] = field(default_factory=lambda: list(DEFAULT_INCLUDE_GLOBS))
    exclude_globs: list[str] = field(default_factory=lambda: list(DEFAULT_EXCLUDE_GLOBS))
    refresh_interval_sec: int = 30
    host: str = "0.0.0.0"
    port: int = 8787
    preview_bytes: int = 16_384
    full_bytes: int = 1_000_000
    confirm_bytes: int = 131_072
    max_recent: int = 200
    update_targets: list[str] = field(default_factory=list)


def config_dir() -> Path:
    base = os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))
    return Path(base) / APP_NAME


def data_dir() -> Path:
    base = os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share"))
    return Path(base) / APP_NAME


def config_path() -> Path:
    return config_dir() / "config.toml"


def discover_roots() -> list[str]:
    home = Path.home()
    candidates = [
        home / ".openclaw",
        home / ".codex",
        home / ".openai",
        home / ".local" / "share",
        home / ".config",
        home / ".cache",
    ]
    subnames = ["sessions", "session", "logs", "history"]
    roots: list[str] = []
    for base in candidates:
        for name in subnames:
            path = base / name
            if path.is_dir():
                roots.append(str(path))
    # Deduplicate while preserving order.
    seen: set[str] = set()
    ordered: list[str] = []
    for root in roots:
        if root not in seen:
            ordered.append(root)
            seen.add(root)
    return ordered


def _apply_overrides(cfg: Config, data: dict[str, Any]) -> Config:
    def _get(key: str, default: Any) -> Any:
        return data.get(key, default)

    cfg.session_roots = list(_get("session_roots", cfg.session_roots))
    cfg.include_globs = list(_get("include_globs", cfg.include_globs))
    cfg.exclude_globs = list(_get("exclude_globs", cfg.exclude_globs))
    cfg.refresh_interval_sec = int(_get("refresh_interval_sec", cfg.refresh_interval_sec))
    cfg.host = str(_get("host", cfg.host))
    cfg.port = int(_get("port", cfg.port))
    cfg.preview_bytes = int(_get("preview_bytes", cfg.preview_bytes))
    cfg.full_bytes = int(_get("full_bytes", cfg.full_bytes))
    cfg.confirm_bytes = int(_get("confirm_bytes", cfg.confirm_bytes))
    cfg.max_recent = int(_get("max_recent", cfg.max_recent))
    cfg.update_targets = list(_get("update_targets", cfg.update_targets))
    return cfg


def load_config(path: Path | None = None, create_if_missing: bool = False) -> Config:
    cfg = Config()
    cfg.session_roots = discover_roots() or cfg.session_roots
    path = path or config_path()
    if path.exists():
        with path.open("rb") as f:
            data = tomllib.load(f)
        cfg = _apply_overrides(cfg, data)
    elif create_if_missing:
        save_config(cfg, path)
    return cfg


def save_config(cfg: Config, path: Path | None = None) -> None:
    path = path or config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    content = _format_toml(cfg)
    path.write_text(content, encoding="utf-8")


def _format_toml(cfg: Config) -> str:
    def _list(items: list[str]) -> str:
        return "[" + ", ".join(f'"{item}"' for item in items) + "]"

    lines = [
        f"session_roots = {_list(cfg.session_roots)}",
        f"include_globs = {_list(cfg.include_globs)}",
        f"exclude_globs = {_list(cfg.exclude_globs)}",
        f"refresh_interval_sec = {cfg.refresh_interval_sec}",
        f"host = \"{cfg.host}\"",
        f"port = {cfg.port}",
        f"preview_bytes = {cfg.preview_bytes}",
        f"full_bytes = {cfg.full_bytes}",
        f"confirm_bytes = {cfg.confirm_bytes}",
        f"max_recent = {cfg.max_recent}",
        f"update_targets = {_list(cfg.update_targets)}",
        "",
    ]
    return "\n".join(lines)
