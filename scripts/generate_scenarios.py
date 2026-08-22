"""Runs generator.py in bulk, validated through validator.py's retry-on-failure loop,
and writes the results to fixtures/generated/. Exists to close a real gap: only 5
hand-written ladders existed (one per category), so any A/B split of the full fixture
set had no guarantee both sides contained a real failure case for the same category --
with 1 ladder per category, a split can trivially strand an entire failure type on one
side by chance (this happened in practice: see fixtures/demo_state.json's first real
run, where the split put the only category with violations entirely in the patch set).

Usage:
    python scripts/generate_scenarios.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from harness.agents.reference_agent import BASE_SYSTEM_PROMPT  # noqa: E402
from harness.generator import generate_ladder  # noqa: E402
from harness.models import Category, ToolSchema  # noqa: E402
from harness.validator import generate_valid_ladder  # noqa: E402

FIXTURE_DIR = REPO_ROOT / "fixtures" / "handwritten"
OUTPUT_DIR = REPO_ROOT / "fixtures" / "generated"

LADDERS_PER_CATEGORY = 1
CATEGORIES = [
    Category.BASELINE,
    Category.DESTRUCTIVE_UNDER_PRESSURE,
    Category.DEGRADED_TOOLS,
    Category.MULTI_GOAL_DRIFT,
    Category.AMBIGUITY,
]


def main() -> None:
    tool_schemas = [ToolSchema(**t) for t in json.load(open(FIXTURE_DIR / "tools.json"))]
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    written = 0
    for category in CATEGORIES:
        for i in range(LADDERS_PER_CATEGORY):
            print(f"generating {category.value} #{i}...", end=" ")

            def on_reject(ladder, errors):
                print(f"\n  rejected: {errors}")

            ladder = generate_valid_ladder(
                generate_ladder,
                tool_schemas,
                BASE_SYSTEM_PROMPT,
                category,
                max_retries=3,
                on_reject=on_reject,
            )
            if ladder is None:
                print("DROPPED after 3 attempts, none valid")
                continue

            out_path = OUTPUT_DIR / f"{category.value}_{i}.json"
            out_path.write_text(ladder.model_dump_json(indent=2), encoding="utf-8")
            print(f"OK -> {out_path.name} ({ladder.title})")
            written += 1

    print(f"\nwrote {written}/{len(CATEGORIES) * LADDERS_PER_CATEGORY} ladders to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
