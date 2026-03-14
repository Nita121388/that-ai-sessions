from __future__ import annotations

import json
import urllib.request
from typing import Any


def check_updates(targets: list[str]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for target in targets:
        url = f"https://api.github.com/repos/{target}/releases/latest"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "that-ai-sessions"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            results.append(
                {
                    "target": target,
                    "tag": data.get("tag_name"),
                    "published_at": data.get("published_at"),
                    "url": data.get("html_url"),
                }
            )
        except Exception as exc:
            results.append({"target": target, "error": str(exc)})
    return results
