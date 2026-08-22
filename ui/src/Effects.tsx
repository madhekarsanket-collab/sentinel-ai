import { useEffect, useRef, useState } from "react";
import type { ReactNode, CSSProperties } from "react";

/**
 * Writes the pointer position into CSS custom properties on <html> so any
 * element can react to it without re-rendering React on every mousemove.
 */
export function useGlobalPointer() {
  useEffect(() => {
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        document.documentElement.style.setProperty("--px", `${e.clientX}px`);
        document.documentElement.style.setProperty("--py", `${e.clientY}px`);
        frame = 0;
      });
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, []);
}

/** Ambient light that follows the cursor across the whole rig. */
export function Spotlight() {
  return <div className="spotlight" aria-hidden />;
}

/**
 * A panel whose border and surface brighten around the cursor. Tracks pointer
 * position locally so the highlight is anchored to the card, not the viewport.
 */
export function GlowCard({
  children,
  className = "",
  style,
  delay = 0,
  onClick,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  delay?: number;
  onClick?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  }

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerEnter={() => setActive(true)}
      onPointerLeave={() => setActive(false)}
      onClick={onClick}
      className={`glow-card rise ${active ? "is-live" : ""} ${className}`}
      style={{ animationDelay: `${delay}ms`, ...style }}
    >
      <span className="glow-card__edge" aria-hidden />
      <span className="glow-card__wash" aria-hidden />
      <div className="relative z-[1] h-full">{children}</div>
    </div>
  );
}
