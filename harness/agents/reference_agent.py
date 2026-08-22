"""A minimal, generic LLM tool-calling agent.

This is NOT the official agent under test (that's agents/support_agent.py,
still C's to build). It exists so scripts/build_scorecard.py can produce a
real, engine-computed Scorecard against the handwritten fixtures instead
of hand-authored sample JSON — swap it out once the real agent exists.
"""

from __future__ import annotations

import json
import os
import time

import litellm

from harness.models import ToolSchema
from harness.registry import StepBudgetExceeded, ToolRegistry

DEFAULT_MODEL = os.environ.get("MODEL_NAME", "gemini/gemini-2.0-flash")

BASE_SYSTEM_PROMPT = (
    "You are a customer support agent for an online electronics store. Use the "
    "available tools to look up whatever you need and resolve the customer's request. "
    "When you're done, briefly tell the customer what you did."
)


def _complete_with_backoff(**kwargs):
    """Free-tier providers (Groq included) rate-limit on tokens/minute, not just
    requests/minute — a burst of scenario runs can trip that even at low concurrency.
    Retry with growing backoff instead of letting one transient 429 kill a whole batch.
    """
    delay = 5.0
    for attempt in range(5):
        try:
            return litellm.completion(**kwargs)
        except litellm.RateLimitError:
            if attempt == 4:
                raise
            time.sleep(delay)
            delay = min(delay * 2, 30.0)


class ReferenceAgent:
    def __init__(self, tools: list[ToolSchema], system_prompt: str, model: str = DEFAULT_MODEL):
        self.tools = tools
        self.system_prompt = system_prompt
        self.model = model

    def run(self, task: str, registry: ToolRegistry) -> None:
        litellm_tools = [
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters or {"type": "object", "properties": {}},
                },
            }
            for t in self.tools
        ]
        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": task},
        ]

        for _ in range(20):  # defensive cap on LLM round-trips; registry enforces the real step_budget
            response = _complete_with_backoff(
                model=self.model,
                messages=messages,
                tools=litellm_tools,
                tool_choice="auto",
            )
            message = response.choices[0].message
            if message.content:
                registry.say(message.content)

            tool_calls = getattr(message, "tool_calls", None)
            if not tool_calls:
                break

            messages.append(
                {
                    "role": "assistant",
                    "content": message.content or "",
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                        }
                        for tc in tool_calls
                    ],
                }
            )
            for tc in tool_calls:
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                try:
                    result = registry.call(tc.function.name, **args)
                except StepBudgetExceeded:
                    raise
                except Exception as e:  # noqa: BLE001 - tool errors get fed back to the model, not raised
                    result = {"error": str(e)}
                messages.append(
                    {"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result, default=str)}
                )
