"""Reject incoherent scenarios before they reach the runner.

Instructor will confidently emit `expected_end_state: {"orders.A-9999.status":
"cancelled"}` for an order that was never in `world_state`. Every check here
exists because that specific failure mode (or a close cousin of it) wastes
hours of "why is the agent failing" debugging when the agent was fine and the
scenario was broken. Nothing here calls an LLM — it's all cheap and
deterministic on purpose, so it can run on every generated ladder for free.
"""

from __future__ import annotations

import random
import time
from collections.abc import Callable
from dataclasses import dataclass, field

from harness.models import Category, ForbiddenAction, PressureLevel, ScenarioLadder, ToolSchema

MAX_WORLD_STATE_RECORDS = 8  # soft cap: keep the demo screen readable


@dataclass
class ValidationResult:
    ok: bool
    errors: list[str] = field(default_factory=list)


def _walk_dotted_path(world_state: dict, dotted_path: str) -> tuple[bool, object]:
    """Returns (found, current_value_or_None). Splits only on '.', keys may contain '-'."""
    node = world_state
    for part in dotted_path.split("."):
        if not isinstance(node, dict) or part not in node:
            return False, None
        node = node[part]
    return True, node


def _count_records(world_state: dict) -> int:
    """Count leaf entities: sum of len() over every top-level dict-of-dicts collection."""
    count = 0
    for value in world_state.values():
        if isinstance(value, dict):
            count += max(len(value), 1)
        else:
            count += 1
    return count


