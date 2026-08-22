"""Runs the real pipeline (registry -> runner -> scoring -> report) against every
handwritten fixture and writes a Scorecard as JSON, so the frontend has genuine
engine output to build against instead of anything hand-written.

Usage:
    python scripts/build_scorecard.py

Needs GEMINI_API_KEY or GROQ_API_KEY in .env (used both by the reference agent
under test and, if enabled, the unsupported-claim judge).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")  # LLM output can contain characters outside
    # the default Windows console codepage -- without this, print() can crash partway
    # through a long run instead of just rendering the character.

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from harness.agents.reference_agent import BASE_SYSTEM_PROMPT, DEFAULT_MODEL, ReferenceAgent  # noqa: E402
from harness.models import ScenarioLadder, ToolSchema  # noqa: E402
from harness.report import build_scorecard, score_scenario  # noqa: E402
from harness.runner import run_scenario  # noqa: E402

FIXTURE_DIR = REPO_ROOT / "fixtures" / "handwritten"
OUTPUT_PATH = REPO_ROOT / "fixtures" / "scorecard.json"

AGENT_VERSION = "reference-v1"
RUN_JUDGE = True  # set False to skip the LLM claim-check call and run faster/cheaper


def load_ladders() -> tuple[list[ToolSchema], list[ScenarioLadder]]:
    tool_schemas = [ToolSchema(**t) for t in json.load(open(FIXTURE_DIR / "tools.json"))]
    ladders = [
        ScenarioLadder(**json.load(open(path)))
        for path in sorted(FIXTURE_DIR.glob("*.json"))
        if path.name != "tools.json"
    ]
    return tool_schemas, ladders


def main() -> None:
    tool_schemas, ladders = load_ladders()
    results = []

    for ladder in ladders:
        for scenario in ladder.flatten():
            agent = ReferenceAgent(tool_schemas, BASE_SYSTEM_PROMPT, model=DEFAULT_MODEL)
            print(f"[{scenario.category.value} @ p{scenario.pressure.value}] running...", end=" ")
            trace = run_scenario(scenario, agent, agent_version=AGENT_VERSION)
            result = score_scenario(scenario, trace, tool_schemas, run_judge=RUN_JUDGE)
            print(f"task_success={result.task_success} safe={result.safe}")
            results.append(result)

    scorecard = build_scorecard(
        agent_name="Reference Support Agent", agent_version=AGENT_VERSION, results=results
    )
    OUTPUT_PATH.write_text(scorecard.model_dump_json(indent=2), encoding="utf-8")

    print(f"\nwrote {len(results)} results to {OUTPUT_PATH}")
    print(f"breaking_pressure: {scorecard.breaking_pressure}")
    print(f"task_success_rate: {scorecard.task_success_rate:.2f}")
    print(f"safety_rate: {scorecard.safety_rate:.2f}")


if __name__ == "__main__":
    main()
