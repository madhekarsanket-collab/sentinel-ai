import scorecard from "./fixtures/scorecard.json";

// ---------------------------------------------------------------------------
// Types — mirror harness/models.py
// ---------------------------------------------------------------------------

type Violation = {
  type: string;
  detail: string;
  tool_call_step: number | null;
  is_safety_violation: boolean;
};

type ToolCall = {
  step: number;
  tool_name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  error: string | null;
};

type AgentMessage = { step: number; text: string };

type Trace = {
  scenario_id: string;
  agent_version: string;
  tool_calls: ToolCall[];
  agent_messages: AgentMessage[];
  final_world_state: Record<string, unknown>;
  clarification_asked: boolean;
  completed: boolean;
};

type Result = {
  scenario_id: string;
  ladder_id: string;
  category: string;
  pressure: number;
  task_success: boolean;
  safe: boolean;
  violations: Violation[];
  trace: Trace;
};

type Scorecard = {
  agent_name: string;
  agent_version: string;
  run_id: string;
  results: Result[];
};

const data = scorecard as Scorecard;

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

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

// Text mangled by an encoding round-trip upstream; strip it for display.
function clean(s: string) {
  return s
    .replace(/â€"/g, "—")
    .replace(/â€™/g, "'")
    .replace(/\u202f|\u2011/g, (m) => (m === "\u2011" ? "-" : " "));
}

// ---------------------------------------------------------------------------
// Derived metrics
// ---------------------------------------------------------------------------

type Ladder = {
  ladder_id: string;
  category: string;
  rungs: (Result | undefined)[]; // index = pressure 0..4
  breakingPressure: number | null;
};

function buildLadders(results: Result[]): Ladder[] {
  const map = new Map<string, Result[]>();
  for (const r of results) {
    if (!map.has(r.ladder_id)) map.set(r.ladder_id, []);
    map.get(r.ladder_id)!.push(r);
  }
  return [...map.entries()].map(([ladder_id, rs]) => {
    const rungs: (Result | undefined)[] = [0, 1, 2, 3, 4].map((p) =>
      rs.find((r) => r.pressure === p)
    );
    const firstUnsafe = rungs.find((r) => r && !r.safe);
    return {
      ladder_id,
      category: rs[0].category,
      rungs,
      breakingPressure: firstUnsafe ? firstUnsafe.pressure : null,
    };
  });
}

const ladders = buildLadders(data.results);

const breakingPressure = (() => {
  const breaks = ladders
    .map((l) => l.breakingPressure)
    .filter((p): p is number => p !== null);
  return breaks.length ? Math.min(...breaks) : null;
})();

const safetyRate = data.results.filter((r) => r.safe).length / data.results.length;
const taskRate = data.results.filter((r) => r.task_success).length / data.results.length;

const violationCounts = (() => {
  const c = new Map<string, number>();
  for (const r of data.results)
    for (const v of r.violations) c.set(v.type, (c.get(v.type) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]);
})();

const maxViolation = Math.max(...violationCounts.map(([, n]) => n), 1);

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "bad" | "good" | "warn";
}) {
  const color =
    tone === "bad"
      ? "text-[#FF4D4D]"
      : tone === "good"
      ? "text-[#2ECC71]"
      : tone === "warn"
      ? "text-[#FFB020]"
      : "text-[#E8ECF1]";
  return (
    <div className="flex-1 border border-[#232A32] bg-[#14181D] rounded-md p-4">
      <div className="text-[10px] tracking-widest text-[#A8B2C0] uppercase font-mono">
        {label}
      </div>
      <div className={`mt-2 text-4xl font-bold ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-[#A8B2C0]">{sub}</div>}
    </div>
  );
}

function LadderGrid() {
  return (
    <div className="border border-[#232A32] bg-[#14181D] rounded-md">
      <div className="px-4 py-3 border-b border-[#232A32] flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-wide">PRESSURE LADDER</h2>
        <span className="text-[11px] text-[#A8B2C0] font-mono">
          identical task, escalating tone
        </span>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-[minmax(200px,1fr)_repeat(5,72px)_110px] gap-2 mb-3">
          <div />
          {PRESSURE_LABEL.map((label, i) => (
            <div key={i} className="text-center">
              <div className="text-sm font-mono text-[#E8ECF1]">P{i}</div>
              <div className="text-[9px] text-[#A8B2C0] leading-tight mt-0.5">
                {label}
              </div>
            </div>
          ))}
          <div className="text-[10px] text-[#A8B2C0] uppercase tracking-wider text-right self-end">
            Breaks at
          </div>
        </div>

        {ladders.map((l) => (
          <div
            key={l.ladder_id}
            className="grid grid-cols-[minmax(200px,1fr)_repeat(5,72px)_110px] gap-2 items-center mb-2"
          >
            <div className="text-sm text-[#E8ECF1] truncate pr-2">
              {CATEGORY_LABEL[l.category] ?? l.category}
            </div>

            {l.rungs.map((r, i) => {
              if (!r)
                return (
                  <div
                    key={i}
                    className="h-11 rounded border border-[#232A32] bg-[#0B0D10]"
                  />
                );
              const unsafe = !r.safe;
              return (
                <div
                  key={i}
                  title={
                    unsafe
                      ? r.violations.map((v) => VIOLATION_LABEL[v.type]).join(", ")
                      : "Safe"
                  }
                  className={`h-11 rounded border flex items-center justify-center text-xs font-mono cursor-default ${
                    unsafe
                      ? "border-[#FF4D4D] bg-[#FF4D4D]/15 text-[#FF4D4D]"
                      : "border-[#2ECC71]/50 bg-[#2ECC71]/10 text-[#2ECC71]"
                  }`}
                >
                  {unsafe ? "FAIL" : "SAFE"}
                </div>
              );
            })}

            <div className="text-right text-sm font-mono">
              {l.breakingPressure === null ? (
                <span className="text-[#2ECC71]">held</span>
              ) : (
                <span className="text-[#FF4D4D]">P{l.breakingPressure}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ViolationChart() {
  return (
    <div className="border border-[#232A32] bg-[#14181D] rounded-md">
      <div className="px-4 py-3 border-b border-[#232A32]">
        <h2 className="text-sm font-semibold tracking-wide">VIOLATIONS BY TYPE</h2>
      </div>
      <div className="p-4 space-y-2">
        {violationCounts.map(([type, n]) => (
          <div key={type} className="flex items-center gap-3">
            <div className="w-44 text-xs text-[#A8B2C0] text-right shrink-0">
              {VIOLATION_LABEL[type] ?? type}
            </div>
            <div className="flex-1 h-5 bg-[#0B0D10] rounded-sm overflow-hidden">
              <div
                className="h-full bg-[#FF4D4D]/70"
                style={{ width: `${(n / maxViolation) * 100}%` }}
              />
            </div>
            <div className="w-6 text-xs font-mono text-[#E8ECF1]">{n}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultsTable() {
  const sorted = [...data.results].sort(
    (a, b) =>
      a.ladder_id.localeCompare(b.ladder_id) || a.pressure - b.pressure
  );
  return (
    <div className="border border-[#232A32] bg-[#14181D] rounded-md">
      <div className="px-4 py-3 border-b border-[#232A32]">
        <h2 className="text-sm font-semibold tracking-wide">SCENARIO RESULTS</h2>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-[#A8B2C0] border-b border-[#232A32]">
            <th className="text-left font-medium px-4 py-2">Safety</th>
            <th className="text-left font-medium px-4 py-2">Task</th>
            <th className="text-left font-medium px-4 py-2">Category</th>
            <th className="text-left font-medium px-4 py-2">Pressure</th>
            <th className="text-left font-medium px-4 py-2">Violations</th>
            <th className="text-left font-medium px-4 py-2">Steps</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={r.scenario_id}
              className="border-b border-[#232A32]/60 hover:bg-[#0B0D10]/60"
            >
              <td className="px-4 py-2">
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                    r.safe
                      ? "bg-[#2ECC71]/15 text-[#2ECC71]"
                      : "bg-[#FF4D4D] text-[#0B0D10]"
                  }`}
                >
                  {r.safe ? "SAFE" : "UNSAFE"}
                </span>
              </td>
              <td className="px-4 py-2 font-mono text-xs">
                {r.task_success ? (
                  <span className="text-[#2ECC71]">pass</span>
                ) : (
                  <span className="text-[#A8B2C0]">miss</span>
                )}
              </td>
              <td className="px-4 py-2 text-[#E8ECF1]">
                {CATEGORY_LABEL[r.category] ?? r.category}
              </td>
              <td className="px-4 py-2 font-mono text-xs text-[#A8B2C0]">
                P{r.pressure}
              </td>
              <td className="px-4 py-2">
                {r.violations.length === 0 ? (
                  <span className="text-[#A8B2C0]">—</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {r.violations.map((v, i) => (
                      <span
                        key={i}
                        title={clean(v.detail)}
                        className="px-1.5 py-0.5 rounded text-[10px] bg-[#FF4D4D]/15 text-[#FF4D4D] border border-[#FF4D4D]/30"
                      >
                        {VIOLATION_LABEL[v.type] ?? v.type}
                      </span>
                    ))}
                  </div>
                )}
              </td>
              <td className="px-4 py-2 font-mono text-xs text-[#A8B2C0]">
                {r.trace.tool_calls.length}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function App() {
  return (
    <div className="min-h-screen bg-[#0B0D10] text-[#E8ECF1]">
      <div className="flex">
        {/* Sidebar */}
        <aside className="w-[200px] shrink-0 border-r border-[#232A32] min-h-screen p-4">
          <div className="text-[#7C5CFF] font-bold tracking-tight">SENTINEL.AI</div>
          <div className="text-[10px] text-[#A8B2C0] font-mono mt-0.5">
            Agent Reliability Engine
          </div>
          <nav className="mt-8 space-y-1 text-sm">
            {["Agents", "Test Runs", "Reports", "Attack Library"].map((n) => (
              <div
                key={n}
                className={`px-2 py-1.5 rounded ${
                  n === "Reports"
                    ? "bg-[#14181D] text-[#E8ECF1]"
                    : "text-[#A8B2C0] hover:text-[#E8ECF1]"
                }`}
              >
                {n}
              </div>
            ))}
          </nav>
        </aside>

        {/* Main */}
        <main className="flex-1 p-6 space-y-4 max-w-[1400px]">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-bold">{data.agent_name}</h1>
            <span className="px-2 py-0.5 rounded bg-[#14181D] border border-[#232A32] text-[11px] font-mono text-[#A8B2C0]">
              {data.run_id}
            </span>
            <span className="text-[11px] font-mono text-[#A8B2C0]">
              {data.agent_version}
            </span>
          </div>

          <div className="flex gap-3">
            <StatCard
              label="Breaking Pressure"
              value={breakingPressure === null ? "—" : `P${breakingPressure}`}
              sub={
                breakingPressure === null
                  ? "held at every level"
                  : PRESSURE_LABEL[breakingPressure]
              }
              tone={breakingPressure === null ? "good" : "bad"}
            />
            <StatCard
              label="Safety Rate"
              value={`${Math.round(safetyRate * 100)}%`}
              sub={`${data.results.filter((r) => !r.safe).length} unsafe runs`}
              tone={safetyRate < 0.7 ? "bad" : "good"}
            />
            <StatCard
              label="Task Success"
              value={`${Math.round(taskRate * 100)}%`}
              sub="end-state match"
              tone={taskRate < 0.7 ? "warn" : "good"}
            />
            <StatCard
              label="Scenarios Run"
              value={String(data.results.length)}
              sub={`${ladders.length} ladders × 5 levels`}
            />
          </div>

          <LadderGrid />
          <ViolationChart />
          <ResultsTable />
        </main>
      </div>
    </div>
  );
}
