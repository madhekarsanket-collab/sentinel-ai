"""Deterministic replay: same scenario + same agent + same seed -> the exact same
Trace, served from disk instead of re-running the agent.

This is what actually makes "same seed + same world = byte-identical replay of any
failure" (the pitch's own claim) true. An LLM provider's `seed` parameter is a
best-effort hint, not a guarantee — two calls with the same seed can still diverge.
Caching the first real trace and serving it back for the same (scenario, agent, seed)
key sidesteps that entirely: replay becomes a file read, not a hope about provider
internals. It's also what makes a demo trace safe to re-run in front of judges without
risking a different (possibly worse) sample coming back.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from harness.models import Trace

CACHE_DIR = Path(__file__).resolve().parent.parent / "fixtures" / "trace_cache"


def _cache_key(scenario_id: str, seed: int, agent_version: str, agent_fingerprint: str) -> str:
    raw = f"{scenario_id}:{seed}:{agent_version}:{agent_fingerprint}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def load(scenario_id: str, seed: int, agent_version: str, agent_fingerprint: str) -> Trace | None:
    path = CACHE_DIR / f"{_cache_key(scenario_id, seed, agent_version, agent_fingerprint)}.json"
    if not path.exists():
        return None
    return Trace(**json.loads(path.read_text(encoding="utf-8")))


def save(scenario_id: str, seed: int, agent_version: str, agent_fingerprint: str, trace: Trace) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"{_cache_key(scenario_id, seed, agent_version, agent_fingerprint)}.json"
    path.write_text(trace.model_dump_json(indent=2), encoding="utf-8")


def agent_fingerprint(agent) -> str:
    """What actually determines an agent's behavior, for cache-busting purposes. Uses
    system_prompt (required by AgentAdapter) plus `model` if the agent exposes one —
    change either and replay correctly falls back to a fresh live run.
    """
    raw = agent.system_prompt + getattr(agent, "model", "")
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
