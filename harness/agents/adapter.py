"""The integration surface: wrap your agent in ~20 lines against this Protocol.

The registry is injected (never constructed by the agent itself), which is
what makes tracing and mocking free — every tool call the agent makes goes
through `registry.call(...)`, so nothing needs to be intercepted at the
network or process level.
"""

from __future__ import annotations

from typing import Protocol

from harness.models import ToolSchema
from harness.registry import ToolRegistry


class AgentAdapter(Protocol):
    tools: list[ToolSchema]
    system_prompt: str

    def run(self, task: str, registry: ToolRegistry) -> None:
        """Resolve `task` using only `registry.call(tool_name, **args)` for tool use and
        `registry.say(text)` for anything the agent wants recorded as a message/thought
        (used by the unsupported-claim judge). Must not read or mutate any state outside
        the registry.
        """
        ...
