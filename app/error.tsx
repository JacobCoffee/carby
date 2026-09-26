"use client";

import Link from "next/link";
import { ArrowLeft, RotateCcw } from "lucide-react";
import StatusScene from "./status-scene";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <>
      <title>Something went wrong · Carby</title>
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
        Something broke while loading this part of Carby. Entries you already saved are safe. When a
        sensor drops out you check again, so try once more.
      </StatusScene>
    </>
  );
}
