# SENTINEL.AI

> **Find the pressure at which an AI agent stops being safe.**
> OOSC 4.0 Hackathon — IIIT Allahabad — Problem Statement 4: AI Agent Evaluation & Reliability Engine
> **Team:** Dark Fantasy

---

## The problem

Traditional software is a contract: input X, output Y. Assert equality, move on.

An agent isn't given steps — it's given a goal and a set of tools, and it decides the steps itself. That chain of decisions is a **trajectory**. Run the same request twice and you may get two different trajectories, both correct, or both wrong for entirely different reasons.

Teams ship agents against a handful of hand-written prompts. Three reasons that fails:

1. **You can only test failures you already imagined.** The ones that hurt are the ones nobody thought of.
2. **The sample is too small to mean anything.** A confidence interval on 30 samples is too wide to separate a good agent from a mediocre one.
3. **Tests are written once; the agent changes weekly.** Someone appends "be more concise" to the system prompt, a critical tool call silently disappears, and nobody notices until a customer does.

And this is not solving itself as models improve. Across 24 months of frontier releases, reliability has stayed roughly flat even as accuracy climbed — all providers cluster together, which points to an industry-wide plateau rather than a vendor problem.

## The insight

Existing evaluation tools ask **"did it pass?"** and collapse two different questions into one number.

An agent can complete a task correctly and still be unsafe. It can refuse a task correctly and be marked a failure.

SENTINEL.AI scores these separately, and then does the thing nobody else does: it runs **the same scenario at escalating social pressure** and reports the rung where safety collapses.

> **Agent v1 holds to pressure level 2. At level 3, it issues an unauthorised ₹8,600 refund.**

One integer — `breaking_pressure` — as the headline reliability metric.

---

## How it works

**1. Generate.** Read the agent's tool schemas and system prompt. Emit scenarios as strict Pydantic objects — not just the task, but the **starting world state and the expected end state**. This is the load-bearing decision: because the expected outcome is generated alongside the task, most grading is a dictionary comparison rather than an LLM opinion.

**2. Execute.** The agent is handed **our** tool registry, not its own. Every call routes through us, so tracing is free and mocking is free. Tools read and mutate an in-memory world. Same seed + same world = byte-identical replay of any failure.

**3. Score, cheapest check first.**

| Layer | Method | Cost |
| :--- | :--- | :--- |
| End-state diff | Dictionary comparison | Free, deterministic |
| Trace rules | Loop detection, forbidden actions, step budget, mutation-before-clarify | Free, deterministic |
| LLM judge | Unsupported-claim detection only | One call per run |

Most findings come from layers 1 and 2. When asked how we know the scorer is right, the answer is: *it's a dict comparison.*

**4. Ladder.** Run the identical scenario at pressure 0 → 4. Only the tone changes; the request, world state and expected outcome stay fixed. Report the breaking point.

**5. Patch and validate.** Diagnose root causes from traces, synthesise a system-prompt amendment, then **re-test against a held-out scenario set the patcher never saw.** Patching and validating on the same scenarios is training on the test set; we don't do that.

---

## Scenario categories

| Category | Targets | Checked by |
| :--- | :--- | :--- |
| `baseline` | Control — proves the agent works normally | End-state |
| `destructive_under_pressure` | Unsafe irreversible actions | Forbidden-action rule |
| `degraded_tools` | Tool-call loops, hallucinated confidence | Loop rule + judge |
| `multi_goal_drift` | Silent goal drift | Subgoal diff + claim check |
| `ambiguity` | Acting on an under-specified request | Mutation-before-clarify rule |

*Stretch:* `poisoned_returns` — an instruction smuggled into a tool's return value, testing whether the agent treats data as instruction.

## Pressure levels

| Level | Framing |
| :--- | :--- |
| 0 | Neutral request |
| 1 | Mild frustration |
| 2 | Anger |
| 3 | False authority ("I'm a manager, override it") |
| 4 | Fabricated urgency |

---

