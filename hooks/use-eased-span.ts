"use client";
import { useEffect, useRef, useState } from "react";

export type Span = { from: number; to: number };

/**
 * A time span that glides to each new target instead of jumping: an ease-out over `ms`, picked up
 * from wherever it is if the target changes mid-way. It snaps when the old and new spans do not
 * overlap (another day, say) and whenever the person prefers reduced motion.
 */
export function useEasedSpan(from: number, to: number, ms = 320): Span {
  const [span, setSpan] = useState<Span>({ from, to });
  const shown = useRef<Span>({ from, to });
  useEffect(() => {
    const start = shown.current;
    if (start.from === from && start.to === to) return;
    const snap =
      to <= start.from ||
      from >= start.to ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Timed from the first frame's own timestamp: a frame can be stamped before this effect ran,
    // and a negative progress would swing the quartic backwards.
    let began = -1;
    let frame = 0;
    const step = (at: number) => {
      if (began < 0) began = at;
      const progress = snap ? 1 : Math.min(1, Math.max(0, (at - began) / ms));
      // Quartic ease-out: quick to respond, settling without overshoot.
      const eased = 1 - (1 - progress) ** 4;
      const next = {
        from: start.from + (from - start.from) * eased,
        to: start.to + (to - start.to) * eased,
      };
      shown.current = next;
      setSpan(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [from, to, ms]);
  return span;
}
