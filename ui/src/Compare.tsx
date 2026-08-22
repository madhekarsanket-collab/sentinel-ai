import demo from "./fixtures/demo_state.json";
import type { Result } from "./TraceView";
import { GlowCard } from "./Effects";

type Card = {
  agent_name: string;
  agent_version: string;
  run_id: string;
  results: Result[];
};

type DemoState = {
  agent_versions: Record<string, { system_prompt: string }>;
  patch: { diagnosis: string; amendment: string; rationale: string };
  scorecards: {
    v1_patch_set: Card;
    v1_held_out: Card;
    v2_held_out: Card;
  };
  held_out_delta: {
    held_out_scenarios: number;
    safety_rate_before: number;
    safety_rate_after: number;
    breaking_pressure_before: number | null;
    breaking_pressure_after: number | null;
  };
  round2_patch?: {
    amendment: string;
    rationale: string;
    scorecard: Card;
    delta_vs_v1_held_out: {
      improved: string[];
      regressed: string[];
      unchanged_count: number;
      safety_rate_before: number;
      safety_rate_after: number;
    };
  };
};

const D = demo as unknown as DemoState;
const BEFORE = D.scorecards.v1_held_out;
const AFTER = D.scorecards.v2_held_out;
const DIAGNOSED = D.scorecards.v1_patch_set;
const ROUND2 = D.round2_patch;

const CATEGORY_LABEL: Record<string, string> = {
  baseline: "Baseline",
  destructive_under_pressure: "Destructive Under Pressure",
  degraded_tools: "Degraded Tools",
  multi_goal_drift: "Multi-Goal Drift",
  ambiguity: "Ambiguity",
  poisoned_returns: "Poisoned Returns",
};

const VIOLATION_LABEL: Record<string, string> = {
  forbidden_action: "Forbidden Action",
  tool_call_loop: "Tool Call Loop",
  step_budget_exceeded: "Step Budget Exceeded",
  mutation_before_clarify: "Mutation Before Clarify",
  unsupported_claim: "Unsupported Claim",
  subgoal_dropped: "Subgoal Dropped",
  end_state_mismatch: "End-State Mismatch",
};

const PRESSURE_LABEL = [
  "Neutral",
  "Mild frustration",
  "Anger",
  "False authority",
  "Fabricated urgency",
];

/** Index a run by category then pressure, so two runs can be joined on category. */
function byCategory(card: Card) {
  const m = new Map<string, (Result | undefined)[]>();
  for (const r of card.results) {
    if (!m.has(r.category)) m.set(r.category, [, , , , ,] as (Result | undefined)[]);
    m.get(r.category)![r.pressure] = r;
  }
  return m;
}

function firstYield(rungs: (Result | undefined)[]) {
  for (let i = 0; i < rungs.length; i++) if (rungs[i] && !rungs[i]!.safe) return i;
  return null;
}

const beforeMap = byCategory(BEFORE);
const afterMap = byCategory(AFTER);
const diagnosedMap = byCategory(DIAGNOSED);

const categories = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort();

type Verdict = "fixed" | "regressed" | "stable-held" | "stable-yield" | "absent";

function verdictFor(a?: Result, b?: Result): Verdict {
  if (!a || !b) return "absent";
  if (a.safe && b.safe) return "stable-held";
  if (!a.safe && !b.safe) return "stable-yield";
  return a.safe ? "regressed" : "fixed";
}

const CELL: Record<Verdict, { cls: string; mark: string }> = {
  fixed: {
    cls: "border-[var(--hold)] bg-[var(--hold)]/18 text-[var(--hold)]",
    mark: "FIXED",
  },
  regressed: {
    cls: "border-[var(--yield)] bg-[var(--yield)]/20 text-[var(--yield)] halo",
    mark: "BROKE",
  },
  "stable-held": {
    cls: "border-[var(--hold)]/18 bg-[var(--hold)]/5 text-[var(--hold)]/50",
    mark: "held",
  },
  "stable-yield": {
    cls: "border-[var(--yield)]/25 bg-[var(--yield)]/6 text-[var(--yield)]/60",
    mark: "yield",
  },
  absent: {
    cls: "border-[var(--line-soft)] text-[var(--text-faint)]",
    mark: "—",
  },
};

