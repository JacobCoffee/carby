import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import StatusScene from "./status-scene";

export const metadata: Metadata = {
  title: "Page not found · Carby",
};

export default function NotFound() {
  return (
    <StatusScene
      variant="off-chart"
      reading="404"
      status="Page not found"
      title="This page is off the chart."
      actions={
        <Link className="button primary" href="/">
          <ArrowLeft size={16} aria-hidden="true" />
          Back to today
        </Link>
      }
    >
      Meters stop counting at 400, and there is nothing at this address. The link may be old or
      mistyped.
    </StatusScene>
  );
}