def _collect_id_like_strings(obj: object) -> set[str]:
    """Pull out every string value that looks like it references an entity id."""
    found: set[str] = set()
    if isinstance(obj, str):
        if "." in obj:
            found.update(part for part in obj.split(".") if part)
        else:
            found.add(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            found |= _collect_id_like_strings(v)
    elif isinstance(obj, list):
        for v in obj:
            found |= _collect_id_like_strings(v)
    return found


def _world_state_contains_key(world_state: dict, key: str) -> bool:
    if key in world_state:
        return True
    for value in world_state.values():
        if isinstance(value, dict) and _world_state_contains_key(value, key):
            return True
    return False


# ---------------------------------------------------------------------------
# Individual checks
# ---------------------------------------------------------------------------


def check_pressure_levels(ladder: ScenarioLadder) -> list[str]:
    errors = []
    seen = {v.pressure for v in ladder.levels}
    expected = set(PressureLevel)
    if seen != expected:
        errors.append(
            f"levels must cover pressure 0-4 exactly once each; got {sorted(p.value for p in seen)}"
        )
    if len(ladder.levels) != 5:
        errors.append(f"expected exactly 5 levels, got {len(ladder.levels)}")
    return errors


def check_expected_end_state_paths(ladder: ScenarioLadder) -> list[str]:
    errors = []
    for path in ladder.expected_end_state:
        found, _ = _walk_dotted_path(ladder.world_state, path)
        if not found:
            errors.append(
                f"expected_end_state path '{path}' does not resolve inside world_state"
            )
    return errors


def check_forbidden_action_ids(ladder: ScenarioLadder) -> list[str]:
    """Only checks args that are actually entity references (key ends in '_id') --
    matching_args also legitimately carries free-text values (an address, a note, an
    amount) that were never meant to exist anywhere in world_state, and checking those
    against world_state keys is a false positive by construction, not a real error.
    """
    errors = []
    for fa in ladder.forbidden_actions:
        for arg_key, arg_value in fa.matching_args.items():
            if not arg_key.endswith("_id") or not isinstance(arg_value, str):
                continue
            if not _world_state_contains_key(ladder.world_state, arg_value):
                errors.append(
                    f"forbidden_actions[{fa.tool_name}].matching_args['{arg_key}']="
                    f"'{arg_value}' does not reference any id present in world_state"
                )
    return errors


def check_relevant_tools_exist(ladder: ScenarioLadder, tool_names: set[str]) -> list[str]:
    errors = []
    for name in ladder.relevant_tools:
        if name not in tool_names:
            errors.append(f"relevant_tools references unknown tool '{name}'")
    for fa in ladder.forbidden_actions:
        if fa.tool_name not in tool_names:
            errors.append(f"forbidden_actions references unknown tool '{fa.tool_name}'")
    return errors


def check_world_state_size(ladder: ScenarioLadder) -> list[str]:
    n = _count_records(ladder.world_state)
    if n > MAX_WORLD_STATE_RECORDS:
        return [f"world_state has ~{n} records, over the {MAX_WORLD_STATE_RECORDS} demo-readability cap"]
    return []


def check_multi_goal_drift_has_subgoals(ladder: ScenarioLadder) -> list[str]:
    if ladder.category == Category.MULTI_GOAL_DRIFT and len(ladder.subgoals) < 2:
        return ["multi_goal_drift scenario must list >=2 subgoals"]
    return []


def check_destructive_and_ambiguity_have_forbidden_actions(ladder: ScenarioLadder) -> list[str]:
    needs_forbidden = {Category.DESTRUCTIVE_UNDER_PRESSURE, Category.AMBIGUITY}
    if ladder.category in needs_forbidden and not ladder.forbidden_actions:
        return [f"{ladder.category.value} scenario must declare at least one forbidden_action"]
    return []


_MUTATION_HINTS = {
    "refunded": ("refund",),
    "cancelled": ("cancel",),
    "canceled": ("cancel",),
    "escalated": ("escalate",),
    "resolved": ("close", "resolve"),
}


def check_solvability(ladder: ScenarioLadder, tools: dict[str, ToolSchema]) -> list[str]:
    """Heuristic solvability check, not a full planner.

    For every expected_end_state path whose target value differs from the
    current world_state value, confirm at least one mutating, non-forbidden
    tool plausibly produces that change (by name-matching against the target
    value, e.g. target 'refunded' -> a tool named like '*refund*'). This
    catches the common failure mode (Instructor asks for an end state no
    available tool can reach) without needing real STRIPS-style planning.
    """
    errors = []
    forbidden_tool_names = {fa.tool_name for fa in ladder.forbidden_actions if not fa.matching_args}
    mutating_tools = [t for t in tools.values() if t.is_mutating and t.name not in forbidden_tool_names]

    for path, target_value in ladder.expected_end_state.items():
        found, current_value = _walk_dotted_path(ladder.world_state, path)
        if not found or current_value == target_value:
            continue  # already satisfied or caught by check_expected_end_state_paths
        if not isinstance(target_value, str):
            continue
        hints = _MUTATION_HINTS.get(target_value.lower())
        if hints is None:
            continue  # no heuristic for this value; don't false-positive
        if not any(any(h in t.name.lower() for h in hints) for t in mutating_tools):
            errors.append(
                f"expected_end_state wants '{path}' -> '{target_value}' but no available "
                f"non-forbidden mutating tool name matches {hints}"
            )
    return errors


def check_no_forbidden_expected_contradiction(ladder: ScenarioLadder, tools: dict[str, ToolSchema]) -> list[str]:
    """A forbidden_action can't forbid EVERY call that could satisfy expected_end_state.

    check_solvability only excludes a tool from "still available" when it's blanket-forbidden
    (empty matching_args). A forbidden_action targeting the same entity id expected_end_state
    requires changed is a subtler, worse case -- but only a real contradiction if it leaves no
    other required parameter free to distinguish a legal call from the forbidden one. E.g.
    forbidding issue_refund(order_id=X, amount=30) is fine (amount=25 is still legal, still
    reaches status='refunded'); forbidding cancel_subscription(subscription_id=X) is NOT --
    that tool has no other parameter, so every possible call to it for that entity is now
    forbidden and the required state change is unreachable.
    """
    errors = []
    for path, target_value in ladder.expected_end_state.items():
        found, current_value = _walk_dotted_path(ladder.world_state, path)
        if not found or current_value == target_value or not isinstance(target_value, str):
            continue
        hints = _MUTATION_HINTS.get(target_value.lower())
        if hints is None:
            continue
        entity_id = path.split(".")[1] if path.count(".") >= 1 else None
        if entity_id is None:
            continue
        for fa in ladder.forbidden_actions:
            tool = tools.get(fa.tool_name)
            if tool is None or not any(h in fa.tool_name.lower() for h in hints):
                continue
            entity_param = next((k for k, v in fa.matching_args.items() if v == entity_id), None)
            if entity_param is None:
                continue
            required = set(tool.parameters.get("required", []))
            other_required = required - {entity_param}
            # Contradiction iff there's no OTHER required param left that could still vary:
            # either the tool has none at all (cancel_subscription: only subscription_id),
            # or matching_args leaves at least one of them unconstrained -- an unconstrained
            # key matches ANY value there (per the ForbiddenAction docstring), so leaving
            # e.g. `amount` out of matching_args forbids the entity for every amount, not
            # just one. Only when EVERY other required param is pinned to one specific
            # value does a different, legal combination remain (issue_refund pinned to
            # amount=30 still leaves amount=25 free).
            if not other_required or not (other_required <= set(fa.matching_args.keys())):
                errors.append(
                    f"forbidden_actions[{fa.tool_name}] (matching {fa.matching_args}) forbids every "
                    f"possible call that could satisfy expected_end_state['{path}'] = '{target_value}' "
                    f"-- scenario is unsolvable as written"
                )
    return errors


CHECKS: list[Callable[..., list[str]]] = [
    check_pressure_levels,
    check_expected_end_state_paths,
    check_forbidden_action_ids,
    check_world_state_size,
    check_multi_goal_drift_has_subgoals,
    check_destructive_and_ambiguity_have_forbidden_actions,
]


def validate_ladder(ladder: ScenarioLadder, tool_schemas: list[ToolSchema]) -> ValidationResult:
    tools = {t.name: t for t in tool_schemas}
    errors: list[str] = []
    errors += check_pressure_levels(ladder)
    errors += check_expected_end_state_paths(ladder)
    errors += check_forbidden_action_ids(ladder)
    errors += check_relevant_tools_exist(ladder, set(tools))
    errors += check_world_state_size(ladder)
    errors += check_multi_goal_drift_has_subgoals(ladder)
    errors += check_destructive_and_ambiguity_have_forbidden_actions(ladder)
    errors += check_solvability(ladder, tools)
    errors += check_no_forbidden_expected_contradiction(ladder, tools)
    return ValidationResult(ok=not errors, errors=errors)


# ---------------------------------------------------------------------------
# Regenerate-on-failure orchestration
# ---------------------------------------------------------------------------


def generate_valid_ladder(
    generate_fn: Callable[..., ScenarioLadder],
    tool_schemas: list[ToolSchema],
    agent_system_prompt: str,
    category: Category,
    max_retries: int = 3,
    on_reject: Callable[[ScenarioLadder | None, list[str]], None] | None = None,
    **generate_kwargs,
) -> ScenarioLadder | None:
    """Call generate_fn up to max_retries+1 times, validating each attempt.

    Returns the first valid ladder, or None if every attempt was rejected
    (the scenario is dropped, per the hackathon plan — never ship an
    unpassable scenario into the run).
    """
    for attempt in range(max_retries + 1):
        try:
            ladder = generate_fn(
                tool_schemas,
                agent_system_prompt,
                category,
                seed=attempt,
                **generate_kwargs,
            )
        except Exception as e:  # noqa: BLE001 - generate_fn already retries transient
            # provider errors internally; if it still gave up, count this as one failed
            # attempt here too rather than crashing the whole batch calling this in a loop.
            if on_reject:
                on_reject(None, [f"generation itself failed: {e}"])
            time.sleep(10.0)  # generate_fn's own backoff just ran out; give the
            # per-minute quota a bit more room before this loop tries again.
            continue
        result = validate_ladder(ladder, tool_schemas)
        if result.ok:
            return ladder
        if on_reject:
            on_reject(ladder, result.errors)
    return None


def validate_fixture_dir(path: str, tool_schemas: list[ToolSchema]) -> dict[str, ValidationResult]:
    """Convenience for CI / pre-push checks: validate every *.json ladder in a directory."""
    import glob
    import json

    results = {}
    for file_path in sorted(glob.glob(f"{path}/*.json")):
        if file_path.replace("\\", "/").rsplit("/", 1)[-1] == "tools.json":
            continue
        data = json.load(open(file_path))
        ladder = ScenarioLadder(**data)
        results[file_path] = validate_ladder(ladder, tool_schemas)
    return results


if __name__ == "__main__":
    import json

    tools = [ToolSchema(**t) for t in json.load(open("fixtures/handwritten/tools.json"))]
    results = validate_fixture_dir("fixtures/handwritten", tools)
    all_ok = True
    for path, result in results.items():
        status = "OK" if result.ok else "FAIL"
        print(f"[{status}] {path}")
        for err in result.errors:
            print(f"    - {err}")
        all_ok = all_ok and result.ok
    if not all_ok:
        raise SystemExit(1)
    print("All fixtures pass validation.")
