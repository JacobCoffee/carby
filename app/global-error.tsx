"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCcw } from "lucide-react";
import StatusScene from "./status-scene";
import "./theme.css";
import "./globals.css";

// Replaces the root layout, so the layout's pre-paint theme script never ran. Apply the
// saved Dark/Blood/AMOLED/Sugar choice here; "system" is already handled by theme.css.
function useSavedTheme() {
  useEffect(() => {
    try {
      const pref = localStorage.getItem("carby-theme");
      if (
        pref === "light" ||
        pref === "dark" ||
        pref === "blood" ||
        pref === "amoled" ||
        pref === "sugar"
      ) {
        document.documentElement.dataset.theme = pref;
      }
    } catch {
      /* storage blocked: stay on the system theme */
    }
  }, []);
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useSavedTheme();
  return (
    // useSavedTheme sets data-theme, which the server-rendered markup never has.
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>Something went wrong · Carby</title>
      </head>
      <body className="antialiased">
        <StatusScene
          variant="signal-lost"
          reading="---"
          status="Signal lost"
          title="We lost the signal."
          reference={error.digest}
          actions={
            <>
              <button type="button" className="button primary" onClick={reset}>
                <RotateCcw size={16} aria-hidden="true" />
                Try again
              </button>
              <Link className="button subtle" href="/">
                <ArrowLeft size={16} aria-hidden="true" />
                Back to today
              </Link>
            </>
          }
        >
          Carby could not load. Entries you already saved are safe. When a sensor drops out you
          check again, so try once more.
        </StatusScene>
      </body>
    </html>
  );
}
