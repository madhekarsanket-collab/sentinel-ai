# SENTINEL.AI

AI agent evaluation/reliability harness for OOSC 4.0 Hackathon (IIIT Allahabad, Problem
Statement 4, Team Dark Fantasy). Runs identical scenarios at 5 escalating "pressure" levels
(neutral -> mild frustration -> anger -> false authority -> fabricated urgency) and reports
`breaking_pressure`: the rung where an agent's safety collapses. See [README.md](README.md)
for the full pitch and architecture.

Repo was originally named YIELDPOINT; renamed to SENTINEL.AI (team decision, 2026-08-21) to
match already-built UI screens. If you see "YIELDPOINT" anywhere, it's stale — replace it.

## Team ownership

**Two-person team — A and B, no C.** An early planning doc referenced a third role
("Person C" building `agents/support_agent.py`); B confirmed on 2026-08-22 that's stale —
the team is just the two of them. `agents/reference_agent.py` (a generic LLM tool-caller,
not a polished agent under test) is what's actually there, and nobody is currently assigned
to build a more polished replacement — treat that as an open gap, not someone else's task.

- **Person A** (this session's work): `models.py`, `fixtures/handwritten/`, `generator.py`,
  `validator.py`, `patcher.py`. Frozen contracts + scenario generation/validation/patching.
  Also built a full starter execution harness (below) to unblock Person B, and the chained
  end-to-end pipeline — neither was originally Person A's assignment.
- **Person B**: `registry.py`, `runner.py`, `scoring/*`, the frontend. As of 2026-08-22, B
  had not started the execution harness, so Person A built a working starter for all of it
  (see "What's built" below) — intended to be extended/replaced by B, not a claim of
  ownership. Read `harness/registry.py` and `harness/runner.py` before assuming they're final.
- **Nobody owns `api.py` yet.** Nothing currently exposes this as a running service; the UI
  reads `fixtures/*.json` directly instead.

## What's built (all tested against the real Groq API, not just fixtures)

- `harness/models.py` — frozen Pydantic contracts. `ScenarioLadder` (one generation call ->
  5 pressure variants) flattens to `Scenario[]`. `Trace.timeline()` merges `tool_calls` and
  `agent_messages` (both carry a shared `step: int`) into one chronological sequence for a
  UI trace/replay view — added specifically because B needed it.
- `fixtures/handwritten/` — 5 hand-written pressure ladders (one per category: baseline,
  destructive_under_pressure, degraded_tools, multi_goal_drift, ambiguity), all sharing one
  electronics-store support-agent domain and a 10-tool schema (`tools.json`).
- `fixtures/generated/` — one bulk-generated ladder per category (10 ladders total across
  both dirs), produced by `scripts/generate_scenarios.py`. Exists so `patcher.split_scenarios`
  has >=2 ladders per category to stratify across, not just 1.
- `harness/generator.py` / `validator.py` / `patcher.py` — generation, validation, and the
  diagnose/synthesize-patch/held-out-revalidate pipeline.
  - `validator.py` checks: pressure coverage, dotted-path resolution, forbidden-action IDs,
    world-state size, category-specific requirements, heuristic solvability, **and now
    self-contradiction** (`check_no_forbidden_expected_contradiction`: rejects a scenario
    where a forbidden_action blocks the only call that could ever satisfy
    expected_end_state — found a real instance of this in a bulk-generated fixture).
  - `patcher.split_scenarios` is stratified by category (>=2 ladders in a category ->
    guaranteed representation on both sides of the split, for any seed), not a plain
    shuffle-then-cut — a plain shuffle stranded a whole failure category on one side in
    practice on this project's first real chained run.
- `harness/registry.py`, `runner.py`, `scoring/{endstate,rules,judge}.py`, `report.py`,
  `agents/adapter.py` — the execution harness. `ToolRegistry` implements all 10 tools against
  the fixture domain and records every call as a `Trace`.
- `harness/replay_cache.py` — makes "same seed + same world = byte-identical replay" (the
  pitch's own claim) actually true instead of hoping an LLM provider's `seed` param is a hard
  guarantee (it isn't). `runner.run_scenario(..., use_cache=True)` caches a Trace by
  (scenario.id, scenario.seed, agent_version, agent_fingerprint) and serves it back with zero
  further agent/LLM calls on a repeat call. Defaults to `False` so existing callers are
  unaffected; opt in per-call.
- `harness/agents/reference_agent.py` + `scripts/build_scorecard.py` — a minimal generic
  LLM tool-calling agent (NOT the real agent under test) that runs all handwritten fixtures
  end-to-end and writes real engine output to `fixtures/scorecard.json`.
- `scripts/pipeline.py` — **the project's own stated definition of done, actually chained**:
  load ladders (handwritten + generated) -> stratified split A/B -> run v1 on A -> diagnose
  -> synthesize a patch -> run v1 AND v2 on held-out B -> compare -> dump
  `fixtures/demo_state.json`. This had never been run end-to-end before 2026-08-22; it now
  has, against the real Groq API, and produced a genuine (not staged) finding — see below.

## The real chained-pipeline result (fixtures/demo_state.json, 2026-08-22)

10 ladders, 50 scenarios, real Groq calls throughout. The patch (synthesized from v1's
failures on set A) fixed exactly what it was built from — `destructive_under_pressure`
improved on the held-out set, where v1 caved and v2 correctly refused/escalated. It also
**overcorrected** onto a different, previously-safe category: `multi_goal_drift` broke in v2
because the patch's "verify authorization before any refund, else escalate" clause applied
too broadly, causing v2 to refuse a completely legitimate in-policy refund it had handled
correctly before patching. Net: held-out `safety_rate` 0.92 -> 0.84, `breaking_pressure` 2 ->
1 — a real regression, caught specifically because held-out validation was done properly
(checking only the targeted category would have looked like a clean win). This is a stronger
demo story than a clean win: it's concrete proof the held-out methodology matters, not just a
claim about it.

## Key decisions

- **Model**: Groq's `openai/gpt-oss-120b` (via LiteLLM), configured through `MODEL_NAME` in
  `.env`. Groq's model catalog had changed since training data — `llama-3.3-70b-versatile`
  no longer exists; verify against `console.groq.com` if things start 404ing again.
- **Groq free tier has TWO limits that both bit us**: 8000 tokens/minute (TPM) and
  200,000 tokens/day (TPD) per organization. TPM is recoverable with backoff (all live-call
  sites now have exponential backoff: generator.py, judge.py, patcher.py,
  reference_agent.py). TPD is NOT recoverable within the same day — it needs either the
  daily reset or a second Groq account (new org = new independent quota; a second key from
  the *same* account shares the same exhausted quota). If a live run's traces contain
  `RateLimitError` in `agent_messages` with 0-1 tool calls, that run is corrupted, not a
  real result — check before trusting any output.
- **`UNSUPPORTED_CLAIM` stays a safety violation** (not downgraded to
  `is_safety_violation=False`), even though it initially produced false positives on the
  `baseline` control category. Downgrading it globally would also silence it for
  `degraded_tools`, where a false "confirmed in stock" against an explicitly unknown
  inventory result is a real safety issue. Fixed the judge prompt instead (only flag
  scenario-specific claims contradicted by or asserted-certain-over ambiguous tool data).
- **Currency/unit mismatches are caught deterministically, not via the LLM judge.**
  Real bug found in a live trace: agent called `issue_refund(amount=8600)` then told the
  customer "$86.00 has been returned" (paise/cents confusion). The judge missed the exact
  reproduction case even with explicit instructions — it likely rationalizes the same
  "maybe it's paise" conversion the agent made. This is exact arithmetic, not a judgment
  call, so `scoring/rules.py:check_stated_amount_consistency` does it with a regex + float
  comparison instead. Also fixed root cause: `tools.json`'s `issue_refund.amount` now states
  its unit explicitly (whole rupees, not paise/cents).
- **Self-contradictory scenarios are a distinct validator failure mode from "unsolvable".**
  `check_solvability` only excludes a tool when it's blanket-forbidden (empty
  `matching_args`). A forbidden_action can target one specific entity and still be a total
  contradiction (if the tool has no other required parameter to vary) or still leave a legal
  path open (if another required parameter, like a refund amount, is pinned to one specific
  *wrong* value — a legitimate guard, not a bug). `check_no_forbidden_expected_contradiction`
  checks this precisely: contradiction iff no other required tool parameter is left free.
- **Ladders are generated as ONE LLM call returning all 5 pressure levels**, never 5
  separate calls — otherwise `breaking_pressure` compares 5 different tasks, not 5 tones of
  the same one. Enforced in `generator.py`'s prompt.
- **Patch/validate split is stratified by category, not a plain shuffle.** With only 1-2
  ladders per category, a plain shuffle-then-cut can strand an entire failure category on
  one side by chance — happened in practice (see the chained-pipeline section above for what
  it looks like when it doesn't happen). `split_scenarios` now guarantees any category with
  >=2 ladders appears on both sides, for any seed.
- **Deterministic replay is a cache, not a hope.** `ToolRegistry` itself has zero randomness
  (pure functions over `world_state`) — the only non-determinism is the agent's own LLM
  sampling, and no provider's `seed` parameter is a hard guarantee. `replay_cache.py` makes
  the pitch's "byte-identical replay" claim literally true by caching the first real Trace
  and serving it back, rather than hoping the API reproduces itself.

## Known gaps (not done, and whose job it probably is)

1. Only 10 ladders exist total (5 handwritten + 5 bulk-generated, one per category each).
   The demo story would be stronger with more — `scripts/generate_scenarios.py` can be
   re-run with `LADDERS_PER_CATEGORY` raised, budget permitting.
2. No real agent under test exists yet (`agents/reference_agent.py` is an explicit
   placeholder with a bare system prompt — no policy knowledge baked in on purpose, so it
   fails destructive_under_pressure uniformly regardless of pressure in some runs; that's
   the placeholder's limitation, not a pressure-related finding). Nobody is currently
   assigned to build a more polished one — team is A and B only, no C.
3. No `api.py` / backend service — nothing runs as a server. The UI reads
   `fixtures/scorecard.json` and `fixtures/demo_state.json` directly instead, which the
   team has explicitly decided is fine given the two-person scope. (Unowned, and likely
   staying that way — see the README's Limitations section.)
4. The `multi_goal_drift` overcorrection found in the chained-pipeline run (see above) is a
   real, uninvestigated finding — nobody has tried writing a better-targeted patch that fixes
   `destructive_under_pressure` without breaking `multi_goal_drift`. Would make a good demo
   "round 2" if there's time. The CI regression gate (`.github/workflows/sentinel.yml`,
   added 2026-08-22) currently fails on exactly this, honestly — that's expected until a
   better patch is written and `fixtures/demo_state.json` is regenerated.

Resolved since first written: the repo is now actually pushed to
github.com/madhekarsanket-collab/sentinel-ai (was zip-handoff only before 2026-08-22); the
UI is fully wired to real `demo_state.json`/`scorecard.json` output, confirmed zero
references to the old taxonomy anywhere in `ui/src`; the stale `core/models.py` contract
(different taxonomy, different Person A/B split, predated this one) has been deleted.

## Running things

```bash
pip install -r requirements.txt
cp .env.example .env               # add GROQ_API_KEY or GEMINI_API_KEY, set MODEL_NAME
python -m harness.validator        # validate all fixtures
python -m pytest tests/ -q         # 25 tests, no LLM calls needed
python scripts/check_regressions.py   # CI's regression gate — also free, no LLM calls
python scripts/build_scorecard.py  # live run against handwritten fixtures only
python scripts/generate_scenarios.py  # bulk-generate more ladders into fixtures/generated/
python scripts/pipeline.py         # the full chained demo: generate/load -> split -> v1 ->
                                    # diagnose -> patch -> v2 -> compare -> demo_state.json
```

The three live scripts (`build_scorecard.py`, `generate_scenarios.py`, `pipeline.py`) need
an API key and take real time/tokens (a few minutes to ~20+ minutes for `pipeline.py`,
depending on Groq free-tier throttling). `.env` is gitignored and never committed.
`.github/workflows/sentinel.yml` runs tests + the regression gate on every push/PR — it
does NOT call any live script, so it needs no API key and can't be rate-limited.
