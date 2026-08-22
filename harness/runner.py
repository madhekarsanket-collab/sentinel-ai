"""Scenario -> Trace.

Constructs a fresh ToolRegistry per scenario, hands it to the agent under
test, and captures whatever happens — including the agent crashing or
blowing its step budget — as a Trace. This is the only place an agent's
`run()` method gets called; everything downstream (scoring, patching)
consumes Trace objects and never touches the agent directly.
"""

from __future__ import annotations

from collections.abc import Callable

from harness import replay_cache
from harness.agents.adapter import AgentAdapter
from harness.models import AgentMessage, Scenario, Trace
from harness.registry import DEFAULT_SUPPORT_TOOL_IMPLS, StepBudgetExceeded, ToolImpl, ToolRegistry


def run_scenario(
    scenario: Scenario,
    agent: AgentAdapter,
    agent_version: str,
    tool_impls: dict[str, ToolImpl] | None = None,
    use_cache: bool = False,
) -> Trace:
    """Run one agent instance against one scenario. Never raises — a crashing or
    budget-exhausted agent still produces a Trace, just with completed=False.

    use_cache=True makes this a true deterministic replay: the same (scenario, agent,
    scenario.seed) triple returns the exact same Trace from disk on every call after the
    first, with zero further agent/LLM calls. Defaults to False so existing callers keep
    getting a fresh live run every time, matching current behavior — opt in explicitly
    once you want a specific trace pinned and replayable (e.g. for a demo).
    """
    if use_cache:
        fingerprint = replay_cache.agent_fingerprint(agent)
        cached = replay_cache.load(scenario.id, scenario.seed, agent_version, fingerprint)
        if cached is not None:
            return cached

    registry = ToolRegistry(scenario, tool_impls or DEFAULT_SUPPORT_TOOL_IMPLS)
    completed = True
    try:
        agent.run(scenario.user_message, registry)
    except StepBudgetExceeded:
        completed = False
    except Exception as e:  # noqa: BLE001 - any agent-side crash still yields a scorable trace
        completed = False
        registry._order += 1
        registry.agent_messages.append(
            AgentMessage(step=registry._order, text=f"[runner] agent raised: {e!r}")
        )
    trace = registry.build_trace(agent_version=agent_version, completed=completed)

    if use_cache:
        replay_cache.save(scenario.id, scenario.seed, agent_version, fingerprint, trace)
    return trace


def run_ladder(
    scenarios: list[Scenario],
    agent_factory: Callable[[], AgentAdapter],
    agent_version: str,
    tool_impls: dict[str, ToolImpl] | None = None,
    use_cache: bool = False,
) -> list[Trace]:
    """Run one ladder's worth of scenarios (typically the 5 pressure levels of one
    ScenarioLadder.flatten()). A fresh agent instance per scenario, via `agent_factory`,
    so conversation state never bleeds from one pressure level into the next.
    """
    return [run_scenario(s, agent_factory(), agent_version, tool_impls, use_cache) for s in scenarios]
