"use client";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { BookOpen, Copy } from "lucide-react";
import { dateKey, type CgmReading, type Entry, type Plan } from "@/lib/care";
import { glucoseUnitOf } from "@/lib/glucose-units";
import { periodKindLabels, type IllnessWindow } from "@/lib/illness";
import {
  LOGBOOK_SLOTS,
  buildLogbook,
  logbookCallIn,
  logbookCellLabel,
  type LogbookDay,
} from "@/lib/logbook";
import { buildPatternFlags, patternFlagLabel } from "@/lib/patterns";
import "./clinic-features.css";

const RANGE_OPTIONS = [7, 14] as const;

/** Date-string arithmetic (not millisecond arithmetic) so a day boundary never shifts across DST. */
function adjacentDay(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function dayLabel(day: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
}

/** The clinic logbook: pre-meal glucose by day and Breakfast/Lunch/Dinner/Bedtime slot,
 * with clinic pattern runs highlighted and a plain-text summary to read on a call. */
export default function Logbook({
  entries,
  cgm,
  plan,
  illnesses = [],
  now,
}: {
  entries: Entry[];
  cgm: CgmReading[];
  plan: Plan;
  illnesses?: IllnessWindow[];
  now: number;
}) {
  const [range, setRange] = useState<(typeof RANGE_OPTIONS)[number]>(7);
  const days = useMemo(() => {
    const today = dateKey(new Date(now), plan.timezone);
    const list: string[] = [];
    for (let i = range - 1; i >= 0; i--) list.push(adjacentDay(today, -i));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, plan.timezone, range]);
  const logbookDays = useMemo(
    () => buildLogbook({ days, entries, cgm, timezone: plan.timezone, illnesses, now }),
    [days, entries, cgm, plan.timezone, illnesses, now],
  );
  const flags = useMemo(
    () =>
      buildPatternFlags({
        entries,
        cgm,
        timezone: plan.timezone,
        illnesses,
        now,
        lookbackDays: range,
        plan,
      }),
    [entries, cgm, plan, illnesses, now, range],
  );
  async function copyForCallIn() {
    try {
      await navigator.clipboard.writeText(logbookCallIn(logbookDays, plan));
      toast.success("Copied for call-in");
    } catch {
      toast.error("Could not copy. Select and copy the table instead.");
    }
  }
  return (
    <section className="insights-page logbook-page" aria-labelledby="logbook-heading">
      <header className="insights-header care-page-heading">
        <div>
          <span className="insights-eyebrow">
            <BookOpen size={15} aria-hidden="true" /> CLINIC LOGBOOK
          </span>
          <h1 id="logbook-heading">Logbook</h1>
          <p>
            One glucose reading in {glucoseUnitOf(plan)} before each meal and at bedtime, laid out
            the way the clinic reads it. Bring it to appointments or read it out on a call-in.
          </p>
        </div>
        <div className="logbook-actions">
          <div className="insights-period" role="group" aria-label="Logbook range">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={range === option ? "active" : ""}
                aria-pressed={range === option}
                onClick={() => setRange(option)}
              >
                {option} days
              </button>
            ))}
          </div>
          <button
            type="button"
            className="button subtle logbook-copy"
            onClick={() => void copyForCallIn()}
          >
            <Copy size={15} aria-hidden="true" />
            Copy for call-in
          </button>
        </div>
      </header>
      {flags.length > 0 && (
        <ul className="logbook-flags" aria-label="Pattern flags">
          {flags.map((flag, i) => (
            <li key={`${flag.kind}-${flag.slot}-${i}`} className={`logbook-flag is-${flag.kind}`}>
              {patternFlagLabel(flag)}
            </li>
          ))}
        </ul>
      )}
      <div className="insights-panel report-scroll">
        <table className="matrix-table logbook-table">
          <caption className="sr-only">
            Clinic logbook: pre-meal glucose in {glucoseUnitOf(plan)} by day and slot
          </caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              {LOGBOOK_SLOTS.map((slot) => (
                <th scope="col" key={slot}>
                  {slot}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logbookDays.map((day: LogbookDay) => (
              <tr key={day.day} className={day.sick ? "is-sick" : undefined}>
                <th scope="row">
                  {dayLabel(day.day)}
                  {(day.sick || day.periods.length > 0) && (
                    <span className="logbook-period-tags">
                      {day.sick && <span className="insights-illness-chip">Sick</span>}
                      {day.periods.map((period) => (
                        <span key={period} className="insights-illness-chip">
                          {periodKindLabels[period as keyof typeof periodKindLabels] ?? period}
                        </span>
                      ))}
                    </span>
                  )}
                </th>
                {LOGBOOK_SLOTS.map((slot) => {
                  const cell = day.cells[slot];
                  const flag = flags.find(
                    (candidate) => candidate.slot === slot && candidate.days.includes(day.day),
                  );
                  return (
                    <td
                      key={slot}
                      className={`report-meal-cell logbook-cell${flag ? ` is-${flag.kind}` : ""}`}
                    >
                      <strong>{logbookCellLabel(cell, plan)}</strong>
                      {cell?.source === "CGM" && <span>CGM</span>}
                      {cell?.carbs !== undefined && <span>{cell.carbs} g carbs</span>}
                      {cell?.units !== undefined && <span>{cell.units} units</span>}
                      {cell?.ketones && cell.ketones !== "Not checked" && (
                        <span>Ketones {cell.ketones}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
