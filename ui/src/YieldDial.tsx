import { useEffect, useState } from "react";

const PRESSURE_LABEL = [
  "Neutral",
  "Frustration",
  "Anger",
  "Authority",
  "Urgency",
];

const CX = 128;
const CY = 124;
const R = 92;
const SPAN = 132; // degrees either side of vertical

const angleAt = (p: number) => -SPAN + (p * (SPAN * 2)) / 4;

function polar(angleDeg: number, radius: number) {
  const t = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CX + radius * Math.cos(t), y: CY + radius * Math.sin(t) };
}

function arc(from: number, to: number, radius: number) {
  const a = polar(from, radius);
  const b = polar(to, radius);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  return `M${a.x},${a.y} A${radius},${radius} 0 ${large} 1 ${b.x},${b.y}`;
}

export default function YieldDial({
  yieldPoint,
  safetyRate,
}: {
  yieldPoint: number | null;
  safetyRate: number;
}) {
  const target = yieldPoint === null ? 4 : yieldPoint;
  const [needle, setNeedle] = useState(-SPAN);

  useEffect(() => {
    const t = setTimeout(() => setNeedle(angleAt(target)), 420);
    return () => clearTimeout(t);
  }, [target]);

  const held = yieldPoint === null;
  const tone = held ? "var(--hold)" : "var(--yield)";
  const tip = polar(needle, R - 16);

  return (
    <div className="flex items-center gap-6 flex-wrap">
      <svg viewBox="0 0 256 172" className="w-[236px] shrink-0 overflow-visible">
        <defs>
          <filter id="dial-bloom" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Track */}
        <path
          d={arc(-SPAN, SPAN, R)}
          fill="none"
          stroke="var(--line)"
          strokeWidth="10"
          strokeLinecap="round"
        />

        {/* Held region */}
        <path
          d={arc(-SPAN, angleAt(target), R)}
          fill="none"
          stroke="var(--hold)"
          strokeWidth="10"
          strokeLinecap="round"
          opacity="0.85"
          filter="url(#dial-bloom)"
          style={{
            strokeDasharray: 620,
            strokeDashoffset: 620,
            animation: "trace-draw 1.1s cubic-bezier(.4,0,.2,1) .35s both",
          }}
        />

        {/* Yielded region */}
        {!held && (
          <path
            d={arc(angleAt(target), SPAN, R)}
            fill="none"
            stroke="var(--yield)"
            strokeWidth="10"
            strokeLinecap="round"
            filter="url(#dial-bloom)"
            style={{
              strokeDasharray: 620,
              strokeDashoffset: 620,
              animation: "trace-draw 1.1s cubic-bezier(.4,0,.2,1) .9s both",
            }}
          />
        )}

        {/* Ticks */}
        {[0, 1, 2, 3, 4].map((p) => {
          const a = angleAt(p);
          const o = polar(a, R + 12);
          const i = polar(a, R + 6);
          return (
            <g key={p}>
              <line
                x1={i.x}
                y1={i.y}
                x2={o.x}
                y2={o.y}
                stroke={p <= target ? "var(--text-dim)" : "var(--text-faint)"}
                strokeWidth="1.5"
              />
              <text
                x={polar(a, R + 24).x}
                y={polar(a, R + 24).y + 3}
                textAnchor="middle"
                className="font-mono"
                fontSize="10"
                fill={p === target ? tone : "var(--text-faint)"}
              >
                P{p}
              </text>
            </g>
          );
        })}

        {/* Needle */}
        <line
          x1={CX}
          y1={CY}
          x2={tip.x}
          y2={tip.y}
          stroke={tone}
          strokeWidth="2.5"
          strokeLinecap="round"
          filter="url(#dial-bloom)"
          style={{ transition: "all 1.1s cubic-bezier(.34,1.4,.5,1)" }}
        />
        <circle cx={CX} cy={CY} r="6" fill="var(--void)" stroke={tone} strokeWidth="2" />
        <circle cx={CX} cy={CY} r="2" fill={tone} className="throb" />

        {/* Readout */}
        <text
          x={CX}
          y={CY - 24}
          textAnchor="middle"
          fontSize="40"
          fontWeight="600"
          fill={tone}
          className="tabular"
        >
          {held ? "—" : `P${yieldPoint}`}
        </text>
      </svg>

      <div className="min-w-0">
        <div className="eyebrow">Yield point</div>
        <div className="mt-1.5 text-[15px] font-medium text-[var(--text)]">
          {held ? "No yield detected" : PRESSURE_LABEL[target]}
        </div>
        <p className="mt-2 text-xs text-[var(--text-dim)] leading-relaxed max-w-[260px]">
          {held ? (
            <>
              The agent held its policy at every pressure level tested. Safety
              rate {Math.round(safetyRate * 100)}%.
            </>
          ) : (
            <>
              The lowest user pressure at which this agent commits a safety
              violation. It behaves correctly below this point and cannot be
              relied on above it.
            </>
          )}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <span
            className="w-1.5 h-1.5 rounded-full blink"
            style={{ background: tone }}
          />
          <span className="font-mono text-[10px] tracking-widest uppercase text-[var(--text-faint)]">
            {held ? "specimen intact" : "specimen yielded"}
          </span>
        </div>
      </div>
    </div>
  );
}
