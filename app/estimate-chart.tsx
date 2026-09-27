"use client";
import type { GlucoseRanges } from "@/lib/care";
import { ESTIMATE_MINUTES, estimateLabel, type GlucoseEstimate } from "@/lib/glucose-estimate";

const W = 440,
  H = 132,
  TOP = 8,
  BOTTOM = 104,
  LEFT = 34,
  RIGHT = W - 8;

/** The next two hours' likely range on its own small axis, so it can run past midnight. */
export function EstimateChart({
  estimate,
  ranges,
  time,
}: {
  estimate: Extract<GlucoseEstimate, { state: "ready" }>;
  ranges: Pick<GlucoseRanges, "low" | "high">;
  time: (at: string) => string;
}) {
  const { points } = estimate;
  const max = Math.min(
    400,
    Math.ceil(Math.max(ranges.high + 40, ...points.map((p) => p.high + 20)) / 50) * 50,
  );
  const min = Math.max(
    40,
    Math.floor(Math.min(ranges.low - 20, ...points.map((p) => p.low - 20)) / 10) * 10,
  );
  const x = (minutes: number) => LEFT + (minutes / ESTIMATE_MINUTES) * (RIGHT - LEFT);
  const y = (value: number) =>
    BOTTOM - ((Math.min(Math.max(value, min), max) - min) / (max - min)) * (BOTTOM - TOP);
  const last = points.at(-1)!;
  const ticks = points.filter((p) => p.minutes % 60 === 0);
  return (
    <svg
      className="estimate-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Likely range: from ${estimateLabel(estimate.value)} now to a median of ${estimateLabel(last.median)} mg/dL by ${time(last.at)}, most likely between ${estimateLabel(last.low)} and ${estimateLabel(last.high)}.`}
    >
      <rect
        className="estimate-chart-range"
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
        className="estimate-chart-band"
        points={[
          ...points.map((p) => `${x(p.minutes)},${y(p.high)}`),
          ...points.toReversed().map((p) => `${x(p.minutes)},${y(p.low)}`),
        ].join(" ")}
      />
      <polyline
        className="estimate-chart-median"
        points={points.map((p) => `${x(p.minutes)},${y(p.median)}`).join(" ")}
      />
      <circle className="estimate-chart-now" cx={LEFT} cy={y(estimate.value)} r="4" />
      {ticks.map((p, i) => (
        <text
          key={p.at}
          x={x(p.minutes)}
          y={H - 8}
          textAnchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}
        >
          {i === 0 ? "Now" : time(p.at)}
        </text>
      ))}
    </svg>
  );
}