const fixedCount = categories.reduce(
  (acc, c) =>
    acc +
    [0, 1, 2, 3, 4].filter(
      (p) => verdictFor(beforeMap.get(c)?.[p], afterMap.get(c)?.[p]) === "fixed"
    ).length,
  0
);
const brokeCount = categories.reduce(
  (acc, c) =>
    acc +
    [0, 1, 2, 3, 4].filter(
      (p) =>
        verdictFor(beforeMap.get(c)?.[p], afterMap.get(c)?.[p]) === "regressed"
    ).length,
  0
);

const delta = D.held_out_delta;
const netWorse = delta.safety_rate_after < delta.safety_rate_before;

function Stat({
  label,
  from,
  to,
  suffix = "",
  prefix = "",
  higherIsBetter = true,
}: {
  label: string;
  from: number | null;
  to: number | null;
  suffix?: string;
  prefix?: string;
  higherIsBetter?: boolean;
}) {
  const fmt = (v: number | null) => (v === null ? "—" : `${prefix}${v}${suffix}`);
  const changed = from !== to;
  const improved =
    from === null || to === null
      ? to === null
      : higherIsBetter
      ? to > from
      : to < from;
  const tone = !changed
    ? "text-[var(--text-dim)]"
    : improved
    ? "text-[var(--hold)]"
    : "text-[var(--yield)]";

  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-2 font-mono tabular">
        <span className="text-[var(--text-faint)] text-lg">{fmt(from)}</span>
        <span className="text-[var(--text-faint)] text-sm">→</span>
        <span className={`text-2xl font-semibold ${tone}`}>{fmt(to)}</span>
        {changed && <span className={`text-xs ${tone}`}>{improved ? "▲" : "▼"}</span>}
      </div>
    </div>
  );
}

/** Compact five-cell strip showing one run's ladder for one category. */
function Strip({ rungs }: { rungs: (Result | undefined)[] }) {
  return (
    <div className="flex gap-1">
      {[0, 1, 2, 3, 4].map((p) => {
        const r = rungs[p];
        return (
          <span
            key={p}
            title={`P${p} · ${r ? (r.safe ? "held" : "yielded") : "n/a"}`}
            className={`w-5 h-5 rounded-sm border ${
              !r
                ? "border-[var(--line-soft)]"
                : r.safe
                ? "border-[var(--hold)]/40 bg-[var(--hold)]/12"
                : "border-[var(--yield)]/60 bg-[var(--yield)]/25"
            }`}
          />
        );
      })}
    </div>
  );
}

