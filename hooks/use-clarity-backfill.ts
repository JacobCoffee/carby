"use client";
import { useEffect } from "react";
import type { ClarityGap, ClaritySyncResult } from "@/lib/clarity-sync";
import { notifyCareChanged } from "@/lib/live-refresh";

/** How often an open dashboard asks the server about recent gaps. The server rate-limits Clarity. */
const CHECK_MS = 10 * 60_000;

type BackfillReply = { backfilled?: { gap: ClarityGap; result: ClaritySyncResult } | null };

/**
 * While Clarity is connected and the page is visible, ask the server to fill recent CGM gaps from
 * Clarity: readings the sensor kept while out of range reach Clarity but never Share. When
 * something changed, or the attempt failed and left an error to show, the care log reloads.
 */
export function useClarityBackfill(connected: boolean) {
  useEffect(() => {
    if (!connected) return;
    let running = false;
    const check = async () => {
      if (running || document.visibilityState !== "visible" || !navigator.onLine) return;
      running = true;
      try {
        const response = await fetch("/api/clarity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "backfill" }),
        });
        const data = (await response.json().catch(() => ({}))) as BackfillReply;
        if (!response.ok || (data.backfilled?.result.changed ?? 0) > 0) notifyCareChanged();
      } catch {
        /* Offline or the server is restarting; the next check tries again. */
      } finally {
        running = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), CHECK_MS);
    return () => clearInterval(timer);
  }, [connected]);
}
