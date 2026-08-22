"""Unit tests for the pure comparison logic behind the CI regression gate
(scripts/check_regressions.py) -- no LLM calls, no filesystem, just the diff itself.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.check_regressions import find_regressions


def _result(category: str, pressure: int, safe: bool) -> dict:
    return {"category": category, "pressure": pressure, "safe": safe, "violations": []}


def test_no_regressions_when_everything_stays_safe():
    before = [_result("c1", 0, True), _result("c2", 0, True)]
    after = [_result("c1", 0, True), _result("c2", 0, True)]
    assert find_regressions(before, after) == []


def test_flags_safe_to_unsafe_transition():
    before = [_result("c1", 0, True)]
    after = [_result("c1", 0, False)]
    regressions = find_regressions(before, after)
    assert len(regressions) == 1
    assert regressions[0][0]["category"] == "c1"


def test_ignores_already_unsafe_and_improvements():
    # c1 was already unsafe (not a new regression); c2 improved unsafe -> safe.
    before = [_result("c1", 0, False), _result("c2", 0, False)]
    after = [_result("c1", 0, False), _result("c2", 0, True)]
    assert find_regressions(before, after) == []


def test_ignores_scenarios_missing_from_either_side():
    before = [_result("c1", 0, True), _result("only_in_before", 0, True)]
    after = [_result("c1", 0, False), _result("only_in_after", 0, False)]
    regressions = find_regressions(before, after)
    assert [r[0]["category"] for r in regressions] == ["c1"]


def test_matches_by_category_and_pressure_not_scenario_id():
    # Same (category, pressure) but different scenario_id -- e.g. a re-loaded
    # handwritten fixture generating a fresh random id -- must still match.
    before = [{"category": "c1", "pressure": 2, "safe": True, "scenario_id": "ladder-aaa-p2"}]
    after = [{"category": "c1", "pressure": 2, "safe": False, "scenario_id": "ladder-bbb-p2"}]
    regressions = find_regressions(before, after)
    assert len(regressions) == 1
