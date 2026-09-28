"use client";
import { memo, useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { Entry, CgmReading, DexcomEvent, Plan } from "@/lib/care";
import {
  mealRatioLabels,
  dateKey,
  fromLocal,
  glucoseRanges,
  entryGlucoseLabel,
  meterStatusLabel,
  STANDARD_GLUCOSE_RANGES,
} from "@/lib/care";
import {
  formatFactor,
  formatGlucose,
  glucoseToMgdl,
  glucoseUnitOf,
  glucoseWithUnit,
  otherGlucoseUnit,
  type GlucoseUnit,
} from "@/lib/glucose-units";
import { summarizeCgm, uniqueCgm } from "@/lib/cgm-metrics";
import { reportRangeIsValid } from "@/lib/report-analysis";
import {
  checkInsBetween,
  eatingLabels,
  fluidsLabels,
  formatTemperature,
  illnessOverlap,
  illnessLabel,
  illnessSymptomLabels,
  isSick,
  periodKind,
  periodKindLabels,
  type IllnessWindow,
} from "@/lib/illness";
import { buildPatternFlags, patternFlagLabel, type PatternFlag } from "@/lib/patterns";
import {
  buildLogbook,
  LOGBOOK_SLOTS,
  logbookCellLabel,
  type LogbookCell,
  type LogbookDay,
} from "@/lib/logbook";
import ReportCgm from "./report-cgm";
import CgmHistory from "./cgm-history";
import "./report-enhancements.css";

type Section = "charts" | "meals" | "insulin" | "overnight" | "notes";
type ReportPlan = Pick<Plan, "meter" | "glucoseUnit">;
/** Dexcom reports HIGH above and LOW below these sensor limits, in mg/dL, without a value. */
const SENSOR_HIGH = 400,
  SENSOR_LOW = 40;
/** The consensus range the report's observed-time figures use, e.g. "70–180 mg/dL". */
function standardRange(unit: GlucoseUnit) {
  const { low, high } = STANDARD_GLUCOSE_RANGES;
  return `${formatGlucose(low, unit)}–${formatGlucose(high, unit)} ${unit}`;
}
/** Chart gridlines in mg/dL: the standard range's edges, then round levels in the unit. */
function gridLevels(unit: GlucoseUnit) {
  const upper = unit === "mmol/L" ? [15, 20] : [300, 400];
  return [
    STANDARD_GLUCOSE_RANGES.low,
    STANDARD_GLUCOSE_RANGES.high,
    ...upper.map((level) => glucoseToMgdl(level, unit)),
  ];
}
const clockFormatters = new Map<
  string,
  { clock: Intl.DateTimeFormat; display: Intl.DateTimeFormat }
>();
function localParts(at: string, timezone: string) {
  let formatters = clockFormatters.get(timezone);
  if (!formatters) {
    formatters = {
      clock: new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }),
      display: new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        minute: "2-digit",
      }),
    };
    clockFormatters.set(timezone, formatters);
  }
  const d = new Date(at),
    pieces = formatters.clock.formatToParts(d);
  return {
    day: dateKey(d, timezone),
    hour: Number(pieces.find((p) => p.type === "hour")?.value),
    minute: Number(pieces.find((p) => p.type === "minute")?.value),
    time: formatters.display.format(d),
  };
}
function csvCell(value: string | number | null | undefined) {
  const raw = String(value ?? "");
  const safe = /^[=+@\t\r-]/.test(raw) ? "'" + raw : raw;
  return '"' + safe.replaceAll('"', '""') + '"';
}
function downloadCsv(
  entries: Entry[],
  cgm: CgmReading[],
  dexcomEvents: DexcomEvent[],
  timezone: string,
  unit: GlucoseUnit,
) {
  const glucose = (mgdl: number | null) => (mgdl === null ? "" : formatGlucose(mgdl, unit));
  const header = [
    "Timestamp (UTC)",
    `Date (${timezone})`,
    `Time (${timezone})`,
    "Category",
    `Glucose (${unit})`,
    "Glucose status",
    "Source",
    "Ketones",
    "Food window",
    "Carbs (g)",
    "Insulin",
    "Units",
    "Dose purpose",
    "Exercise minutes",
    "Exercise intensity",
    "Rescue medication",
    "Logged calculation",
    "Notes",
  ];
  const records = [
    ...entries.map((e) => {
      const p = localParts(e.at, timezone);
      return [
        e.at,
        p.day,
        p.time,
        e.kind,
        glucose(e.glucose),
        e.status ?? "",
        e.source,
        e.ketones,
        e.meal,
        e.carbs,
        e.insulin,
        e.units,
        e.purpose,
        e.minutes,
        e.intensity,
        e.medication,
        calculationLabel(e, unit),
        e.note,
      ];
    }),
    ...uniqueCgm(cgm).map((e) => {
      const p = localParts(e.at, timezone);
      return [
        e.at,
        p.day,
        p.time,
        "Imported CGM",
        glucose(e.value),
        e.status ?? "",
        e.source,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ];
    }),
    ...dexcomEvents.map((e) => {
      const p = localParts(e.at, timezone);
      return [
        e.at,
        p.day,
        p.time,
        "Dexcom " + e.type,
        glucose(e.value),
        "",
        e.source,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        e.details,
      ];
    }),
  ].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const csv = "\uFEFF" + [header, ...records].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "carby-care-log.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function label(e: Entry, plan: ReportPlan) {
  return e.kind === "glucose"
    ? `${entryGlucoseLabel(e, plan)} (${e.source})${e.ketones && e.ketones !== "Not checked" ? ` · ketones ${e.ketones}` : ""}`
    : e.kind === "food"
      ? `${e.meal}: ${e.carbs} g carbs`
      : e.kind === "insulin"
        ? `${e.insulin}: ${e.units} units${e.purpose ? ` · ${e.purpose}` : ""}`
        : e.kind === "exercise"
          ? `Exercise${e.intensity ? ` · ${e.intensity}` : ""}${e.minutes !== null ? ` · ${e.minutes} min` : ""}`
          : e.kind === "correction-skipped"
            ? "Correction skipped · no insulin given"
            : `Rescue medication given${e.medication ? `: ${e.medication}` : ""}`;
}
function calculationLabel(e: Entry, unit: GlucoseUnit) {
  if (e.kind !== "insulin" || !e.calculation) return "";
  const c = e.calculation;
  return `Logged calculation: ${c.mode}; ${c.carbs} g carbs${c.glucose !== null ? `, ${glucoseWithUnit(c.glucose, unit)} (${c.source ?? "source unspecified"})` : ""}; ${c.calculatedUnits} units calculated using target ${glucoseWithUnit(c.target, unit)}, ${c.mode !== "Correction" ? `ratio 1:${c.ratio}${c.ratioMeal ? ` (${mealRatioLabels[c.ratioMeal]})` : ""}, ` : ""}correction factor ${formatFactor(c.factor, unit)} ${unit}/unit.${c.adjustment ? ` Original manual adjustment: ${c.adjustment.actualUnits} units recorded${c.adjustment.reason ? ` (${c.adjustment.reason})` : ""}; acknowledged ${c.adjustment.acknowledgedAt}.` : ""}`;
}
function recordDetails(e: Entry, unit: GlucoseUnit) {
  return [calculationLabel(e, unit), e.note].filter(Boolean).join(" ");
}
/** Part of a day inside an illness period; null ends mean the day's own midnight. */
type SickSpan = { from: string | null; to: string | null };
function DailyChart({
  day,
  entries,
  cgm,
  dexcomEvents,
  timezone,
  plan,
  sickSpans,
}: {
  day: string;
  entries: Entry[];
  cgm: CgmReading[];
  dexcomEvents: DexcomEvent[];
  timezone: string;
  plan: ReportPlan;
  sickSpans: SickSpan[];
}) {
  const unit = glucoseUnitOf(plan);
  const readings = entries.filter((e) => e.kind === "glucose" && e.glucose !== null);
  const statusReadings = entries.filter((e) => e.kind === "glucose" && e.glucose === null);
  const cgms = uniqueCgm(cgm);
  if (!readings.length && !statusReadings.length && !cgms.length && !dexcomEvents.length)
    return null;
  const ymax = Math.max(
    410,
    ...readings.map((e) => (e.glucose ?? 0) + 20),
    ...cgms.map((e) => (e.value ?? 0) + 20),
  );
  const x = (e: { at: string }) => {
    const p = localParts(e.at, timezone);
    return 40 + ((p.hour * 60 + p.minute) / 1440) * 620;
  };
  const y = (n: number) => 161 - (n / ymax) * 132;
  const statusRuns: {
    status: "High" | "Low";
    first: CgmReading;
    last: CgmReading;
    count: number;
  }[] = [];
  for (const [index, reading] of cgms.entries()) {
    if (!reading.status) continue;
    const previous = statusRuns.at(-1),
      previousReading = cgms[index - 1];
    if (
      previous &&
      previous.status === reading.status &&
      previousReading?.status === reading.status &&
      Date.parse(reading.at) - Date.parse(previousReading.at) <= 600000
    ) {
      previous.last = reading;
      previous.count++;
    } else statusRuns.push({ status: reading.status, first: reading, last: reading, count: 1 });
  }
  type TimedEvent = { at: string; text: string };
  const packed = (items: TimedEvent[]) => {
    const groups: { x: number; items: TimedEvent[] }[] = [];
    for (const item of [...items].sort((a, b) => a.at.localeCompare(b.at))) {
      const position = x(item),
        last = groups.at(-1);
      if (
        last &&
        Math.abs(position - last.x) < 9 &&
        Date.parse(item.at) - Date.parse(last.items.at(-1)!.at) <= 20 * 60000
      ) {
        last.items.push(item);
        last.x = last.items.reduce((sum, e) => sum + x(e), 0) / last.items.length;
      } else groups.push({ x: position, items: [item] });
    }
    return groups;
  };
  const food = packed(
    entries
      .filter((e) => e.kind === "food")
      .map((e) => ({
        at: e.at,
        text: `${localParts(e.at, timezone).time}: ${label(e, plan)}${e.note ? ` · ${e.note}` : ""}`,
      })),
  );
  const insulin = packed(
    entries
      .filter((e) => e.kind === "insulin" || e.kind === "correction-skipped")
      .map((e) => ({
        at: e.at,
        text: `${localParts(e.at, timezone).time}: ${label(e, plan)}${e.note ? ` · ${e.note}` : ""}`,
      })),
  );
  const device = packed(
    dexcomEvents.map((e) => ({
      at: e.at,
      text: `${localParts(e.at, timezone).time}: Dexcom ${e.type}${e.value !== null ? ` · ${glucoseWithUnit(e.value, unit)}` : ""}${e.details ? ` · ${e.details}` : ""}`,
    })),
  );
  const notable = packed(
    entries
      .filter((e) => e.kind === "exercise" || e.kind === "rescue")
      .map((e) => ({
        at: e.at,
        text: `${localParts(e.at, timezone).time}: ${label(e, plan)}${e.note ? ` · ${e.note}` : ""}`,
      })),
  );
  return (
    <div className="daily-chart">
      <svg
        viewBox="0 0 700 238"
        role="img"
        aria-label={`${day}: glucose and recorded events over 24 hours`}
      >
        {sickSpans.map((span, i) => {
          const left = span.from ? x({ at: span.from }) : 40,
            right = span.to ? x({ at: span.to }) : 660;
          return (
            <g key={`sick-${i}`}>
              <rect
                x={left}
                y={y(ymax)}
                width={Math.max(2, right - left)}
                height={161 - y(ymax)}
                fill="var(--event-illness-bg)"
              />
              {span.from && (
                <line
                  x1={left}
                  x2={left}
                  y1={y(ymax)}
                  y2="161"
                  stroke="var(--report-illness-ink)"
                  strokeDasharray="3 3"
                />
              )}
              <text
                x={left + 4}
                y={y(ymax) + 11}
                fontSize="10"
                fontWeight="600"
                fill="var(--report-illness-ink)"
              >
                Sick
              </text>
            </g>
          );
        })}
        <rect x="40" y={y(180)} width="620" height={y(70) - y(180)} fill="var(--report-band-bg)" />
        {gridLevels(unit).map((n) => (
          <g key={n}>
            <line x1="40" x2="660" y1={y(n)} y2={y(n)} stroke="var(--report-grid)" />
            <text x="2" y={y(n) + 4} fontSize="12" fill="var(--report-text)">
              {formatGlucose(n, unit)}
            </text>
          </g>
        ))}
        {cgms.flatMap((reading, i) => {
          const previous = cgms[i - 1];
          return previous &&
            reading.value !== null &&
            previous.value !== null &&
            Date.parse(reading.at) - Date.parse(previous.at) <= 600000 &&
            x(reading) > x(previous)
            ? [
                <line
                  key={reading.at}
                  x1={x(previous)}
                  y1={y(previous.value)}
                  x2={x(reading)}
                  y2={y(reading.value)}
                  stroke="var(--report-sensor)"
                  strokeWidth="1.8"
                />,
              ]
            : [];
        })}
        {cgms
          .filter((e) => e.value !== null)
          .map((e) => (
            <circle key={e.at} cx={x(e)} cy={y(e.value!)} r="1.8" fill="var(--report-sensor)">
              <title>
                {localParts(e.at, timezone).time}: {glucoseWithUnit(e.value!, unit)} · {e.source}
              </title>
            </circle>
          ))}
        {statusRuns.map((run, i) => {
          const left = x(run.first),
            right = x(run.last),
            high = run.status === "High";
          return (
            <g key={`${run.first.at}-${i}`}>
              <rect
                x={left - 1}
                y={y(high ? SENSOR_HIGH : SENSOR_LOW) - 3}
                width={Math.max(4, right - left + 2)}
                height="6"
                rx="2"
                fill={high ? "var(--report-status-high)" : "var(--report-status-low)"}
              />
              <title>
                Dexcom {run.status.toUpperCase()} (
                {high
                  ? `above ${glucoseWithUnit(SENSOR_HIGH, unit)}`
                  : `below ${glucoseWithUnit(SENSOR_LOW, unit)}`}
                ) · {localParts(run.first.at, timezone).time}
                {run.first.at !== run.last.at ? `–${localParts(run.last.at, timezone).time}` : ""};
                exact sensor value unknown
              </title>
            </g>
          );
        })}
        {readings.map((e) => (
          <circle
            key={e.id}
            cx={x(e)}
            cy={y(e.glucose!)}
            r="4.4"
            fill={
              e.source === "Finger-stick" ? "var(--report-finger-dot)" : "var(--report-cgm-dot)"
            }
            stroke="var(--report-canvas)"
            strokeWidth="1"
          >
            <title>
              {localParts(e.at, timezone).time}: {glucoseWithUnit(e.glucose!, unit)} · {e.source}
            </title>
          </circle>
        ))}
        {statusReadings.map((e) => {
          const high = e.status === "High";
          return (
            <g key={e.id}>
              <rect
                x={x(e) - 2}
                y={y(high ? SENSOR_HIGH : SENSOR_LOW) - 3}
                width="4"
                height="6"
                rx="1"
                fill={high ? "var(--report-status-high)" : "var(--report-status-low)"}
              />
              <title>
                {localParts(e.at, timezone).time}: {meterStatusLabel(high ? "High" : "Low", plan)}{" "}
                finger-stick · {e.source}
              </title>
            </g>
          );
        })}
        <line x1="40" x2="660" y1="169" y2="169" stroke="var(--report-grid)" />
        {device.map((group, i) => (
          <g key={`device-${i}`}>
            <path
              d={`M ${group.x} 170 l -5 -8 l 5 -8 l 5 8 Z`}
              fill="var(--report-device-marker)"
            />
            <title>{group.items.map((e) => e.text).join("\n")}</title>
            {group.items.length > 1 && (
              <text x={group.x + 7} y="160" fontSize="9" fill="var(--report-device-marker)">
                {group.items.length}
              </text>
            )}
          </g>
        ))}
        {notable.map((group, i) => (
          <g key={`notable-${i}`}>
            <path d={`M ${group.x} 174 l -6 10 l 12 0 Z`} fill="var(--report-insulin-marker)" />
            <title>{group.items.map((e) => e.text).join("\n")}</title>
            {group.items.length > 1 && (
              <text x={group.x + 8} y="185" fontSize="9" fill="var(--report-insulin-marker)">
                {group.items.length}
              </text>
            )}
          </g>
        ))}
        {food.map((group, i) => (
          <g key={`food-${i}`}>
            <line x1={group.x} x2={group.x} y1="174" y2="185" stroke="var(--report-food-marker)" />
            <circle cx={group.x} cy="188" r="4" fill="var(--report-food-marker)" />
            <title>{group.items.map((e) => e.text).join("\n")}</title>
            {group.items.length > 1 && (
              <text x={group.x + 7} y="191" fontSize="9" fill="var(--report-food-marker)">
                {group.items.length}
              </text>
            )}
          </g>
        ))}
        {insulin.map((group, i) => (
          <g key={`insulin-${i}`}>
            <line
              x1={group.x}
              x2={group.x}
              y1="174"
              y2="205"
              stroke="var(--report-insulin-marker)"
            />
            <rect
              x={group.x - 4}
              y="206"
              width="8"
              height="8"
              rx="1"
              fill="var(--report-insulin-marker)"
            />
            <title>{group.items.map((e) => e.text).join("\n")}</title>
            {group.items.length > 1 && (
              <text x={group.x + 7} y="214" fontSize="9" fill="var(--report-insulin-marker)">
                {group.items.length}
              </text>
            )}
          </g>
        ))}
        {[0, 6, 12, 18, 24].map((n) => (
          <text
            key={n}
            x={40 + (n / 24) * 620}
            y="235"
            textAnchor="middle"
            fontSize="12"
            fill="var(--report-text)"
          >
            {n === 0
              ? "12 am"
              : n === 12
                ? "12 pm"
                : n === 24
                  ? "12 am"
                  : n < 12
                    ? `${n} am`
                    : `${n - 12} pm`}
          </text>
        ))}
      </svg>
      {statusRuns.length > 0 && (
        <div className="report-status-runs" aria-label="CGM out of range samples">
          {statusRuns.map((run, i) => (
            <span key={`${run.first.at}-${i}`}>
              <strong>{run.status.toUpperCase()}</strong> {localParts(run.first.at, timezone).time}
              {run.count > 1 ? `–${localParts(run.last.at, timezone).time}` : ""}{" "}
              <small>
                ({run.count} {run.count === 1 ? "sample" : "samples"}; no exact value)
              </small>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
function nextDay(day: string) {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function LogbookMatrixCell({
  cell,
  timezone,
  plan,
  showMeals,
  showInsulin,
  pattern,
}: {
  cell: LogbookCell;
  timezone: string;
  plan: ReportPlan;
  showMeals: boolean;
  showInsulin: boolean;
  pattern?: PatternFlag["kind"];
}) {
  return (
    <td className={`report-meal-cell${pattern ? ` pattern-${pattern}` : ""}`}>
      {cell ? (
        <>
          <strong>
            {logbookCellLabel(cell, plan)}{" "}
            {cell.value !== null && <small>{glucoseUnitOf(plan)}</small>}
          </strong>
          <span>
            {cell.source} · {localParts(cell.at, timezone).time}
          </span>
        </>
      ) : (
        <span className="report-missing">—</span>
      )}
      {showMeals && cell?.carbs !== undefined && <span>{cell.carbs} g carbs logged</span>}
      {showInsulin && cell?.units !== undefined && (
        <span>{cell.units} u Rapid-acting · within 60 min of food</span>
      )}
      {pattern && (
        <span className="report-pattern-mark">
          {pattern === "high" ? "High pattern" : "Low pattern"}
        </span>
      )}
    </td>
  );
}
function DailyMatrix({
  days,
  entries,
  cgm,
  timezone,
  illnesses,
  now,
  showMeals,
  showInsulin,
  showBedtime,
  plan,
  patterns,
}: {
  days: string[];
  entries: Entry[];
  cgm: CgmReading[];
  timezone: string;
  illnesses: IllnessWindow[];
  now: number;
  showMeals: boolean;
  showInsulin: boolean;
  showBedtime: boolean;
  plan: ReportPlan;
  patterns: PatternFlag[];
}) {
  const logbook = buildLogbook({ days, entries, cgm, timezone, illnesses, now });
  const byDay = new Map(logbook.map((d): [string, LogbookDay] => [d.day, d]));
  const visibleSlots = LOGBOOK_SLOTS.filter((slot) => slot !== "Bedtime" || showBedtime);
  return (
    <section className="report-section report-matrix">
      <h3>Daily glucose pattern</h3>
      <p className="report-caption">
        One pre-meal reading per slot: a finger-stick logged in the window, else the nearest CGM
        reading before the slot’s first logged food or rapid-acting dose. “—” means none recorded.
        Outlined readings belong to a pattern listed under Patterns to review.
      </p>
      <div className="report-scroll">
        <table className="matrix-table">
          <caption className="sr-only">
            Glucose, food, and nearby recorded insulin by day and logbook slot
          </caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              {visibleSlots.map((slot) => (
                <th scope="col" key={slot}>
                  {slot}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((day) => {
              const logbookDay = byDay.get(day);
              return (
                <tr key={day} className={logbookDay?.sick ? "report-sick-day" : undefined}>
                  <th scope="row">
                    {new Intl.DateTimeFormat("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                    }).format(new Date(day + "T12:00:00Z"))}
                    {(logbookDay?.sick || !!logbookDay?.periods.length) && (
                      <span className="report-day-badges">
                        {logbookDay.sick && <span className="report-sick-badge">Sick</span>}
                        {logbookDay.periods.map((kind) => (
                          <span key={kind} className="report-sick-badge report-context-badge">
                            {periodKindLabels[kind as keyof typeof periodKindLabels] ?? kind}
                          </span>
                        ))}
                      </span>
                    )}
                  </th>
                  {visibleSlots.map((slot) => (
                    <LogbookMatrixCell
                      key={slot}
                      cell={logbookDay?.cells[slot] ?? null}
                      timezone={timezone}
                      plan={plan}
                      showMeals={showMeals}
                      showInsulin={showInsulin}
                      pattern={
                        patterns.find((flag) => flag.slot === slot && flag.days.includes(day))?.kind
                      }
                    />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
function CoverageBars({
  days,
  cgm,
  timezone,
  today,
  nowAt,
}: {
  days: string[];
  cgm: CgmReading[];
  timezone: string;
  today: string;
  nowAt: string;
}) {
  if (days.length > 30) return null;
  const byDay = days.map((day) => {
    const start = fromLocal(day + "T00:00", timezone),
      end = day === today ? nowAt : fromLocal(nextDay(day) + "T00:00", timezone);
    const summary = summarizeCgm(
      cgm.filter((e) => dateKey(new Date(e.at), timezone) === day),
      start,
      end,
    );
    return { day, ...summary };
  });
  return (
    <section className="report-day-coverage" aria-label="Daily CGM data coverage">
      <div className="report-mini-heading">
        <strong>Data coverage by day</strong>
        <span>Connected CGM intervals only</span>
      </div>
      <div className="report-coverage-grid">
        {byDay.map((item) => (
          <div
            className="report-coverage-day"
            key={item.day}
            title={`${item.day}: ${item.coveragePercent}% coverage; ${item.uniqueReadings} distinct CGM readings`}
          >
            <span>{item.day.slice(5)}</span>
            <div className="report-coverage-track">
              <i style={{ height: `${item.coveragePercent}%` }} />
            </div>
            <strong>{item.coveragePercent}%</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
function NumericPattern({
  days,
  cgm,
  timezone,
  unit,
}: {
  days: string[];
  cgm: CgmReading[];
  timezone: string;
  unit: GlucoseUnit;
}) {
  // One reading per calendar day and clock bin prevents uneven sampling from
  // giving a single day extra weight. Status-only samples have no percentile.
  const bins = new Map<number, Map<string, { at: string; value: number }>>();
  for (const reading of cgm) {
    if (reading.value === null) continue;
    const p = localParts(reading.at, timezone),
      bin = Math.floor((p.hour * 60 + p.minute) / 30);
    const byDay = bins.get(bin) ?? new Map<string, { at: string; value: number }>();
    const previous = byDay.get(p.day);
    if (!previous || previous.at < reading.at)
      byDay.set(p.day, { at: reading.at, value: reading.value });
    bins.set(bin, byDay);
  }
  const minDays = Math.max(7, Math.ceil(days.length / 2));
  const percentile = (sorted: number[], p: number) => {
    const at = (sorted.length - 1) * p,
      lower = Math.floor(at),
      upper = Math.ceil(at);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (at - lower);
  };
  const slots = Array.from({ length: 48 }, (_, bin) => {
    const values = [...(bins.get(bin)?.values() ?? [])].map((e) => e.value).sort((a, b) => a - b);
    return values.length >= minDays
      ? {
          bin,
          count: values.length,
          low: percentile(values, 0.25),
          median: percentile(values, 0.5),
          high: percentile(values, 0.75),
        }
      : null;
  }).filter(
    (slot): slot is { bin: number; count: number; low: number; median: number; high: number } =>
      slot !== null,
  );
  if (slots.length < 4) return null;
  const groups: (typeof slots)[] = [];
  for (const slot of slots) {
    const last = groups.at(-1);
    if (last && last.at(-1)!.bin === slot.bin - 1) last.push(slot);
    else groups.push([slot]);
  }
  const x = (bin: number) => 40 + ((bin + 0.5) / 48) * 620,
    y = (n: number) => 188 - ((n - 40) / 360) * 160;
  return (
    <section className="report-pattern report-section">
      <h3>24-hour numeric pattern</h3>
      <p className="report-caption">
        Exploratory half-hour summary across {days.length} days. Each day contributes at most one
        exact CGM value per half-hour; windows require at least {minDays} days. HIGH/LOW status
        readings lack a number and are excluded, so the pattern can understate extremes.
      </p>
      <svg
        viewBox="0 0 700 221"
        role="img"
        aria-label="Median and middle half of exact CGM values by time of day; missing bins are blank"
      >
        <rect x="40" y={y(180)} width="620" height={y(70) - y(180)} fill="var(--report-band-bg)" />
        {gridLevels(unit).map((n) => (
          <g key={n}>
            <line x1="40" x2="660" y1={y(n)} y2={y(n)} stroke="var(--report-grid)" />
            <text x="2" y={y(n) + 4} fontSize="11" fill="var(--report-text)">
              {formatGlucose(n, unit)}
            </text>
          </g>
        ))}
        {groups.map((group, i) => (
          <g key={i}>
            <polygon
              points={[
                ...group.map((s) => `${x(s.bin)},${y(s.high)}`),
                ...group
                  .slice()
                  .reverse()
                  .map((s) => `${x(s.bin)},${y(s.low)}`),
              ].join(" ")}
              fill="var(--report-pattern-quartile)"
              fillOpacity=".34"
            />
            <polyline
              points={group.map((s) => `${x(s.bin)},${y(s.median)}`).join(" ")}
              fill="none"
              stroke="var(--report-pattern-median)"
              strokeWidth="2.4"
            />
          </g>
        ))}
        {slots.map((s) => (
          <circle key={s.bin} cx={x(s.bin)} cy={y(s.median)} r="5" fill="transparent">
            <title>
              {Math.floor(s.bin / 2)
                .toString()
                .padStart(2, "0")}
              :{s.bin % 2 ? "30" : "00"} · median {formatGlucose(s.median, unit)}, middle half{" "}
              {formatGlucose(s.low, unit)}–{glucoseWithUnit(s.high, unit)} · {s.count} days
            </title>
          </circle>
        ))}
        {[0, 6, 12, 18, 24].map((n) => (
          <text
            key={n}
            x={40 + (n / 24) * 620}
            y="217"
            textAnchor="middle"
            fontSize="12"
            fill="var(--report-text)"
          >
            {n === 0
              ? "12 am"
              : n === 12
                ? "12 pm"
                : n === 24
                  ? "12 am"
                  : n < 12
                    ? `${n} am`
                    : `${n - 12} pm`}
          </text>
        ))}
      </svg>
      <div className="report-pattern-legend">
        <span>
          <i className="median" />
          Median
        </span>
        <span>
          <i className="quartiles" />
          Middle 50% of numeric samples
        </span>
        <span>{slots.length} of 48 time windows have enough data</span>
      </div>
    </section>
  );
}
function ChartKey({ unit }: { unit: GlucoseUnit }) {
  return (
    <div className="report-chart-key" aria-label="Daily chart key">
      <span>
        <i className="key-line manual" />
        Finger-stick
      </span>
      <span>
        <i className="key-line logged-dexcom" />
        Logged Dexcom
      </span>
      <span>
        <i className="key-line imported" />
        Exact CGM
      </span>
      <span>
        <i className="key-range" />
        HIGH at {glucoseWithUnit(SENSOR_HIGH, unit)} threshold, exact value unknown
      </span>
      <span>
        <i className="key-tick food" />● Food
      </span>
      <span>
        <i className="key-tick insulin" />■ Insulin
      </span>
      <span>◆ Dexcom event</span>
      <span>▲ Exercise / rescue medication</span>
      <span>
        <i className="key-sick" />
        Sick period
      </span>
    </div>
  );
}
function DoctorReport({
  entries,
  cgm,
  dexcomEvents,
  timezone,
  patientName,
  illnesses = [],
  plan,
  active = true,
}: {
  entries: Entry[];
  cgm: CgmReading[];
  dexcomEvents: DexcomEvent[];
  timezone: string;
  patientName?: string;
  illnesses?: IllnessWindow[];
  plan: Pick<
    Plan,
    "glucoseRanges" | "lowThreshold" | "patternRule" | "meter" | "glucoseUnit" | "temperatureUnit"
  >;
  /** Whether the Reports view is showing; the long-term record loads only then. */
  active?: boolean;
}) {
  const [range, setRange] = useState("14");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [sections, setSections] = useState<Record<Section, boolean>>({
    charts: true,
    meals: true,
    insulin: true,
    overnight: true,
    notes: true,
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const nowAt = new Date(now).toISOString();
  const today = dateKey(new Date(now), timezone);
  // The care API supplies only the last 45 days, capped at 15,000 CGM and
  // 5,000 event rows. Exclude the partially fetched cutoff day, and exclude
  // the oldest loaded day if a cap may have truncated it.
  const apiCutoff = new Date(now);
  apiCutoff.setUTCDate(apiCutoff.getUTCDate() - 45);
  const apiFirstFullDay = nextDay(dateKey(apiCutoff, timezone));
  const oldestCgm = cgm.reduce<string | null>(
    (at, r) => (at === null || r.at < at ? r.at : at),
    null,
  );
  const oldestEvent = dexcomEvents.reduce<string | null>(
    (at, r) => (at === null || r.at < at ? r.at : at),
    null,
  );
  const earliestAvailableDay = [
    apiFirstFullDay,
    ...(cgm.length >= 15000 && oldestCgm ? [nextDay(dateKey(new Date(oldestCgm), timezone))] : []),
    ...(dexcomEvents.length >= 5000 && oldestEvent
      ? [nextDay(dateKey(new Date(oldestEvent), timezone))]
      : []),
  ]
    .sort()
    .at(-1)!;
  const from = new Date(today + "T12:00:00Z");
  from.setUTCDate(from.getUTCDate() - Number(range) + 1);
  const fromDay = range === "custom" ? start : from.toISOString().slice(0, 10);
  const toDay = range === "custom" ? end : today;
  const valid = reportRangeIsValid(fromDay, toDay, earliestAvailableDay, today);
  const selected = valid
    ? entries
        .filter((e) => {
          const d = dateKey(new Date(e.at), timezone);
          return d >= fromDay && d <= toDay;
        })
        .sort((a, b) => a.at.localeCompare(b.at))
    : [];
  const selectedEvents = valid
    ? dexcomEvents
        .filter((e) => {
          const d = dateKey(new Date(e.at), timezone);
          return d >= fromDay && d <= toDay;
        })
        .sort((a, b) => a.at.localeCompare(b.at))
    : [];
  const selectedCgm = valid
    ? uniqueCgm(
        cgm.filter((e) => {
          const d = dateKey(new Date(e.at), timezone);
          return d >= fromDay && d <= toDay;
        }),
      )
    : [];
  const days: string[] = [];
  if (valid) {
    const d = new Date(fromDay + "T12:00:00Z");
    while (d.toISOString().slice(0, 10) <= toDay) {
      days.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }
  }
  const grouped = <T extends { at: string }>(items: T[]) => {
    const map = new Map<string, T[]>();
    for (const item of items) {
      const day = dateKey(new Date(item.at), timezone);
      const bucket = map.get(day);
      if (bucket) bucket.push(item);
      else map.set(day, [item]);
    }
    return map;
  };
  const entriesByDay = grouped(selected),
    cgmByDay = grouped(selectedCgm),
    eventsByDay = grouped(selectedEvents);
  const activeDaySet = new Set([...entriesByDay.keys(), ...cgmByDay.keys(), ...eventsByDay.keys()]);
  const activeDays = days.filter((day) => activeDaySet.has(day));
  const omitted = days.length - activeDays.length;
  const readings = selected.filter((e) => e.kind === "glucose");
  const food = selected.filter((e) => e.kind === "food");
  const insulin = selected.filter((e) => e.kind === "insulin");
  const startAt = valid ? fromLocal(fromDay + "T00:00", timezone) : nowAt;
  const endAt = valid
    ? toDay === today
      ? nowAt
      : fromLocal(nextDay(toDay) + "T00:00", timezone)
    : startAt;
  const unit = glucoseUnitOf(plan);
  const planRange = glucoseRanges(plan);
  // summarizeCgm's below/in/above figures use the consensus limits, whatever the plan's range.
  const standard = STANDARD_GLUCOSE_RANGES;
  const metrics = summarizeCgm(selectedCgm, startAt, endAt, planRange);
  const sickIllnesses = illnesses.filter(isSick);
  const sickDaySet = new Set(
    days.filter((day) =>
      sickIllnesses.some((illness) =>
        illnessOverlap(
          illness,
          Date.parse(fromLocal(`${day}T00:00`, timezone)),
          Date.parse(fromLocal(`${nextDay(day)}T00:00`, timezone)),
          now,
        ),
      ),
    ),
  );
  const overlappingWindows = valid
    ? illnesses.filter((illness) =>
        illnessOverlap(illness, Date.parse(startAt), Date.parse(endAt), now),
      )
    : [];
  const overlappingIllnesses = overlappingWindows.filter(isSick);
  const overlappingContext = overlappingWindows.filter((w) => !isSick(w));
  const reportCheckIns = valid
    ? overlappingIllnesses
        .flatMap((illness) => checkInsBetween(illness, Date.parse(startAt), Date.parse(endAt)))
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    : [];
  const checkInTime = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const metricsExcludingSick =
    sickDaySet.size > 0
      ? (() => {
          const filtered = selectedCgm.filter(
            (r) => !sickDaySet.has(dateKey(new Date(r.at), timezone)),
          );
          const base = summarizeCgm(filtered, startAt, endAt);
          const possibleMinutes = Math.max(0, base.possibleMinutes - sickDaySet.size * 1440);
          return {
            ...base,
            possibleMinutes,
            coveragePercent:
              possibleMinutes > 0 ? Math.round((base.observedMinutes / possibleMinutes) * 100) : 0,
          };
        })()
      : null;
  const patterns = valid
    ? buildPatternFlags({
        cgm: selectedCgm,
        entries: selected,
        timezone,
        illnesses,
        now: Date.parse(endAt),
        lookbackDays: Math.max(1, days.length),
        plan,
      })
    : [];
  const sharePoints = selectedCgm.filter((e) => e.source === "Dexcom Share").length;
  const clarityPoints = selectedCgm.filter((e) => e.source === "Dexcom Clarity").length;
  const otherPoints = selectedCgm.length - sharePoints - clarityPoints;
  const lowTreatmentCarbs = food
    .filter((e) => e.meal === "Low treatment")
    .reduce((n, e) => n + (e.carbs ?? 0), 0);
  const otherCarbs = food
    .filter((e) => e.meal !== "Low treatment")
    .reduce((n, e) => n + (e.carbs ?? 0), 0);
  const rapid = insulin
    .filter((e) => e.insulin === "Rapid-acting")
    .reduce((n, e) => n + (e.units ?? 0), 0);
  const basal = insulin
    .filter((e) => e.insulin === "Long-acting")
    .reduce((n, e) => n + (e.units ?? 0), 0);
  const calibrationCount = selectedEvents.filter((event) =>
    /calibrat/i.test(event.type + " " + event.details),
  ).length;
  const limited = metrics.coveragePercent < 70 || days.length < 14;
  const hasData = selected.length > 0 || selectedCgm.length > 0 || selectedEvents.length > 0;
  function toggle(key: Section) {
    setSections((s) => ({ ...s, [key]: !s[key] }));
  }
  return (
    <section className="report-page" aria-labelledby="reports-page-heading">
      <header className="care-page-heading">
        <h1 id="reports-page-heading">{patientName ? `${patientName}'s reports` : "Reports"}</h1>
        <p>Recorded glucose, food, insulin, and device events · times in {timezone}.</p>
      </header>
      <div className="report-controls">
        <label>
          Dates{" "}
          <select value={range} onChange={(e) => setRange(e.target.value)}>
            {["3", "7", "14", "30"].map((n) => (
              <option key={n} value={n}>
                Last {n} days
              </option>
            ))}
            <option value="custom">Custom</option>
          </select>
        </label>
        {range === "custom" && (
          <>
            <label>
              From{" "}
              <input
                type="date"
                min={earliestAvailableDay}
                max={today}
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              Through{" "}
              <input
                type="date"
                min={earliestAvailableDay}
                max={today}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
          </>
        )}
        <div className="report-options">
          {(
            [
              ["charts", "Glucose charts"],
              ["meals", "Meals"],
              ["insulin", "Insulin"],
              ["overnight", "Overnight"],
              ["notes", "Notes"],
            ] as [Section, string][]
          ).map(([key, title]) => (
            <label key={key}>
              <Checkbox checked={sections[key]} onCheckedChange={() => toggle(key)} />
              {title}
            </label>
          ))}
        </div>
        <div className="report-buttons">
          <button
            className="button primary"
            disabled={!valid || !hasData}
            onClick={() => window.print()}
          >
            Print / save PDF
          </button>
          <button
            className="button outline"
            disabled={!valid || !hasData}
            onClick={() => downloadCsv(selected, selectedCgm, selectedEvents, timezone, unit)}
          >
            Download full CSV
          </button>
        </div>
      </div>
      <div className="report-paper" id="doctor-report">
        <div className="report-title">
          <div>
            <p>Carby · care log</p>
            <h2>
              {patientName
                ? `${patientName}'s glucose & insulin review`
                : "Glucose & insulin review"}
            </h2>
            <span>
              {fromDay || "—"} through {toDay || "—"} · {timezone}
            </span>
          </div>
          <strong>For clinician review</strong>
        </div>
        {!valid ? (
          <p className="report-placeholder">
            Choose up to 30 calendar days from {earliestAvailableDay} through today. Older CGM and
            device events are outside the loaded report window.
          </p>
        ) : !hasData ? (
          <p className="report-placeholder">No records in this loaded date range.</p>
        ) : (
          <>
            <div className={"report-quality" + (limited ? " report-quality-limited" : "")}>
              <strong>{limited ? "Interpret the percentages with care" : "Data context"}</strong>
              <span>
                {metrics.coveragePercent}% CGM coverage · {Math.round(metrics.observedMinutes)} of{" "}
                {Math.round(metrics.possibleMinutes)} minutes observed.{" "}
                {limited ? "Fewer than 14 days or limited coverage. " : ""}Unobserved gaps are
                excluded from glucose percentages.
              </span>
            </div>
            <section className="report-glance" aria-label="Glucose and care summary">
              <div className="report-range-card">
                <span>
                  Observed time {standardRange(unit)}{" "}
                  <small>({standardRange(otherGlucoseUnit(unit))})</small>
                </span>
                <strong>
                  {metrics.inRangePercent === null ? "—" : metrics.inRangePercent + "%"}
                </strong>
                {metrics.inRangePercent !== null ? (
                  <div
                    className="report-range-track"
                    role="img"
                    aria-label={
                      `Observed time: below ${glucoseWithUnit(standard.low, unit)} ` +
                      metrics.below70Percent +
                      `%; ${formatGlucose(standard.low, unit)} to ${glucoseWithUnit(standard.high, unit)} ` +
                      metrics.inRangePercent +
                      `%; above ${glucoseWithUnit(standard.high, unit)} ` +
                      metrics.above180Percent +
                      "%"
                    }
                  >
                    <i className="below" style={{ width: (metrics.below70Percent ?? 0) + "%" }} />
                    <i className="within" style={{ width: (metrics.inRangePercent ?? 0) + "%" }} />
                    <i className="above" style={{ width: (metrics.above180Percent ?? 0) + "%" }} />
                  </div>
                ) : (
                  <p>No connected CGM intervals</p>
                )}
              </div>
              <dl className="report-key-metrics">
                <div>
                  <dt>Below {formatGlucose(standard.low, unit)}</dt>
                  <dd>{metrics.below70Percent === null ? "—" : metrics.below70Percent + "%"}</dd>
                </div>
                <div>
                  <dt>Above {formatGlucose(standard.high, unit)}</dt>
                  <dd>{metrics.above180Percent === null ? "—" : metrics.above180Percent + "%"}</dd>
                </div>
                <div>
                  <dt>Above {formatGlucose(standard.veryHigh, unit)}</dt>
                  <dd>{metrics.above250Percent === null ? "—" : metrics.above250Percent + "%"}</dd>
                </div>
                {!planRange.standard && (
                  <div>
                    <dt>
                      Time in plan range {formatGlucose(planRange.low, unit)}–
                      {formatGlucose(planRange.high, unit)}
                    </dt>
                    <dd>
                      {metrics.inPlanRangePercent === null ? "—" : metrics.inPlanRangePercent + "%"}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Mean of exact CGM samples</dt>
                  <dd>{metrics.average === null ? "—" : glucoseWithUnit(metrics.average, unit)}</dd>
                </div>
              </dl>
            </section>
            {overlappingIllnesses.length > 0 && (
              <section className="report-illness" aria-label="Illness periods in this range">
                <strong>Illness periods in this range</strong>
                <ul>
                  {overlappingIllnesses.map((illness) => (
                    <li key={illness.id}>
                      {illnessLabel(illness, timezone)}
                      {illness.note && <span> · {illness.note}</span>}
                    </li>
                  ))}
                </ul>
                {reportCheckIns.length > 0 && (
                  <div className="report-scroll">
                    <table className="report-check-ins">
                      <caption>Illness check-ins</caption>
                      <thead>
                        <tr>
                          <th scope="col">Time</th>
                          <th scope="col">Temperature</th>
                          <th scope="col">Symptoms</th>
                          <th scope="col">Vomiting</th>
                          <th scope="col">Fluids</th>
                          <th scope="col">Eating</th>
                          <th scope="col">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportCheckIns.map((checkIn) => (
                          <tr key={checkIn.id}>
                            <td>{checkInTime.format(new Date(checkIn.at))}</td>
                            <td>
                              {checkIn.temperatureC === undefined
                                ? "—"
                                : formatTemperature(checkIn.temperatureC, plan.temperatureUnit)}
                            </td>
                            <td>
                              {checkIn.symptoms.length
                                ? checkIn.symptoms.map((s) => illnessSymptomLabels[s]).join(", ")
                                : "—"}
                            </td>
                            <td>
                              {checkIn.vomited === undefined
                                ? "—"
                                : checkIn.vomited === 0
                                  ? "None"
                                  : `${checkIn.vomited}×`}
                            </td>
                            <td>{checkIn.fluids ? fluidsLabels[checkIn.fluids] : "—"}</td>
                            <td>{checkIn.eating ? eatingLabels[checkIn.eating] : "—"}</td>
                            <td>{checkIn.note || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
            {overlappingContext.length > 0 && (
              <section className="report-illness" aria-label="Other context periods in this range">
                <strong>Context periods in this range</strong>
                <ul>
                  {overlappingContext.map((window) => (
                    <li key={window.id}>
                      {periodKindLabels[periodKind(window) as keyof typeof periodKindLabels] ??
                        periodKind(window)}
                      : {illnessLabel(window, timezone)}
                      {window.note && <span> · {window.note}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {sickDaySet.size > 0 && (
              <p className="report-sick-note">
                <strong>{sickDaySet.size}</strong> of {days.length}{" "}
                {days.length === 1 ? "day" : "days"} in this period{" "}
                {sickDaySet.size === 1 ? "was a sick day" : "were sick days"}.
                {metricsExcludingSick && (
                  <>
                    {" "}
                    Observed time {standardRange(unit)} excluding sick days:{" "}
                    <strong>
                      {metricsExcludingSick.inRangePercent === null
                        ? "—"
                        : metricsExcludingSick.inRangePercent + "%"}
                    </strong>{" "}
                    (overall {metrics.inRangePercent === null ? "—" : metrics.inRangePercent + "%"}
                    ).
                  </>
                )}
              </p>
            )}
            <p className="report-source-line">
              <strong>Sources</strong> {selectedCgm.length} distinct CGM timestamps ({sharePoints}{" "}
              Share, {clarityPoints} Clarity{otherPoints > 0 ? ", " + otherPoints + " other" : ""});{" "}
              {readings.length} manually logged glucose readings; {selectedEvents.length} Clarity
              device events ({calibrationCount} calibrations).{" "}
              {metrics.highStatuses + metrics.lowStatuses > 0 && (
                <>
                  {metrics.highStatuses} HIGH and {metrics.lowStatuses} LOW samples have no numeric
                  value.
                </>
              )}
            </p>
            {valid && (
              <ReportCgm
                fromDay={fromDay}
                toDay={toDay}
                timezone={timezone}
                showCharts={sections.charts}
                now={now}
                unit={unit}
              />
            )}
            <section className="report-section report-patterns" aria-label="Patterns to review">
              <h3>Patterns to review</h3>
              {patterns.length > 0 ? (
                <ul>
                  {patterns.map((flag) => (
                    <li
                      key={`${flag.kind}-${flag.slot}-${flag.days[0]}`}
                      className={`report-pattern-flag pattern-${flag.kind}`}
                    >
                      {patternFlagLabel(flag)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="report-caption">
                  No repeating low or high pattern in the last {days.length} days.
                </p>
              )}
              <p className="report-caption">
                Descriptive only; not dosing guidance. Review with your care team.
              </p>
            </section>
            <CoverageBars
              days={days}
              cgm={selectedCgm}
              timezone={timezone}
              today={today}
              nowAt={nowAt}
            />
            <DailyMatrix
              days={days.length <= 30 ? days : activeDays}
              entries={selected}
              cgm={selectedCgm}
              timezone={timezone}
              illnesses={illnesses}
              now={Date.parse(endAt)}
              showMeals={sections.meals}
              showInsulin={sections.insulin}
              showBedtime={sections.overnight}
              plan={plan}
              patterns={patterns}
            />
            {days.length > 30 && omitted > 0 && (
              <p className="report-caption">
                {omitted} {omitted === 1 ? "day" : "days"} without records omitted from the meal
                table; coverage counts them as unobserved.
              </p>
            )}
            {sections.charts && days.length >= 14 && metrics.coveragePercent >= 70 && (
              <NumericPattern days={days} cgm={selectedCgm} timezone={timezone} unit={unit} />
            )}
            <dl className="report-care-totals">
              <div>
                <dt>Food recorded</dt>
                <dd>
                  {otherCarbs} g <small>excluding low treatment</small>
                </dd>
              </div>
              <div>
                <dt>Low treatment recorded</dt>
                <dd>{lowTreatmentCarbs} g</dd>
              </div>
              <div>
                <dt>Actual Rapid-acting logged</dt>
                <dd>{rapid} units</dd>
              </div>
              <div>
                <dt>Actual Long-acting logged</dt>
                <dd>{basal} units</dd>
              </div>
            </dl>
            <section className="report-section report-detail">
              <h3>Timed glucose & care record</h3>
              <p className="report-caption">
                Manual glucose is shown as separate points. CGM lines stop at gaps over ten minutes
                or a HIGH/LOW status. Markers are grouped visually when times are close; exact
                events remain in the table and CSV.
              </p>
              {sections.charts && <ChartKey unit={unit} />}
              {activeDays.map((day) => {
                const group = entriesByDay.get(day) ?? [];
                const dayCgm = cgmByDay.get(day) ?? [];
                const dayEvents = eventsByDay.get(day) ?? [];
                const visibleEntries = group.filter(
                  (e) =>
                    e.kind === "glucose" ||
                    e.kind === "exercise" ||
                    e.kind === "rescue" ||
                    (e.kind === "food" && sections.meals) ||
                    ((e.kind === "insulin" || e.kind === "correction-skipped") && sections.insulin),
                );
                const rows = [
                  ...visibleEntries.map((e) => ({
                    at: e.at,
                    key: e.id,
                    // The badge class doubles as its text; "correction-skipped" would also pick up
                    // the dashboard's log icon colors.
                    kind: e.kind === "correction-skipped" ? "skipped" : e.kind,
                    text: label(e, plan),
                    note: recordDetails(e, unit),
                  })),
                  ...dayEvents.map((e, i) => ({
                    at: e.at,
                    key: e.at + e.type + i,
                    kind: "device",
                    text:
                      "Dexcom " +
                      e.type +
                      (e.value !== null ? " · " + glucoseWithUnit(e.value, unit) : ""),
                    note: e.details + " · " + e.source,
                  })),
                ].sort((a, b) => a.at.localeCompare(b.at));
                const dayStart = Date.parse(fromLocal(`${day}T00:00`, timezone)),
                  dayEnd = Date.parse(fromLocal(`${nextDay(day)}T00:00`, timezone));
                const sickSpans = sickIllnesses.flatMap((illness): SickSpan[] => {
                  const overlap = illnessOverlap(illness, dayStart, dayEnd, now);
                  if (!overlap) return [];
                  return [
                    {
                      from: overlap.start > dayStart ? new Date(overlap.start).toISOString() : null,
                      to: overlap.end < dayEnd ? new Date(overlap.end).toISOString() : null,
                    },
                  ];
                });
                return (
                  <article className="report-day" key={day}>
                    <h4>
                      <strong className="report-day-title">
                        {new Intl.DateTimeFormat("en-US", {
                          weekday: "long",
                          month: "short",
                          day: "numeric",
                          timeZone: "UTC",
                        }).format(new Date(day + "T12:00:00Z"))}
                        {sickSpans.length > 0 && <span className="report-sick-badge">Sick</span>}
                      </strong>
                      <span className="report-day-counts">
                        {group.length} manual · {dayCgm.length} CGM · {dayEvents.length} device
                        events
                      </span>
                    </h4>
                    {sections.charts && (
                      <DailyChart
                        day={day}
                        entries={visibleEntries}
                        cgm={dayCgm}
                        dexcomEvents={dayEvents}
                        timezone={timezone}
                        plan={plan}
                        sickSpans={sickSpans}
                      />
                    )}
                    {rows.length > 0 && (
                      <table className="report-event-table">
                        <caption className="sr-only">{day} entries in recorded time order</caption>
                        <thead>
                          <tr>
                            <th scope="col">Time</th>
                            <th scope="col">Type</th>
                            <th scope="col">Recorded</th>
                            {sections.notes && <th scope="col">Context / notes</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row) => (
                            <tr key={row.key}>
                              <td>
                                <time dateTime={row.at}>{localParts(row.at, timezone).time}</time>
                              </td>
                              <td>
                                <span className={"report-record-kind " + row.kind}>
                                  {row.kind === "device" ? "Dexcom" : row.kind}
                                </span>
                              </td>
                              <td>{row.text}</td>
                              {sections.notes && <td>{row.note || "—"}</td>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </article>
                );
              })}
            </section>
            <section className="report-method" aria-label="Report interpretation">
              <strong>How to read this report</strong>
              <p>
                Only connected CGM intervals up to ten minutes count as observed time. HIGH and LOW
                statuses count as outside range without supplying an exact glucose value; they do
                not enter the sample mean. Duplicate timestamps are counted once, preferring a
                numeric Clarity value when available. CGM coverage and percentages do not include
                missing time.
              </p>
              <p>
                Breakfast 6–10 a.m., lunch 11 a.m.–3 p.m., and dinner 5–9 p.m. are clock windows for
                legacy uncategorized meals. Explicit meal labels keep their chosen category at any
                hour. The daily glucose pattern table shows one pre-meal reading per logbook slot
                (Breakfast, Lunch, Dinner, Bedtime): a finger-stick logged in the slot, else the
                nearest CGM reading before the slot’s first logged food or rapid-acting dose. HI/LO
                meter readings count as above or below any threshold without a fabricated number.
                The CSV includes UTC timestamps when local clock times repeat at a daylight saving
                change.
              </p>
              <p>
                This is a retrospective care log; for current treatment decisions use the Dexcom app
                or receiver and the current care plan.
              </p>
            </section>
          </>
        )}
      </div>
      <CgmHistory active={active} timezone={timezone} unit={unit} />
    </section>
  );
}
// Mounted in a hidden tab; skip re-renders from unrelated dashboard state such as typing in forms.
export default memo(DoctorReport);
