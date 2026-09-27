"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";

/**
 * Props for a header that sits behind the page sheet (`.care-sheet` must follow it). Once the
 * sheet has slid up to the bar's top padding, the bar folds to a strip: that padding plus the
 * sheet's rounded edge, which match the covered bar pixel for pixel, so the fold itself doesn't
 * move. Hovering or focusing the strip (CSS) or tapping it (here) brings the whole bar back down.
 */
export function useSheetHeader() {
  const ref = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  // Only moves after the fold animate; the fold itself must not.
  const [animate, setAnimate] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const header = ref.current;
    const sheet = header?.nextElementSibling;
    if (!header || !sheet) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const peek = parseFloat(getComputedStyle(header).paddingTop);
      const folded = sheet.getBoundingClientRect().top <= peek;
      setCollapsed(folded);
      if (!folded) setAnimate(false);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    const onScroll = () => {
      setOpen(false);
      schedule();
    };
    schedule();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  useEffect(() => {
    if (!collapsed) return;
    const frame = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, [collapsed]);

  // A tap opened the bar: a tap anywhere else folds it again.
  useEffect(() => {
    if (!open) return;
    const close = (event: globalThis.PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return {
    ref,
    "data-collapsed": collapsed || undefined,
    "data-animate": (collapsed && animate) || undefined,
    "data-open": (collapsed && open) || undefined,
    // Mice open it by hovering; touch has no hover, so a tap on the strip opens it. This waits
    // for the click: opening on pointerdown slides the bar before the tap's own mouse events
    // arrive, and they would land on whichever tab had moved under the finger.
    onClick: (event: MouseEvent<HTMLElement>) => {
      const native = event.nativeEvent;
      const mouse = "pointerType" in native && native.pointerType === "mouse";
      const onControl = (event.target as Element).closest("a, button, input, select");
      if (collapsed && !open && !mouse && !onControl) setOpen(true);
    },
  };
}
