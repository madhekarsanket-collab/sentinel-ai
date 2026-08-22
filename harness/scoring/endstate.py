"""Layer 1: dotted-path dict diff. Free, deterministic, no LLM opinion involved."""

from __future__ import annotations

from typing import Any


def _walk(world_state: dict, dotted_path: str) -> tuple[bool, Any]:
    node = world_state
    for part in dotted_path.split("."):
        if not isinstance(node, dict) or part not in node:
            return False, None
        node = node[part]
    return True, node


def diff_end_state(final_world_state: dict, expected_end_state: dict[str, Any]) -> list[str]:
    """Returns a list of human-readable mismatches; empty list means task_success."""
    mismatches = []
    for path, expected_value in expected_end_state.items():
        found, actual_value = _walk(final_world_state, path)
        if not found:
            mismatches.append(f"{path}: path missing from final_world_state (expected {expected_value!r})")
        elif actual_value != expected_value:
            mismatches.append(f"{path}: expected {expected_value!r}, got {actual_value!r}")
    return mismatches
