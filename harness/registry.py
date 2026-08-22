"""ToolRegistry: the in-memory sandbox every agent-under-test calls into.

The agent never talks to a real database or a real payment API. It calls
`registry.call("issue_refund", order_id=..., amount=...)`, which dispatches
to a plain Python function that mutates an in-memory `world_state` dict
seeded from `Scenario.world_state`. Every call — success or failure — gets
recorded as a `ToolCall`, in order, which is what makes tracing and replay
free: same seed + same world = byte-identical replay of any failure.

`DEFAULT_SUPPORT_TOOL_IMPLS` is a reference implementation matching the
10-tool contract in fixtures/handwritten/tools.json. It exists so the
runner has something real to execute against fixtures/handwritten/*.json
immediately — extend or swap it for whatever tool set a given agent under
test actually declares.
"""

from __future__ import annotations

import copy
from collections.abc import Callable
from typing import Any

from harness.models import AgentMessage, Scenario, ToolCall, Trace

ToolImpl = Callable[..., Any]


class StepBudgetExceeded(Exception):
    """Raised by ToolRegistry.call() once the scenario's tool-call budget is spent."""


class UnknownTool(Exception):
    """Raised when the agent calls a tool name the registry has no implementation for."""


class ToolRegistry:
    """One instance per scenario run. Not reusable across scenarios — construct fresh."""

    def __init__(self, scenario: Scenario, tool_impls: dict[str, ToolImpl]):
        self.scenario = scenario
        self.world_state: dict[str, Any] = copy.deepcopy(scenario.world_state)
        self.tool_impls = tool_impls
        self.clarification_asked = False

        self._order = 0  # shared counter: every call() or say() gets the next value,
        # so Trace.timeline() can reconstruct exact chronological order.
        self._tool_call_count = 0  # budget counter: only real tool calls consume this.

        self.tool_calls: list[ToolCall] = []
        self.agent_messages: list[AgentMessage] = []

    def say(self, text: str) -> None:
        """Record a free-text thought/message from the agent (input to the claim judge)."""
        self._order += 1
        self.agent_messages.append(AgentMessage(step=self._order, text=text))

    def call(self, tool_name: str, **arguments: Any) -> Any:
        """Dispatch one tool call. Raises StepBudgetExceeded or UnknownTool on misuse —
        both are also recorded in the trace before being raised, so the failure is visible
        in the trace even though the agent's run() is expected to stop there.
        """
        self._order += 1
        self._tool_call_count += 1
        step = self._order

        if self._tool_call_count > self.scenario.step_budget:
            self.tool_calls.append(
                ToolCall(step=step, tool_name=tool_name, arguments=arguments, error="step budget exceeded")
            )
            raise StepBudgetExceeded(
                f"exceeded step budget of {self.scenario.step_budget} on call to '{tool_name}'"
            )

        impl = self.tool_impls.get(tool_name)
        if impl is None:
            self.tool_calls.append(
                ToolCall(step=step, tool_name=tool_name, arguments=arguments, error=f"unknown tool '{tool_name}'")
            )
            raise UnknownTool(tool_name)

        if tool_name == "request_clarification":
            self.clarification_asked = True

        try:
            result = impl(self.world_state, **arguments)
        except Exception as e:
            self.tool_calls.append(ToolCall(step=step, tool_name=tool_name, arguments=arguments, error=str(e)))
            raise

        self.tool_calls.append(ToolCall(step=step, tool_name=tool_name, arguments=arguments, result=result))
        return result

    def build_trace(self, agent_version: str, completed: bool = True) -> Trace:
        return Trace(
            scenario_id=self.scenario.id,
            agent_version=agent_version,
            seed=self.scenario.seed,
            tool_calls=self.tool_calls,
            agent_messages=self.agent_messages,
            final_world_state=self.world_state,
            clarification_asked=self.clarification_asked,
            completed=completed,
        )


# ---------------------------------------------------------------------------
# Reference tool implementations for fixtures/handwritten/tools.json
# ---------------------------------------------------------------------------


def _get(collection: dict[str, Any], key: str, label: str) -> dict[str, Any]:
    if key not in collection:
        raise KeyError(f"{label} '{key}' not found")
    return collection[key]


def _get_order(world_state: dict, order_id: str) -> dict:
    return _get(world_state.get("orders", {}), order_id, "order")


def _get_customer(world_state: dict, customer_id: str) -> dict:
    return _get(world_state.get("customers", {}), customer_id, "customer")


def _get_subscription(world_state: dict, subscription_id: str) -> dict:
    return _get(world_state.get("subscriptions", {}), subscription_id, "subscription")


def _check_inventory(world_state: dict, sku: str) -> dict:
    record = world_state.get("inventory", {}).get(sku)
    if record is None:
        return {"sku": sku, "stock": "unknown"}
    return {"sku": sku, **record}


def _issue_refund(world_state: dict, order_id: str, amount: float) -> dict:
    order = _get_order(world_state, order_id)
    order["status"] = "refunded"
    order["refunded_amount"] = amount
    return {"order_id": order_id, "status": "refunded"}


def _cancel_subscription(world_state: dict, subscription_id: str) -> dict:
    sub = _get_subscription(world_state, subscription_id)
    sub["status"] = "cancelled"
    return {"subscription_id": subscription_id, "status": "cancelled"}


def _update_shipping_address(world_state: dict, order_id: str, address: str) -> dict:
    order = _get_order(world_state, order_id)
    order["shipping_address"] = address
    return {"order_id": order_id, "shipping_address": address}


def _escalate_to_human(world_state: dict, note: str) -> dict:
    """Escalates the first open ticket in world_state (our fixtures only ever seed one)."""
    tickets = world_state.setdefault("tickets", {})
    open_id = next((tid for tid, t in tickets.items() if t.get("status") == "open"), None)
    if open_id is None:
        open_id = f"TICK-{len(tickets) + 1:04d}"
        tickets[open_id] = {"status": "open"}
    tickets[open_id]["status"] = "escalated"
    tickets[open_id]["note"] = note
    return {"ticket_id": open_id, "status": "escalated"}


def _request_clarification(world_state: dict, question: str) -> dict:
    return {"question": question}


def _close_ticket(world_state: dict, ticket_id: str) -> dict:
    ticket = _get(world_state.get("tickets", {}), ticket_id, "ticket")
    ticket["status"] = "closed"
    return {"ticket_id": ticket_id, "status": "closed"}


DEFAULT_SUPPORT_TOOL_IMPLS: dict[str, ToolImpl] = {
    "get_order": _get_order,
    "get_customer": _get_customer,
    "get_subscription": _get_subscription,
    "check_inventory": _check_inventory,
    "issue_refund": _issue_refund,
    "cancel_subscription": _cancel_subscription,
    "update_shipping_address": _update_shipping_address,
    "escalate_to_human": _escalate_to_human,
    "request_clarification": _request_clarification,
    "close_ticket": _close_ticket,
}
