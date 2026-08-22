"""The project's own stated definition of done, chained into one run:

    load scenarios -> split A/B -> run v1 on A -> diagnose -> synthesize a patch ->
    apply it as v2 -> run v1 AND v2 on the held-out set B -> compare -> dump one
    JSON file the frontend can read directly.

Nothing here has been proven chained before — generator/validator/patcher and
registry/runner/scoring were each tested individually, but never run back to back
against each other. This does that, against the real Groq API, and writes the full
result to fixtures/demo_state.json.

v1 is the bare reference-agent system prompt (no policy knowledge baked in — see
harness/agents/reference_agent.py). v2 is v1 plus whatever harness.patcher actually
synthesizes from v1's real failures. The held-out comparison is v1-vs-v2 on the SAME
scenario set, and that set was never patched against — that's the whole point.

Usage:
    python scripts/pipeline.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")  # LLM output can contain characters outside
    # the default Windows console codepage (e.g. non-breaking hyphens) -- without this,
    # print() crashes partway through a long run instead of just rendering the character.

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from harness.agents.reference_agent import BASE_SYSTEM_PROMPT, DEFAULT_MODEL, ReferenceAgent  # noqa: E402
from harness.models import ScenarioLadder, ScenarioResult, ToolSchema  # noqa: E402
from harness.patcher import apply_patch, diagnose, split_scenarios, summarize_delta, synthesize_patch  # noqa: E402
from harness.report import build_scorecard, score_scenario  # noqa: E402
from harness.runner import run_scenario  # noqa: E402

FIXTURE_DIR = REPO_ROOT / "fixtures" / "handwritten"
GENERATED_DIR = REPO_ROOT / "fixtures" / "generated"
OUTPUT_PATH = REPO_ROOT / "fixtures" / "demo_state.json"

PATCH_FRACTION = 0.6  # ~3 of 5 ladders to patch against, ~2 held out
RUN_JUDGE = False  # skip the LLM claim-check layer here: keeps this long run inside
# Groq's free-tier rate limit and the regression story is carried by the free,
# deterministic rule violations (forbidden_action, tool_call_loop, etc.), not the judge.


def load_ladders() -> tuple[list[ToolSchema], list[ScenarioLadder]]:
    """Loads both the 5 hand-written fixtures and any bulk-generated ones (if present).
    More ladders per category means a random A/B split is far less likely to strand an
    entire failure category on one side -- see the first real run of this pipeline for
    what happens when it does (fixtures/demo_state.json's original 1-ladder-per-category
    run put the only category with violations entirely in the patch set).
    """
    tool_schemas = [ToolSchema(**t) for t in json.load(open(FIXTURE_DIR / "tools.json"))]
    paths = [p for p in sorted(FIXTURE_DIR.glob("*.json")) if p.name != "tools.json"]
    if GENERATED_DIR.exists():
        paths += sorted(GENERATED_DIR.glob("*.json"))
    ladders = [ScenarioLadder(**json.load(open(path))) for path in paths]
    return tool_schemas, ladders


def run_ladders(
    ladders: list[ScenarioLadder], tool_schemas: list[ToolSchema], system_prompt: str, agent_version: str
) -> list[ScenarioResult]:
    results = []
    for ladder in ladders:
        for scenario in ladder.flatten():
            agent = ReferenceAgent(tool_schemas, system_prompt, model=DEFAULT_MODEL)
            trace = run_scenario(scenario, agent, agent_version=agent_version)
            result = score_scenario(scenario, trace, tool_schemas, run_judge=RUN_JUDGE)
            print(
                f"  [{agent_version}] {scenario.category.value}@p{scenario.pressure.value}: "
                f"task_success={result.task_success} safe={result.safe}"
            )
            results.append(result)
    return results


def main() -> None:
    tool_schemas, ladders = load_ladders()
    print(f"loaded {len(ladders)} ladders ({len(ladders) * 5} scenarios)")

    patch_ladders, held_out_ladders = split_scenarios(ladders, patch_fraction=PATCH_FRACTION, seed=1)
    print(f"split: {len(patch_ladders)} ladder(s) to patch against, {len(held_out_ladders)} held out\n")

    print("=== v1 on set A (patch set) ===")
    v1_patch_results = run_ladders(patch_ladders, tool_schemas, BASE_SYSTEM_PROMPT, "v1")

    print("\n=== v1 on set B (held out) -- baseline for the before/after comparison ===")
    v1_held_out_results = run_ladders(held_out_ladders, tool_schemas, BASE_SYSTEM_PROMPT, "v1")

    v1_failures = [r for r in v1_patch_results if not r.safe]
    print(f"\n{len(v1_failures)}/{len(v1_patch_results)} v1 runs on set A were unsafe")

    diagnosis_text = diagnose(v1_failures)
    print("\n=== diagnosis (from set A only) ===")
    print(diagnosis_text)

    if not v1_failures:
        print("\nv1 had no safety failures on set A -- nothing to patch. Writing v1-only demo_state.json.")
        v2_system_prompt = BASE_SYSTEM_PROMPT
        patch_amendment, patch_rationale = "", "no patch synthesized: v1 had no safety failures on set A"
        v2_held_out_results = v1_held_out_results
    else:
        patch = synthesize_patch(diagnosis_text, BASE_SYSTEM_PROMPT)
        v2_system_prompt = apply_patch(BASE_SYSTEM_PROMPT, patch)
        patch_amendment, patch_rationale = patch.amendment, patch.rationale
        print("\n=== patch amendment ===")
        print(patch_amendment)

        print("\n=== v2 on set B (held out, same scenarios as v1's held-out run) ===")
        v2_held_out_results = run_ladders(held_out_ladders, tool_schemas, v2_system_prompt, "v2")

    delta = summarize_delta(v1_held_out_results, v2_held_out_results)
    print("\n=== held-out delta (v1 -> v2), scenarios the patcher never saw ===")
    print(json.dumps(delta, indent=2))

    demo_state = {
        "agent_versions": {"v1": {"system_prompt": BASE_SYSTEM_PROMPT}, "v2": {"system_prompt": v2_system_prompt}},
        "patch": {"diagnosis": diagnosis_text, "amendment": patch_amendment, "rationale": patch_rationale},
        "scorecards": {
            "v1_patch_set": build_scorecard("Reference Agent", "v1", v1_patch_results).model_dump(mode="json"),
            "v1_held_out": build_scorecard("Reference Agent", "v1", v1_held_out_results).model_dump(mode="json"),
            "v2_held_out": build_scorecard("Reference Agent", "v2", v2_held_out_results).model_dump(mode="json"),
        },
        "held_out_delta": delta,
    }
    OUTPUT_PATH.write_text(json.dumps(demo_state, indent=2), encoding="utf-8")
    print(f"\nwrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
