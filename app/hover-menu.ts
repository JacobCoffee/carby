"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createHoverIntent } from "@/lib/hover-intent";

const isMouse = (event: PointerEvent) => event.pointerType === "mouse";

/**
 * A dropdown that opens when a mouse rests on its trigger and closes shortly after the mouse
 * leaves both the trigger and the menu. Touch and pen keep tap-to-open, and the keyboard keeps
 * Radix's own handling. Spread `root` on `DropdownMenu`, `trigger` on the trigger element,
 * `content` on `DropdownMenuContent` and `sub` on any `DropdownMenuSubContent`.
 */
export function useHoverMenu() {
  const [open, setOpen] = useState(false);
  // Set when the pointer, not a click or key, last moved the menu: focus then stays put on close.
  const byHover = useRef(false);
  const [intent] = useState(() => createHoverIntent(setOpen, { openDelay: 70, closeDelay: 220 }));
  useEffect(() => intent.cancel, [intent]);
  const enter = (event: PointerEvent) => {
    if (!isMouse(event)) return;
    byHover.current = true;
    intent.enter();
  };
  const leave = (event: PointerEvent) => {
    if (!isMouse(event)) return;
    byHover.current = true;
    intent.leave();
  };
  return {
    open,
    root: {
      open,
      // Non-modal, so the page under the menu keeps its pointer events and leaving can close it.
      modal: false,
      onOpenChange: (next: boolean) => {
        intent.cancel();
        byHover.current = false;
        setOpen(next);
      },
    },
    trigger: {
      onPointerEnter: enter,
      onPointerLeave: leave,
      // A click on a trigger the hover already opened would toggle it shut; keep it open instead.
      onPointerDown: (event: PointerEvent) => {
        if (isMouse(event) && open) event.preventDefault();
      },
    },
    content: {
      onPointerEnter: enter,
      onPointerLeave: leave,
      onCloseAutoFocus: (event: Event) => {
        if (byHover.current) event.preventDefault();
      },
    },
    // Submenus portal out of the menu; resting on one must count as resting on the menu.
    sub: { onPointerEnter: enter, onPointerLeave: leave },
  };
}
