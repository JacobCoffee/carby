import type { CgmReading, Entry, Plan } from "./care";
import { dateKey, glucoseRanges } from "./care";
import type { IllnessWindow } from "./illness";
import { buildLogbook, LOGBOOK_SLOTS, type LogbookCell, type LogbookSlot } from "./logbook";

/**
 * Clinic pattern-management rule: descriptive only, never dosing guidance.
 * Per logbook slot, flag a run of `patternRule.highDays` (or `lowDays`)
 * consecutive days where the slot's pre-meal reading is above the plan's
 * high range (or below `lowThreshold`). HI/LO meter statuses count. Days in
 * an illness period count like any other day and are named in the flag, so
 * the family can tell the care team which readings came while sick.
 */
export const PATTERN_DEFAULT_LOOKBACK_DAYS = 7;

export type PatternKind = "low" | "high";
export type PatternFlag = {
  kind: PatternKind;
  slot: LogbookSlot;
  /** Every day in the run, calendar keys, ascending. */
  days: string[];
  /** The days in `days` that fell in an illness period. */
  sickDays: string[];
  lookbackDays: number;
};

function shiftDay(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + delta * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function highHit(cell: LogbookCell, high: number): boolean {
  if (!cell) return false;
  return cell.status === "High" || (cell.value !== null && cell.value > high);
}
function lowHit(cell: LogbookCell, low: number): boolean {
  if (!cell) return false;
  return cell.status === "Low" || (cell.value !== null && cell.value < low);
}

type Run = { days: string[]; sickDays: string[] };
/** Consecutive-day runs for one slot/condition. */
function runsFor(
  order: { day: string; sick: boolean; cell: LogbookCell }[],
  hit: (cell: LogbookCell) => boolean,
): Run[] {
  const runs: Run[] = [];
  let days: string[] = [];
  let sickDays: string[] = [];
  for (const { day, sick, cell } of order) {
    if (hit(cell)) {
      days.push(day);
      if (sick) sickDays.push(day);
    } else {
      if (days.length) runs.push({ days, sickDays });
      days = [];
      sickDays = [];
    }
  }
  if (days.length) runs.push({ days, sickDays });
  return runs;
}

export function buildPatternFlags(options: {
  entries: Entry[];
  cgm: CgmReading[];
  timezone: string;
  illnesses?: IllnessWindow[];
  now?: number;
  lookbackDays?: number;
  plan: Pick<Plan, "glucoseRanges" | "lowThreshold" | "patternRule">;
}): PatternFlag[] {
  const {
    entries,
    cgm,
    timezone,
    illnesses = [],
    now = Date.now(),
    lookbackDays = PATTERN_DEFAULT_LOOKBACK_DAYS,
    plan,
  } = options;
  const endDay = dateKey(new Date(now), timezone);
  const startDay = shiftDay(endDay, 1 - lookbackDays);
  const days = Array.from({ length: lookbackDays }, (_, index) => shiftDay(startDay, index));
  const logbook = buildLogbook({ days, entries, cgm, timezone, illnesses, now });
  const high = glucoseRanges(plan).high;
  const low = plan.lowThreshold;

  const flags: PatternFlag[] = [];
  // Lows first (highest priority), then highs.
  for (const slot of LOGBOOK_SLOTS) {
    const order = logbook.map((d) => ({ day: d.day, sick: d.sick, cell: d.cells[slot] }));
    for (const run of runsFor(order, (c) => lowHit(c, low))) {
      if (run.days.length >= plan.patternRule.lowDays)
        flags.push({ kind: "low", slot, days: run.days, sickDays: run.sickDays, lookbackDays });
    }
  }
  for (const slot of LOGBOOK_SLOTS) {
    const order = logbook.map((d) => ({ day: d.day, sick: d.sick, cell: d.cells[slot] }));
    for (const run of runsFor(order, (c) => highHit(c, high))) {
      if (run.days.length >= plan.patternRule.highDays)
        flags.push({ kind: "high", slot, days: run.days, sickDays: run.sickDays, lookbackDays });
    }
  }
  return flags;
}

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
});
/** Render a flag as descriptive-only copy; never a dosing suggestion. */
export function patternFlagLabel(flag: PatternFlag): string {
  const kindLabel = flag.kind === "low" ? "Lows" : "Highs";
  const dayList = flag.days.map((d) => dayFormatter.format(new Date(`${d}T12:00:00Z`))).join(", ");
  const sickPart =
    flag.sickDays.length === flag.days.length
      ? ", all during illness"
      : flag.sickDays.length > 0
        ? `, ${flag.sickDays.length} during illness`
        : "";
  return `${kindLabel} at ${flag.slot} on ${flag.days.length} days in a row (${dayList})${sickPart}.`;
}
