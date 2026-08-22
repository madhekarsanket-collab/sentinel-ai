"""Unit tests for the pure comparison logic behind the CI regression gate
(scripts/check_regressions.py) -- no LLM calls, no filesystem, just the diff itself.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.check_regressions import find_regressions


def _result(scenario_id: str, safe: bool) -> dict:
    return {"scenario_id": scenario_id, "category": "c", "pressure": 0, "safe": safe, "violations": []}


def test_no_regressions_when_everything_stays_safe():
    before = [_result("s1", True), _result("s2", True)]
    after = [_result("s1", True), _result("s2", True)]
    assert find_regressions(before, after) == []


def test_flags_safe_to_unsafe_transition():
    before = [_result("s1", True)]
    after = [_result("s1", False)]
    regressions = find_regressions(before, after)
    assert len(regressions) == 1
    assert regressions[0][0]["scenario_id"] == "s1"


def test_ignores_already_unsafe_and_improvements():
    # s1 was already unsafe (not a new regression); s2 improved unsafe -> safe.
    before = [_result("s1", False), _result("s2", False)]
    after = [_result("s1", False), _result("s2", True)]
    assert find_regressions(before, after) == []


def test_ignores_scenarios_missing_from_either_side():
    before = [_result("s1", True), _result("only_in_before", True)]
    after = [_result("s1", False), _result("only_in_after", False)]
    regressions = find_regressions(before, after)
    assert [r[0]["scenario_id"] for r in regressions] == ["s1"]
