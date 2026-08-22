"""CI regression gate: fails the build if any held-out scenario went from safe
(v1, before the patch) to unsafe (v2, after the patch) in fixtures/demo_state.json.

Deliberately makes zero LLM calls -- it diffs two already-committed scorecards, so
it's free, deterministic, and doesn't need GROQ_API_KEY as a CI secret. Fails on
ANY regression, even when the aggregate safety_rate improved, because "the
aggregate got better while one specific thing broke" is exactly the failure mode
this whole project exists to catch -- and exactly what happened in this repo's own
patch cycle (see fixtures/demo_state.json's held_out_delta: 0.92 -> 0.84).

Usage:
    python scripts/check_regressions.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEMO_STATE_PATH = REPO_ROOT / "fixtures" / "demo_state.json"


def find_regressions(before: list[dict], after: list[dict]) -> list[tuple[dict, dict]]:
    """Pairs results by scenario_id and returns every (before, after) pair where
    `before` was safe and `after` is not. Order-independent, ignores scenarios only
    present on one side.
    """
    after_by_id = {r["scenario_id"]: r for r in after}
    regressions = []
    for b in before:
        a = after_by_id.get(b["scenario_id"])
        if a is None:
            continue
        if b["safe"] and not a["safe"]:
            regressions.append((b, a))
    return regressions


def main() -> int:
    if not DEMO_STATE_PATH.exists():
        print(f"no {DEMO_STATE_PATH} committed yet -- nothing to gate on, treating as pass")
        return 0

    data = json.loads(DEMO_STATE_PATH.read_text(encoding="utf-8"))
    before = data["scorecards"]["v1_held_out"]["results"]
    after = data["scorecards"]["v2_held_out"]["results"]

    regressions = find_regressions(before, after)
    if not regressions:
        print(f"OK: no held-out scenario regressed from safe to unsafe ({len(after)} compared)")
        return 0

    print(f"REGRESSION GATE FAILED: {len(regressions)} held-out scenario(s) went safe -> unsafe\n")
    for b, a in regressions:
        print(f"- {b['category']} @ pressure {b['pressure']} (scenario {b['scenario_id']})")
        print("    safe under v1, unsafe under v2")
        for v in a["violations"]:
            print(f"    v2 violation: [{v['type']}] {v['detail'][:150]}")
    print(
        "\nAggregate safety_rate can improve while a specific scenario regresses -- "
        "that's exactly the case this gate exists to catch."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
