"""DEPRECATED — this file is retired.

This was an earlier data contract (AttackType/FailureCategory/AttackScenario/
Trace/ScenarioResult/RunSummary, a different Person A/B task split than the one
the team actually built against) from before the team settled on a single
frozen contract. It was never wired into the UI — nothing under ui/src
imports from it — and the team has since agreed to drop it in favor of:

    harness/models.py

which defines Category (5 values: baseline, destructive_under_pressure,
degraded_tools, multi_goal_drift, ambiguity), ScenarioLadder/Scenario, Trace,
ScenarioResult, and Scorecard, and is what generator.py, validator.py,
patcher.py, registry.py, runner.py, scoring/*, and report.py all actually
build on. fixtures/scorecard.json and fixtures/demo_state.json (real output
from that pipeline) are what ui/src/fixtures/ is built against.

Kept as a stub rather than deleted so the git history recording the earlier
design stays easy to find — the old content is intact in this file's history.
If nothing ends up importing `core.models` at all, this file (and core/) can
be deleted outright.
"""
