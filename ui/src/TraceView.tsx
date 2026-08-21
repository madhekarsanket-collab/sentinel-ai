import { useState } from "react";

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

export function clean(s: string) {
  try {
    // Text was UTF-8 bytes decoded as Latin-1 upstream; reverse that.
    const bytes = Uint8Array.from([...s].map((c) => c.charCodeAt(0) & 0xff));
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (!decoded.includes("\uFFFD")) s = decoded;
  } catch {
    /* fall through */
  }
  return s.replace(/\u2011/g, "-").replace(/\u202f/g, " ");
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
    <pre className="text-[11px] font-mono text-[#A8B2C0] bg-[#0B0D10] border border-[#232A32] rounded p-2 overflow-x-auto whitespace-pre-wrap">
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

  return (
    <div className="flex-1 p-6 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={onBack}
          className="text-sm text-[#A8B2C0] hover:text-[#E8ECF1] cursor-pointer"
        >
          ← Back to Report
        </button>
        <span className="px-2 py-0.5 rounded bg-[#14181D] border border-[#232A32] text-[11px] font-mono text-[#A8B2C0]">
          {result.scenario_id}
        </span>
        <span
          className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold ${
            result.safe
              ? "bg-[#2ECC71]/15 text-[#2ECC71]"
              : "bg-[#FF4D4D] text-[#0B0D10]"
          }`}
        >
          {result.safe ? "SAFE" : "UNSAFE"}
        </span>
        <span className="text-[11px] text-[#A8B2C0]">
          {CATEGORY_LABEL[result.category] ?? result.category} · P
          {result.pressure} {PRESSURE_LABEL[result.pressure]}
        </span>
      </div>

      <div className="flex gap-4 items-start">
        {/* Timeline */}
        <div className="flex-1 min-w-0 border border-[#232A32] bg-[#14181D] rounded-md">
          <div className="px-4 py-3 border-b border-[#232A32]">
            <h2 className="text-sm font-semibold tracking-wide">
              EXECUTION TRACE
            </h2>
          </div>

          <div className="p-4 relative">
            <div className="absolute left-[26px] top-4 bottom-4 w-px bg-[#232A32]" />

            {entries.map((e) => {
              const vs = violationAtStep.get(e.step) ?? [];
              const bad = vs.length > 0;
              const isTool = e.kind === "tool_call";
              const isSelected = selected === e.step && isTool;

              return (
                <div key={`${e.kind}-${e.step}`} className="relative pl-10 mb-3">
                  <div
                    className={`absolute left-[19px] top-3 w-3.5 h-3.5 rounded-full border-2 ${
                      bad
                        ? "bg-[#FF4D4D] border-[#FF4D4D]"
                        : isTool
                        ? "bg-[#0B0D10] border-[#7C5CFF]"
                        : "bg-[#0B0D10] border-[#232A32]"
                    }`}
                  />

                  <div
                    onClick={() => isTool && setSelected(e.step)}
                    className={`rounded border transition-colors ${
                      isTool ? "cursor-pointer" : ""
                    } ${
                      bad
                        ? "border-l-4 border-l-[#FF4D4D] border-[#FF4D4D]/40 bg-[#FF4D4D]/10"
                        : isSelected
                        ? "border-[#7C5CFF]/60 bg-[#0B0D10]"
                        : "border-[#232A32] bg-[#0B0D10] hover:border-[#7C5CFF]/40"
                    }`}
                  >
                    {bad && (
                      <div className="px-3 py-1.5 bg-[#FF4D4D]/20 border-b border-[#FF4D4D]/30 text-[10px] font-mono font-bold tracking-wider text-[#FF4D4D]">
                        ⚠ VIOLATION —{" "}
                        {vs
                          .map((v) => VIOLATION_LABEL[v.type] ?? v.type)
                          .join(", ")}
                      </div>
                    )}

                    <div className="p-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[10px] font-mono text-[#A8B2C0]">
                          STEP {e.step}
                        </span>
                        <span
                          className={`text-[10px] font-mono font-bold tracking-wider ${
                            isTool ? "text-[#7C5CFF]" : "text-[#A8B2C0]"
                          }`}
                        >
                          {isTool ? "TOOL CALL" : "AGENT MESSAGE"}
                        </span>
                      </div>

                      {e.kind === "tool_call" ? (
                        <div className="font-mono text-sm text-[#E8ECF1] break-all">
                          {e.tool_call.tool_name}
                          <span className="text-[#A8B2C0]">
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
                        <div className="text-sm text-[#E8ECF1] italic">
                          "{clean(e.message.text)}"
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {floatingViolations.length > 0 && (
              <div className="pl-10 mt-4">
                <div className="text-[10px] font-mono tracking-wider text-[#A8B2C0] mb-2">
                  RUN-LEVEL VIOLATIONS
                </div>
                {floatingViolations.map((v, i) => (
                  <div
                    key={i}
                    className="mb-2 rounded border border-[#FFB020]/40 bg-[#FFB020]/10 p-2.5"
                  >
                    <div className="text-[10px] font-mono font-bold text-[#FFB020] mb-1">
                      {VIOLATION_LABEL[v.type] ?? v.type}
                    </div>
                    <div className="text-xs text-[#E8ECF1]">
                      {clean(v.detail)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Inspector */}
        <div className="w-[380px] shrink-0 border border-[#232A32] bg-[#14181D] rounded-md sticky top-6">
          <div className="px-4 py-3 border-b border-[#232A32]">
            <h2 className="text-sm font-semibold tracking-wide">STEP DETAIL</h2>
          </div>

          <div className="p-4 space-y-3">
            {selectedCall ? (
              <>
                <div>
                  <div className="text-[10px] font-mono text-[#A8B2C0] mb-1">
                    TOOL NAME
                  </div>
                  <div className="font-mono text-sm text-[#E8ECF1]">
                    {selectedCall.tool_name}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-mono text-[#A8B2C0] mb-1">
                    ARGUMENTS
                  </div>
                  <Json value={selectedCall.arguments} />
                </div>
                <div>
                  <div className="text-[10px] font-mono text-[#A8B2C0] mb-1">
                    SANDBOX RESULT
                  </div>
                  <Json value={selectedCall.result} />
                </div>
                {selectedCall.error && (
                  <div>
                    <div className="text-[10px] font-mono text-[#FF4D4D] mb-1">
                      ERROR
                    </div>
                    <div className="text-xs text-[#FF4D4D]">
                      {selectedCall.error}
                    </div>
                  </div>
                )}

                {(violationAtStep.get(selectedCall.step) ?? []).map((v, i) => (
                  <div
                    key={i}
                    className="rounded border border-[#FF4D4D]/40 bg-[#FF4D4D]/10 p-3"
                  >
                    <div className="text-[10px] font-mono font-bold text-[#FF4D4D] mb-1.5">
                      ⚠ WHY THIS FAILED
                    </div>
                    <div className="text-xs text-[#E8ECF1] leading-relaxed">
                      {clean(v.detail)}
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div className="text-xs text-[#A8B2C0]">
                Select a tool call in the timeline to inspect its arguments and
                result.
              </div>
            )}

            <div className="pt-3 border-t border-[#232A32]">
              <div className="text-[10px] font-mono text-[#A8B2C0] mb-1">
                FINAL WORLD STATE
              </div>
              <Json value={result.trace.final_world_state} />
            </div>

            <div className="flex gap-4 text-[11px] font-mono text-[#A8B2C0] pt-1">
              <span>
                clarification:{" "}
                <span className="text-[#E8ECF1]">
                  {String(result.trace.clarification_asked)}
                </span>
              </span>
              <span>
                completed:{" "}
                <span
                  className={
                    result.trace.completed ? "text-[#2ECC71]" : "text-[#FF4D4D]"
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
