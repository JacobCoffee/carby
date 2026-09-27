"use client";
import type { GlucoseRanges } from "@/lib/care";
import type { AgpValue } from "@/lib/glucose-metrics";
import { ESTIMATE_HOURS, estimateLabel, type SimilarDays } from "@/lib/similar-days";

const W = 440,
  H = 132,
  TOP = 8,
  BOTTOM = 104,
  LEFT = 34,
  RIGHT = W - 8;

/** The similar-days band for the next hours on its own small axis, so it can run past midnight. */
export function SimilarDaysChart({
  estimate,
  ranges,
  time,
}: {
  estimate: Extract<SimilarDays, { state: "ready" }>;
  ranges: Pick<GlucoseRanges, "low" | "high">;
  time: (at: string) => string;
}) {
  const { points } = estimate;
  const from = Date.parse(estimate.at),
    span = ESTIMATE_HOURS * 3600000;
  const highest = Math.max(
    ranges.high + 40,
    ...points.map((p) => (typeof p.p90 === "number" ? p.p90 + 20 : p.p90 === "High" ? 400 : 0)),
  );
  const max = Math.min(400, Math.ceil(highest / 50) * 50);
  const x = (at: string) => LEFT + ((Date.parse(at) - from) / span) * (RIGHT - LEFT);
  const y = (value: number) => BOTTOM - ((Math.min(value, max) - 40) / (max - 40)) * (BOTTOM - TOP);
  const yOf = (value: AgpValue | null) =>
    value === "High" ? y(max) : value === "Low" ? y(40) : y(value ?? 40);
  const ticks = [0, 2, 4, 6].map((h) => new Date(from + h * 3600000).toISOString());
  const last = points.at(-1)!;
  return (
    <svg
      className="similar-days-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`On ${estimate.matched} similar past days, the median went from ${estimateLabel(points[0].p50)} to ${estimateLabel(last.p50)} mg/dL by ${time(last.at)}, with most readings between ${estimateLabel(last.p10)} and ${estimateLabel(last.p90)}.`}
    >
      <rect
        className="similar-days-range"
        x={LEFT}
        width={RIGHT - LEFT}
        y={y(ranges.high)}
        height={y(ranges.low) - y(ranges.high)}
      />
      {[ranges.low, ranges.high].map((value) => (
        <text key={value} x={LEFT - 6} y={y(value) + 4} textAnchor="end">
          {value}
        </text>
      ))}
      <polygon
        className="similar-days-band"
        points={[
          ...points.map((p) => `${x(p.at)},${yOf(p.p90)}`),
          ...points.toReversed().map((p) => `${x(p.at)},${yOf(p.p10)}`),
        ].join(" ")}
      />
      <polyline
        className="similar-days-median"
        points={points.map((p) => `${x(p.at)},${yOf(p.p50)}`).join(" ")}
      />
      <circle className="similar-days-now" cx={LEFT} cy={y(estimate.value)} r="4" />
      {ticks.map((at, i) => (
        <text
          key={at}
          x={x(at)}
          y={H - 8}
          textAnchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}
        >
          {i === 0 ? "Now" : time(at)}
        </text>
      ))}
    </svg>
  );
}
