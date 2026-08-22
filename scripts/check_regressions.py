"""CI regression gate: fails the build if any held-out scenario went from safe
(v1, before patching) to unsafe (after patching) in fixtures/demo_state.json.

Deliberately makes zero LLM calls -- it diffs two already-committed scorecards, so
it's free, deterministic, and doesn't need GROQ_API_KEY as a CI secret. Fails on
ANY regression, even when the aggregate safety_rate improved, because "the
aggregate got better while one specific thing broke" is exactly the failure mode
this whole project exists to catch.

Gates against demo_state["round2_patch"] when present (the corrected, adopted
patch -- conditions the return-window check on delivery-date data actually being
present, fixing the same destructive_under_pressure failures without the original
patch's multi_goal_drift overcorrection). Falls back to v2_held_out (the original,
rejected patch -- see the README's "What we found" #2) if round2_patch hasn't been
generated yet, so this script still works on an older demo_state.json.

Matches results by (category, pressure) rather than scenario_id: handwritten
fixtures have no explicit `id`, so re-loading them for a fresh run (like
scripts/patch_round2.py does) generates new random scenario ids every time --
category+pressure is what's actually stable and comparable across separate runs.

Usage:
    python scripts/check_regressions.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEMO_STATE_PATH = REPO_ROOT / "fixtures" / "demo_state.json"


def _key(r: dict) -> tuple[str, int]:
    return (r["category"], r["pressure"])


def find_regressions(before: list[dict], after: list[dict]) -> list[tuple[dict, dict]]:
    """Pairs results by (category, pressure) and returns every (before, after) pair
    where `before` was safe and `after` is not. Order-independent, ignores scenarios
    only present on one side.
    """
    after_by_key = {_key(r): r for r in after}
    regressions = []
    for b in before:
        a = after_by_key.get(_key(b))
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

    if "round2_patch" in data:
        after = data["round2_patch"]["scorecard"]["results"]
        label = "round2_patch"
    else:
        after = data["scorecards"]["v2_held_out"]["results"]
        label = "v2 (original patch)"

    regressions = find_regressions(before, after)
    if not regressions:
        print(f"OK: no held-out scenario regressed from safe to unsafe ({len(after)} compared against {label})")
        return 0

    print(f"REGRESSION GATE FAILED: {len(regressions)} held-out scenario(s) went safe -> unsafe (vs {label})\n")
    for b, a in regressions:
        print(f"- {b['category']} @ pressure {b['pressure']}")
        print(f"    safe under v1, unsafe under {label}")
        for v in a["violations"]:
            print(f"    violation: [{v['type']}] {v['detail'][:150]}")
    print(
        "\nAggregate safety_rate can improve while a specific scenario regresses -- "
        "that's exactly the case this gate exists to catch."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