export default function Compare({ onSelect }: { onSelect: (r: Result) => void }) {
  return (
    <div className="space-y-4">
      <header className="rise">
        <div className="eyebrow mb-2">Patch validation</div>
        <h1 className="text-[1.9rem] leading-none font-semibold tracking-tight">
          Auto-patch, validated on held-out scenarios
        </h1>
        <p className="mt-3 text-sm text-[var(--text-dim)] max-w-3xl leading-relaxed">
          The generated suite is split in two. One half diagnoses the agent and
          feeds the patch generator; the other half is never seen during patching
          and is used only to judge whether the patch actually helped. The first
          patch failed that test. The second passed it.
        </p>
      </header>

      {/* Verdict */}
      <GlowCard
        className={`p-5 ${
          netWorse ? "border-[var(--yield)]/40" : "border-[var(--hold)]/40"
        }`}
        delay={60}
      >
        <div className="flex items-start gap-3 flex-wrap">
          <span
            className={`mt-1 w-2 h-2 rounded-full blink ${
              netWorse ? "bg-[var(--yield)]" : "bg-[var(--hold)]"
            }`}
          />
          <div className="min-w-0">
            <div
              className={`font-mono text-[11px] tracking-widest uppercase ${
                netWorse ? "text-[var(--yield)]" : "text-[var(--hold)]"
              }`}
            >
              {netWorse ? "Attempt 1 — rejected" : "Attempt 1 — accepted"}
            </div>
            <p className="mt-2 text-sm text-[var(--text)] leading-relaxed max-w-3xl">
              The patch eliminated every failure in the category it was built
              from — but introduced {brokeCount} new failures in a category that
              was previously clean. Net safety fell from{" "}
              {Math.round(delta.safety_rate_before * 100)}% to{" "}
              {Math.round(delta.safety_rate_after * 100)}%. On the patch set
              alone this would have looked like a win.
            </p>
          </div>
        </div>
      </GlowCard>

      {/* Stage 1: diagnosis */}
      <GlowCard className="p-5" delay={120}>
        <div className="eyebrow mb-3">Stage 1 · Diagnosis on the patch set</div>
        <div className="space-y-2">
          {categories.map((c) => {
            const rungs = diagnosedMap.get(c) ?? [];
            const y = firstYield(rungs);
            return (
              <div key={c} className="flex items-center gap-3">
                <Strip rungs={rungs} />
                <span className="text-[13px] text-[var(--text-dim)] flex-1 truncate">
                  {CATEGORY_LABEL[c] ?? c}
                </span>
                <span className="font-mono text-[11px] tabular">
                  {y === null ? (
                    <span className="text-[var(--hold)]">held</span>
                  ) : (
                    <span className="text-[var(--yield)]">yields P{y}</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <pre className="mt-4 p-3 rounded bg-[var(--void)] border border-[var(--line)] text-[11px] font-mono text-[var(--text-dim)] whitespace-pre-wrap leading-relaxed overflow-x-auto">
          {D.patch.diagnosis}
        </pre>
      </GlowCard>

      {/* Stage 2: the patch */}
      <GlowCard className="p-5" delay={180}>
        <div className="eyebrow mb-3">Stage 2 · Synthesized system-prompt amendment</div>
        <pre className="p-3 rounded bg-[var(--signal)]/6 border border-[var(--signal)]/25 text-[12px] font-mono text-[var(--text)] whitespace-pre-wrap leading-relaxed">
          {D.patch.amendment}
        </pre>
        <p className="mt-3 text-xs text-[var(--text-dim)] leading-relaxed">
          {D.patch.rationale}
        </p>
      </GlowCard>

      {/* Stage 3: held-out validation */}
      <GlowCard className="p-5" delay={240}>
        <div className="eyebrow mb-4">
          Stage 3 · Held-out validation · {delta.held_out_scenarios} scenarios
        </div>

        <div className="flex gap-8 flex-wrap mb-5 pb-5 border-b border-[var(--line-soft)]">
          <Stat
            label="Yield point"
            from={delta.breaking_pressure_before}
            to={delta.breaking_pressure_after}
            prefix="P"
          />
          <Stat
            label="Safety rate"
            from={Math.round(delta.safety_rate_before * 100)}
            to={Math.round(delta.safety_rate_after * 100)}
            suffix="%"
          />
          <Stat label="Cells fixed" from={0} to={fixedCount} />
          <Stat
            label="Cells regressed"
            from={0}
            to={brokeCount}
            higherIsBetter={false}
          />
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[700px]">
            <div className="grid grid-cols-[minmax(190px,1fr)_repeat(5,92px)_92px] gap-2 mb-3">
              <div />
              {PRESSURE_LABEL.map((l, i) => (
                <div key={i} className="text-center">
                  <div className="font-mono text-[12px] text-[var(--text-dim)]">
                    P{i}
                  </div>
                  <div className="text-[9px] leading-tight text-[var(--text-faint)] mt-0.5">
                    {l}
                  </div>
                </div>
              ))}
              <div className="eyebrow text-right self-end pb-0.5">Yield</div>
            </div>

            {categories.map((c, ci) => {
              const a = beforeMap.get(c) ?? [];
              const b = afterMap.get(c) ?? [];
              const ay = firstYield(a);
              const by = firstYield(b);
              return (
                <div
                  key={c}
                  className="grid grid-cols-[minmax(190px,1fr)_repeat(5,92px)_92px] gap-2 items-center mb-2"
                >
                  <div className="text-[13px] text-[var(--text-dim)] truncate pr-3">
                    {CATEGORY_LABEL[c] ?? c}
                  </div>

                  {[0, 1, 2, 3, 4].map((p) => {
                    const v = verdictFor(a[p], b[p]);
                    const style = CELL[v];
                    const target = b[p] ?? a[p];
                    const vio = b[p]?.violations
                      .map((x) => VIOLATION_LABEL[x.type] ?? x.type)
                      .join(", ");
                    return (
                      <button
                        key={p}
                        onClick={() => target && onSelect(target)}
                        style={{ animationDelay: `${320 + (ci * 5 + p) * 40}ms` }}
                        title={vio || `${a[p]?.safe ? "held" : "yielded"} → ${b[p]?.safe ? "held" : "yielded"}`}
                        className={`power-on h-11 rounded border font-mono text-[10px] tracking-wide cursor-pointer transition-transform duration-150 hover:-translate-y-0.5 ${style.cls}`}
                      >
                        {style.mark}
                      </button>
                    );
                  })}

                  <div className="text-right font-mono text-[12px] tabular">
                    <span className="text-[var(--text-faint)]">
                      {ay === null ? "—" : `P${ay}`}
                    </span>
                    <span className="text-[var(--text-faint)] mx-1">→</span>
                    <span
                      className={
                        by === null ? "text-[var(--hold)]" : "text-[var(--yield)]"
                      }
                    >
                      {by === null ? "—" : `P${by}`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <p className="mt-4 pt-4 border-t border-[var(--line-soft)] text-xs text-[var(--text-dim)] leading-relaxed max-w-3xl">
          The amendment told the agent to stop and confirm rather than repeat a
          data-modifying call. On multi-goal tasks it now stops after the first
          subgoal and never completes the second — the regression is{" "}
          <span className="text-[var(--yield)]">Subgoal Dropped</span>, a direct
          consequence of the fix. This is why patches are validated on scenarios
          they were not derived from.
        </p>
      </GlowCard>

      {/* Stage 4: revised patch */}
      {ROUND2 && <Round2 onSelect={onSelect} />}
    </div>
  );
}


/**
 * Stage 4 — the revised patch.
 *
 * Joined on (category, pressure), NOT scenario_id: the hand-written fixture
 * categories are re-seeded with fresh ids each time they're loaded, so
 * v1_held_out and round2 only share 10 of 25 scenario_ids. Category+pressure is
 * stable across runs.
 */
function Round2({ onSelect }: { onSelect: (r: Result) => void }) {
  const r2 = ROUND2!;
  const afterMap2 = byCategory(r2.scorecard);
  const delta = r2.delta_vs_v1_held_out;
  const cats = [...new Set([...beforeMap.keys(), ...afterMap2.keys()])].sort();

  return (
    <GlowCard className="p-5 border-[var(--hold)]/40" delay={300}>
      <div className="eyebrow mb-3">
        Stage 4 · Revised patch, re-validated on the same held-out set
      </div>

      <div className="flex items-start gap-3 mb-5">
        <span className="mt-1 w-2 h-2 rounded-full blink bg-[var(--hold)]" />
        <div className="min-w-0">
          <div className="font-mono text-[11px] tracking-widest uppercase text-[var(--hold)]">
            Attempt 2 — accepted
          </div>
          <p className="mt-2 text-sm text-[var(--text)] leading-relaxed max-w-3xl">
            The first amendment required an authorisation check before every
            refund. The revised one conditions that check on the delivery-date
            data actually being present — which the multi-goal scenarios do not
            carry. It fixes the same {delta.improved.length} destructive-action
            failures with zero regressions, and every category now holds at all
            five pressure levels.
          </p>
          <p className="mt-2 text-xs text-[var(--text-faint)] leading-relaxed max-w-3xl">
            An intermediate attempt made things worse still — it demanded the
            delivery date unconditionally, so the agent stalled on all five
            multi-goal rungs instead of four. It was never persisted: the
            pipeline only writes a patch to disk once it clears the held-out set
            with no regressions.
          </p>
        </div>
      </div>

      <pre className="p-3 rounded bg-[var(--hold)]/6 border border-[var(--hold)]/25 text-[12px] font-mono text-[var(--text)] whitespace-pre-wrap leading-relaxed mb-3">
        {r2.amendment}
      </pre>

      <div className="flex gap-8 flex-wrap mb-5 pb-5 border-b border-[var(--line-soft)]">
        <Stat
          label="Safety rate"
          from={Math.round(delta.safety_rate_before * 100)}
          to={Math.round(delta.safety_rate_after * 100)}
          suffix="%"
        />
        <Stat label="Cells fixed" from={0} to={delta.improved.length} />
        <Stat
          label="Cells regressed"
          from={0}
          to={delta.regressed.length}
          higherIsBetter={false}
        />
        <div>
          <div className="eyebrow">CI gate</div>
          <div className="mt-1.5 font-mono text-2xl font-semibold text-[var(--hold)]">
            PASS
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[700px]">
          <div className="grid grid-cols-[minmax(190px,1fr)_repeat(5,92px)_92px] gap-2 mb-3">
            <div />
            {PRESSURE_LABEL.map((l, i) => (
              <div key={i} className="text-center">
                <div className="font-mono text-[12px] text-[var(--text-dim)]">
                  P{i}
                </div>
                <div className="text-[9px] leading-tight text-[var(--text-faint)] mt-0.5">
                  {l}
                </div>
              </div>
            ))}
            <div className="eyebrow text-right self-end pb-0.5">Yield</div>
          </div>

          {cats.map((c, ci) => {
            const a = beforeMap.get(c) ?? [];
            const b = afterMap2.get(c) ?? [];
            const ay = firstYield(a);
            const by = firstYield(b);
            return (
              <div
                key={c}
                className="grid grid-cols-[minmax(190px,1fr)_repeat(5,92px)_92px] gap-2 items-center mb-2"
              >
                <div className="text-[13px] text-[var(--text-dim)] truncate pr-3">
                  {CATEGORY_LABEL[c] ?? c}
                </div>

                {[0, 1, 2, 3, 4].map((p) => {
                  const v = verdictFor(a[p], b[p]);
                  const style = CELL[v];
                  const target = b[p] ?? a[p];
                  return (
                    <button
                      key={p}
                      onClick={() => target && onSelect(target)}
                      style={{ animationDelay: `${340 + (ci * 5 + p) * 40}ms` }}
                      title={`${a[p]?.safe ? "held" : "yielded"} -> ${
                        b[p]?.safe ? "held" : "yielded"
                      }`}
                      className={`power-on h-11 rounded border font-mono text-[10px] tracking-wide cursor-pointer transition-transform duration-150 hover:-translate-y-0.5 ${style.cls}`}
                    >
                      {style.mark}
                    </button>
                  );
                })}

                <div className="text-right font-mono text-[12px] tabular">
                  <span className="text-[var(--text-faint)]">
                    {ay === null ? "—" : `P${ay}`}
                  </span>
                  <span className="text-[var(--text-faint)] mx-1">→</span>
                  <span
                    className={
                      by === null ? "text-[var(--hold)]" : "text-[var(--yield)]"
                    }
                  >
                    {by === null ? "—" : `P${by}`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-4 pt-4 border-t border-[var(--line-soft)] text-xs text-[var(--text-dim)] leading-relaxed max-w-3xl">
        <span className="text-[var(--hold)]">scripts/check_regressions.py</span>{" "}
        runs on every push via GitHub Actions and compares against this
        committed result. Attempt 1 fails that gate; attempt 2 passes it. The
        gate is cell-level, not aggregate — a run whose overall score improves
        while any single scenario regresses is still blocked.
      </p>
    </GlowCard>
  );
}
