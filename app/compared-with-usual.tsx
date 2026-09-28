"use client";
import { useMemo } from "react";
import { Thermometer } from "lucide-react";
import { STANDARD_GLUCOSE_RANGES, type CgmReading, type Entry } from "@/lib/care";
import { formatGlucose, glucoseIn, glucoseWithUnit, type GlucoseUnit } from "@/lib/glucose-units";
import {
  comparedWithUsual,
  usualNudge,
  USUAL_WEEKS,
  type Comparison,
  type Unavailable,
} from "@/lib/usual";

const fmt = (value: number) => String(Math.round(value * 10) / 10);

/** "20% lower than", "12% higher than" or "the same as": which way, never whether it's good. */
function direction(change: number | null) {
  if (change === null) return null;
  return change === 0
    ? "the same as"
    : `${Math.abs(change)}% ${change > 0 ? "higher" : "lower"} than`;
}

function ComparisonTile({
  title,
  against,
  value,
  unit,
}: {
  title: string;
  against: string;
  value: Comparison | Unavailable;
  unit: GlucoseUnit;
}) {
  if ("unavailable" in value)
    return (
      <div>
        <dt>{title}</dt>
        <dd>—</dd>
        <small>{value.unavailable}</small>
      </div>
    );
  const { current, usual, meanChangePercent } = value;
  const moved = direction(meanChangePercent);
  const { low, high } = STANDARD_GLUCOSE_RANGES;
  return (
    <div>
      <dt>{title}</dt>
      <dd>{current.mean === null ? "Average hidden" : glucoseWithUnit(current.mean, unit)}</dd>
      <small>
        {current.mean !== null && usual.mean !== null && moved
          ? `Average ${moved} ${against} (${formatGlucose(usual.mean, unit)}).`
          : `Compared with ${against}; ${current.mean === null ? "this" : "the usual"} average is hidden because too many readings were past the sensor’s limit, so it would read low.`}{" "}
        In range {formatGlucose(low, unit)}–{formatGlucose(high, unit)}: {fmt(current.inRange)}% vs{" "}
        {fmt(usual.inRange)}%. Below {formatGlucose(low, unit)}: {fmt(current.below70)}% vs{" "}
        {fmt(usual.below70)}%.
      </small>
    </div>
  );
}

export default function ComparedWithUsual({
  entries,
  cgm,
  timezone,
  now,
  changePercent,
  sickNow,
  onLogIllness,
  unit,
}: {
  entries: Entry[];
  cgm: CgmReading[];
  timezone: string;
  now: number;
  /** The care plan's "Point out a change from usual" percent; no prompt without it. */
  changePercent: number | undefined;
  /** A sick period is already open, so the prompt doesn't offer to log one. */
  sickNow: boolean;
  /** Opens a new illness period; absent when this account can't log. */
  onLogIllness?: () => void;
  unit: GlucoseUnit;
}) {
  const summary = useMemo(
    () => comparedWithUsual({ cgm, entries, timezone, now }),
    [cgm, entries, timezone, now],
  );
  const nudge = usualNudge(summary, changePercent);
  const todayDays = "unavailable" in summary.today ? 0 : summary.today.usual.days;
  return (
    <section className="insights-panel insights-usual" aria-labelledby="insights-usual-heading">
      <div className="insights-panel-title">
        <div>
          <span className="insights-eyebrow">HOW IT COMPARES</span>
          <h3 id="insights-usual-heading">Compared with usual</h3>
        </div>
      </div>
      {nudge && (
        <div className="notice insights-usual-nudge" role="status">
          <p>
            Glucose averaged {nudge.percent}% {nudge.direction} over the last week than the{" "}
            {USUAL_WEEKS} weeks before. Anything going on, such as illness, a new routine or a
            change in the care plan? Review changes with your care team.
          </p>
          {onLogIllness && !sickNow && (
            <div className="insights-usual-actions">
              <button type="button" className="button outline" onClick={onLogIllness}>
                <Thermometer size={16} aria-hidden="true" /> Log a sick period
              </button>
            </div>
          )}
        </div>
      )}
      <dl className="insights-usual-grid">
        <ComparisonTile
          title="Today so far"
          against={`the same hours on the last ${todayDays} days`}
          value={summary.today}
          unit={unit}
        />
        <ComparisonTile
          title="Last 7 days"
          against={`the ${USUAL_WEEKS} weeks before`}
          value={summary.week}
          unit={unit}
        />
      </dl>
      {summary.dayparts && (
        <ul
          className="insights-usual-parts"
          aria-label="Average by time of day, last 7 days vs usual"
        >
          {summary.dayparts.map((part) => {
            const current = part.current === null ? null : glucoseIn(part.current, unit);
            const usual = part.usual === null ? null : glucoseIn(part.usual, unit);
            return (
              <li key={part.label}>
                <span>{part.label}</span>
                <strong>{part.current === null ? "—" : formatGlucose(part.current, unit)}</strong>
                <small>
                  vs {part.usual === null ? "—" : formatGlucose(part.usual, unit)}
                  {current !== null && usual !== null && current !== usual
                    ? ` · ${current > usual ? "higher" : "lower"}`
                    : ""}
                </small>
              </li>
            );
          })}
        </ul>
      )}
      {summary.logged && (
        <p className="insights-small">
          Logged per day, last 7 days vs usual: carbs {fmt(summary.logged.current.carbs)} g vs{" "}
          {fmt(summary.logged.usual.carbs)} g · rapid-acting {fmt(summary.logged.current.rapid)} u
          vs {fmt(summary.logged.usual.rapid)} u · long-acting {fmt(summary.logged.current.long)} u
          vs {fmt(summary.logged.usual.long)} u. Counts only days with something logged.
        </p>
      )}
      <p className="insights-small">
        Which way glucose moved compared with the person’s own recent days, not whether that’s good
        or what to do. Days count only when the CGM recorded most of the hours compared.
        {changePercent === undefined
          ? " To be asked about bigger changes, set “Point out a change from usual” in the care plan."
          : ""}
      </p>
    </section>
  );
}
