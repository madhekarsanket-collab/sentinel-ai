import { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types (subset — mirrors harness/models.py)
// ---------------------------------------------------------------------------

export type Violation = {
  type: string;
  detail: string;
  tool_call_step: number | null;
  is_safety_violation: boolean;
};

export type ToolCall = {
  step: number;
  tool_name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  error: string | null;
};

export type AgentMessage = { step: number; text: string };

export type Trace = {
  scenario_id: string;
  agent_version: string;
  tool_calls: ToolCall[];
  agent_messages: AgentMessage[];
  final_world_state: Record<string, unknown>;
  clarification_asked: boolean;
  completed: boolean;
};

export type Result = {
  scenario_id: string;
  ladder_id: string;
  category: string;
  pressure: number;
  task_success: boolean;
  safe: boolean;
  violations: Violation[];
  trace: Trace;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VIOLATION_LABEL: Record<string, string> = {
  forbidden_action: "Forbidden Action",
  tool_call_loop: "Tool Call Loop",
  step_budget_exceeded: "Step Budget Exceeded",
  mutation_before_clarify: "Mutation Before Clarify",
  unsupported_claim: "Unsupported Claim",
  subgoal_dropped: "Subgoal Dropped",
  end_state_mismatch: "End-State Mismatch",
};

const CATEGORY_LABEL: Record<string, string> = {
  baseline: "Baseline",
  destructive_under_pressure: "Destructive Under Pressure",
  degraded_tools: "Degraded Tools",
  multi_goal_drift: "Multi-Goal Drift",
  ambiguity: "Ambiguity",
  poisoned_returns: "Poisoned Returns",
};

const PRESSURE_LABEL = [
  "Neutral",
  "Mild frustration",
  "Anger",
  "False authority",
  "Fabricated urgency",
];

const MOJIBAKE: [RegExp, string][] = [
  [/\u00e2\u20ac\u201d/g, "\u2014"], // em dash
  [/\u00e2\u20ac\u201c/g, "\u2013"], // en dash
  [/\u00e2\u20ac\u2122/g, "'"],
  [/\u00e2\u20ac\u0153/g, '"'],
  [/\u00e2\u20ac\u009d/g, '"'],
  [/\u00e2\u20ac\u00a6/g, "\u2026"],
  [/\u00e2\u20ac\u00af/g, " "],
  [/\u00e2\u20ac\u2018/g, "-"],
  [/\u00c3\u00a9/g, "\u00e9"],
  [/\uFFFD/g, ""],
  [/\u202f/g, " "],
  [/\u2011/g, "-"],
];

export function clean(s: string) {
  let out = s;
  for (const [re, rep] of MOJIBAKE) out = out.replace(re, rep);
  return out;
}

/** Strip markdown emphasis so agent text reads cleanly in the timeline. */
export function plain(s: string) {
  return clean(s).replace(/\*\*(.+?)\*\*/g, "$1").replace(/(?<!\*)\*(?!\*)/g, "");
}

/** Mirror of Trace.timeline() in harness/models.py — merge and sort by step. */
type Entry =
  | { step: number; kind: "tool_call"; tool_call: ToolCall }
  | { step: number; kind: "message"; message: AgentMessage };

function timeline(trace: Trace): Entry[] {
  const entries: Entry[] = [
    ...trace.tool_calls.map(
      (tc): Entry => ({ step: tc.step, kind: "tool_call", tool_call: tc })
    ),
    ...trace.agent_messages.map(
      (m): Entry => ({ step: m.step, kind: "message", message: m })
    ),
  ];
  return entries.sort((a, b) => a.step - b.step);
}

function fmt(v: unknown) {
  return JSON.stringify(v, null, 2);
}

// ---------------------------------------------------------------------------

function Json({ value }: { value: unknown }) {
  return (
    <pre className="text-[11px] font-mono text-[var(--text-dim)] bg-[var(--void)] border border-[var(--line)] rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-64">
      {fmt(value)}
    </pre>
  );
}

export default function TraceView({
  result,
  onBack,
}: {
  result: Result;
  onBack: () => void;
}) {
  const entries = timeline(result.trace);
  const [cursor, setCursor] = useState(entries.length); // steps revealed
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<number | null>(
    result.violations.find((v) => v.tool_call_step !== null)?.tool_call_step ??
      null
  );

  // Violations anchored to a specific step, for the red highlight.
  const violationAtStep = new Map<number, Violation[]>();
  for (const v of result.violations) {
    if (v.tool_call_step !== null) {
      const list = violationAtStep.get(v.tool_call_step) ?? [];
      list.push(v);
      violationAtStep.set(v.tool_call_step, list);
    }
  }
  const floatingViolations = result.violations.filter(
    (v) => v.tool_call_step === null
  );

  const selectedCall =
    selected !== null
      ? result.trace.tool_calls.find((tc) => tc.step === selected) ?? null
      : null;

  // Advance the replay one entry at a time while playing.
  useEffect(() => {
    if (!playing) return;
    if (cursor >= entries.length) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setCursor((c) => c + 1), 700);
    return () => clearTimeout(t);
  }, [playing, cursor, entries.length]);

  // Keep the inspector in sync with the newest revealed tool call.
  useEffect(() => {
    const revealed = entries.slice(0, cursor);
    const lastTool = [...revealed]
      .reverse()
      .find((e) => e.kind === "tool_call");
    if (lastTool) setSelected(lastTool.step);
  }, [cursor]);

  const atEnd = cursor >= entries.length;

  function restart() {
    setCursor(0);
    setSelected(null);
    setPlaying(true);
  }

  return (
    <div className="flex-1 p-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <button
          onClick={onBack}
          className="text-sm text-[var(--text-dim)] hover:text-[var(--text)] cursor-pointer"
        >
          ← Back
        </button>
        <span className="px-2 py-0.5 rounded bg-[var(--panel)] border border-[var(--line)] text-[11px] font-mono text-[var(--text-dim)]">
          {result.scenario_id}
        </span>
        <span
          className={`px-2 py-0.5 rounded text-[11px] font-mono ${
            result.safe
              ? "bg-[var(--hold)]/12 text-[var(--hold)] border border-[var(--hold)]/30"
              : "bg-[var(--yield)]/15 text-[var(--yield)] border border-[var(--yield)]/45"
          }`}
        >
          {result.safe ? "HELD" : "YIELD"}
        </span>
        <span className="text-[11px] text-[var(--text-dim)]">
          {CATEGORY_LABEL[result.category] ?? result.category} · P
          {result.pressure} {PRESSURE_LABEL[result.pressure]}
        </span>

        {/* Transport */}
        <div className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[10px] text-[var(--text-faint)] tabular mr-1">
            {Math.min(cursor, entries.length)} / {entries.length}
          </span>
          <button
            onClick={() => {
              setPlaying(false);
              setCursor((c) => Math.max(0, c - 1));
            }}
            disabled={cursor <= 0}
            title="Step back"
            className="w-8 h-8 rounded border border-[var(--line)] bg-[var(--panel)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--signal)]/40 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            ‹
          </button>
          <button
            onClick={() => (atEnd ? restart() : setPlaying((p) => !p))}
            title={atEnd ? "Replay from start" : playing ? "Pause" : "Play"}
            className="w-8 h-8 rounded border border-[var(--signal)]/45 bg-[var(--signal)]/12 text-[var(--signal)] hover:bg-[var(--signal)]/20 cursor-pointer transition-colors"
          >
            {atEnd ? "↻" : playing ? "❚❚" : "▶"}
          </button>
          <button
            onClick={() => {
              setPlaying(false);
              setCursor((c) => Math.min(entries.length, c + 1));
            }}
            disabled={atEnd}
            title="Step forward"
            className="w-8 h-8 rounded border border-[var(--line)] bg-[var(--panel)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--signal)]/40 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            ›
          </button>
        </div>
      </div>

      {/* Determinism strip */}
      <div className="flex items-center gap-3 mb-4 flex-wrap text-[10px] font-mono text-[var(--text-faint)]">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--hold)]" />
          DETERMINISTIC REPLAY
        </span>
        <span>
          agent <span className="text-[var(--text-dim)]">{result.trace.agent_version}</span>
        </span>
        <span>
          scenario <span className="text-[var(--text-dim)]">{result.trace.scenario_id}</span>
        </span>
        <span className="text-[var(--text-faint)]">
          cached trace — replays byte-identical, no model calls
        </span>
      </div>

      <div className="flex gap-4 items-start rise">
        {/* Timeline */}
        <div className="flex-1 min-w-0 border border-[var(--line)] bg-[var(--panel)] rounded-md">
          <div className="px-4 py-3 border-b border-[var(--line)]">
            <h2 className="text-sm font-semibold tracking-wide">Execution trace</h2>
          </div>

          <div className="p-4 relative">
            <div className="absolute left-[26px] top-4 bottom-4 w-px bg-[var(--line)]" />

            {cursor === 0 && (
              <div className="pl-10 py-8 text-xs text-[var(--text-faint)]">
                Press play to replay this run step by step.
              </div>
            )}
            {entries.slice(0, cursor).map((e) => {
              const vs = violationAtStep.get(e.step) ?? [];
              const bad = vs.length > 0;
              const isTool = e.kind === "tool_call";
              const isSelected = selected === e.step && isTool;

              return (
                <div
                  key={`${e.kind}-${e.step}`}
                  className="relative pl-10 mb-3 rise"
                  style={{ animationDuration: "0.35s" }}
                >
                  <div
                    className={`absolute left-[19px] top-3 w-3.5 h-3.5 rounded-full border-2 ${
                      bad
                        ? "bg-[var(--yield)] border-[var(--yield)]"
                        : isTool
                        ? "bg-[var(--void)] border-[var(--signal)]"
                        : "bg-[var(--void)] border-[var(--line)]"
                    }`}
                  />

                  <div
                    onClick={() => isTool && setSelected(e.step)}
                    className={`rounded border transition-colors ${
                      isTool ? "cursor-pointer" : ""
                    } ${
                      bad
                        ? "border-l-4 border-l-[var(--yield)] border-[var(--yield)]/40 bg-[var(--yield)]/10"
                        : isSelected
                        ? "border-[var(--signal)]/60 bg-[var(--void)]"
                        : "border-[var(--line)] bg-[var(--void)] hover:border-[var(--signal)]/40"
                    }`}
                  >
                    {bad && (
                      <div className="px-3 py-1.5 bg-[var(--yield)]/20 border-b border-[var(--yield)]/30 text-[10px] font-mono font-bold tracking-wider text-[var(--yield)]">
                        VIOLATION —{" "}
                        {vs
                          .map((v) => VIOLATION_LABEL[v.type] ?? v.type)
                          .join(", ")}
                      </div>
                    )}

                    <div className="p-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[10px] font-mono text-[var(--text-dim)]">
                          STEP {e.step}
                        </span>
                        <span
                          className={`text-[10px] font-mono font-bold tracking-wider ${
                            isTool ? "text-[var(--signal)]" : "text-[var(--text-dim)]"
                          }`}
                        >
                          {isTool ? "TOOL CALL" : "AGENT MESSAGE"}
                        </span>
                      </div>

                      {e.kind === "tool_call" ? (
                        <div className="font-mono text-sm text-[var(--text)] break-all">
                          {e.tool_call.tool_name}
                          <span className="text-[var(--text-dim)]">
                            (
                            {Object.entries(e.tool_call.arguments)
                              .map(
                                ([k, v]) =>
                                  `${k}=${
                                    typeof v === "string" && v.length > 40
                                      ? JSON.stringify(v.slice(0, 40) + "…")
                                      : JSON.stringify(v)
                                  }`
                              )
                              .join(", ")}
                            )
                          </span>
                        </div>
                      ) : (
                        <div className="text-sm text-[var(--text)] italic">
                          "{plain(e.message.text)}"
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {floatingViolations.length > 0 && (
              <div className="pl-10 mt-4">
                <div className="text-[10px] font-mono tracking-wider text-[var(--text-dim)] mb-2">
                  RUN-LEVEL VIOLATIONS
                </div>
                {floatingViolations.map((v, i) => (
                  <div
                    key={i}
                    className="mb-2 rounded border border-[var(--signal)]/40 bg-[var(--signal)]/10 p-2.5"
                  >
                    <div className="text-[10px] font-mono font-bold text-[var(--signal)] mb-1">
                      {VIOLATION_LABEL[v.type] ?? v.type}
                    </div>
                    <div className="text-xs text-[var(--text)] break-words">
                      {clean(v.detail)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Inspector */}
        <div className="w-[380px] shrink-0 border border-[var(--line)] bg-[var(--panel)] rounded-md sticky top-6">
          <div className="px-4 py-3 border-b border-[var(--line)]">
            <h2 className="text-sm font-semibold tracking-wide">Step detail</h2>
          </div>

          <div className="p-4 space-y-3 min-w-0">
            {selectedCall ? (
              <>
                <div>
                  <div className="text-[10px] font-mono text-[var(--text-dim)] mb-1">
                    TOOL NAME
                  </div>
                  <div className="font-mono text-sm text-[var(--text)]">
                    {selectedCall.tool_name}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-mono text-[var(--text-dim)] mb-1">
                    ARGUMENTS
                  </div>
                  <Json value={selectedCall.arguments} />
                </div>
                <div>
                  <div className="text-[10px] font-mono text-[var(--text-dim)] mb-1">
                    SANDBOX RESULT
                  </div>
                  <Json value={selectedCall.result} />
                </div>
                {selectedCall.error && (
                  <div>
                    <div className="text-[10px] font-mono text-[var(--yield)] mb-1">
                      ERROR
                    </div>
                    <div className="text-xs text-[var(--yield)]">
                      {selectedCall.error}
                    </div>
                  </div>
                )}

                {(violationAtStep.get(selectedCall.step) ?? []).map((v, i) => (
                  <div
                    key={i}
                    className="rounded border border-[var(--yield)]/40 bg-[var(--yield)]/10 p-3"
                  >
                    <div className="text-[10px] font-mono font-bold text-[var(--yield)] mb-1.5">
                      WHY THIS FAILED
                    </div>
                    <div className="text-xs text-[var(--text)] leading-relaxed break-words">
                      {clean(v.detail)}
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div className="text-xs text-[var(--text-dim)]">
                Select a tool call in the timeline to inspect its arguments and
                result.
              </div>
            )}

            <div className="pt-3 border-t border-[var(--line)]">
              <div className="text-[10px] font-mono text-[var(--text-dim)] mb-1">
                FINAL WORLD STATE
              </div>
              <Json value={result.trace.final_world_state} />
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono text-[var(--text-dim)] pt-1">
              <span>
                clarification:{" "}
                <span className="text-[var(--text)]">
                  {String(result.trace.clarification_asked)}
                </span>
              </span>
              <span>
                completed:{" "}
                <span
                  className={
                    result.trace.completed ? "text-[var(--hold)]" : "text-[var(--yield)]"
                  }
                >
                  {String(result.trace.completed)}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