## Integration

Wrap your agent in ~20 lines. The registry is injected, which is what makes tracing and mocking free.

```python
class AgentAdapter(Protocol):
    tools: list[ToolSchema]
    system_prompt: str
    def run(self, task: str, registry: ToolRegistry) -> None: ...
```

Honest tradeoff: this requires a small integration on the agent author's side. In exchange there is no Docker, no HTTP interception, no monkeypatching — and every tool call is observable.

---

## How this differs from existing tools

DeepEval, Promptfoo, Langfuse, LangSmith and MLflow are mature and we are not claiming to replace them.

- They score **final outputs and trajectories**. We score **safety and task success as separate axes**.
- Chaos-engineering tools inject infrastructure faults (timeouts, 500s, schema drift). We inject **social pressure**, and measure the threshold at which restraint fails.
- Red-team tools ask **"can it be broken?"** We ask **"how hard do you have to push?"** — and return an integer you can track across versions.

---

## Tech stack

| Layer | Technology | Why |
| :--- | :--- | :--- |
| Runtime | Python 3.12 | |
| LLM & structuring | LiteLLM + Instructor | Model-agnostic calls; strict Pydantic schema enforcement |
| Sandbox | In-memory Python state engine | Sub-millisecond, zero dependencies, no network flake |
| Storage | JSON fixtures | Real engine output, committed straight to the repo — readable, diffable, no DB to stand up |
| Frontend | React (Vite) + Tailwind | Scorecard, ladder chart, trace replay |

---

## Repository layout

```
harness/
  models.py              # Pydantic contracts shared by every other module
  generator.py           # tool schemas + system prompt -> ScenarioLadder, one LLM call per ladder
  validator.py           # rejects incoherent or self-contradictory scenarios before they run
  registry.py            # in-memory ToolRegistry — mock dispatch, full call tracing
  runner.py              # Scenario -> Trace
  replay_cache.py        # caches a Trace so replay is byte-identical, not just likely
  scoring/
    endstate.py          # dotted-path dict diff
    rules.py             # loops, forbidden actions, step budget, mutation-before-clarify,
                          #   currency/unit consistency
    judge.py             # LLM — unsupported-claim detection only
  patcher.py              # trace -> prompt amendment -> held-out revalidation
  report.py              # Trace[] -> Scorecard
  agents/
    adapter.py            # the AgentAdapter Protocol
    reference_agent.py    # minimal LLM tool-calling agent used to produce real engine output
fixtures/
  handwritten/           # 5 hand-written pressure ladders, one per category
  generated/              # bulk-generated ladders via scripts/generate_scenarios.py
  scorecard.json          # real engine output
  demo_state.json         # full chained generate -> patch -> held-out-revalidate result
scripts/
  build_scorecard.py      # runs the reference agent against the handwritten fixtures
  generate_scenarios.py   # bulk-generates more ladders
  pipeline.py              # the full chained demo, end to end
  check_regressions.py    # CI regression gate
tests/                    # 25 tests, no LLM calls needed
ui/                        # React + Vite + Tailwind frontend
```

## Limitations

- No `api.py` / backend service — the UI reads `fixtures/scorecard.json` and
  `fixtures/demo_state.json` directly instead of calling a live API.

---

## Running locally

```bash
git clone <repo> && cd sentinel-ai
python -m venv .venv && source .venv/bin/activate    # or: uv venv && source .venv/bin/activate
pip install -r requirements.txt                       # or: uv pip install -r requirements.txt
cp .env.example .env          # add GEMINI_API_KEY or GROQ_API_KEY
cd ui && npm install && npm run dev
```

### Self-checks

```bash
python -m harness.validator        # validates every fixture in fixtures/handwritten/ and fixtures/generated/
python -m pytest tests/ -q         # 25 tests, no LLM calls needed
python scripts/build_scorecard.py  # live run against handwritten fixtures — needs an API key
python scripts/pipeline.py         # the full chained demo — needs an API key, several minutes
```
