import type { CgmReading, Entry, Plan } from "./care";
import { fromLocal, meterStatusLabel } from "./care";
import { formatGlucose, glucoseUnitOf } from "./glucose-units";
import { uniqueCgm } from "./cgm-metrics";
import { foodEntriesForMeal, mealHours, type MealWindow } from "./report-analysis";
import { illnessOverlap, isSick, periodKind, type IllnessWindow } from "./illness";

/**
 * Single source of truth for the clinic's paper logbook layout: one pre-meal
 * reading per day per slot. Descriptive only; never a dosing calculation.
 */
export const LOGBOOK_SLOTS = ["Breakfast", "Lunch", "Dinner", "Bedtime"] as const;
export type LogbookSlot = (typeof LOGBOOK_SLOTS)[number];

export type LogbookCell = {
  at: string;
  value: number | null;
  status: "High" | "Low" | null;
  source: "Finger-stick" | "CGM";
  ketones?: Entry["ketones"];
  carbs?: number;
  units?: number;
} | null;

export type LogbookDay = {
  day: string;
  sick: boolean;
  /** Non-illness context periods (stress, vacation, ...) covering this day. */
  periods: string[];
  cells: Record<LogbookSlot, LogbookCell>;
};

const BEDTIME_HOURS: [number, number] = [20, 24];

function shiftDay(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + delta * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function windowBounds(day: string, hours: [number, number], timezone: string) {
  const [from, to] = hours;
  const start = Date.parse(fromLocal(`${day}T${String(from).padStart(2, "0")}:00`, timezone));
  const endDay = to === 24 ? shiftDay(day, 1) : day;
  const endHour = to === 24 ? "00" : String(to).padStart(2, "0");
  const end = Date.parse(fromLocal(`${endDay}T${endHour}:00`, timezone));
  return { start, end };
}

/** Rapid-acting units logged within an hour of the anchor event, same rule the old MealCell used. */
function linkedTotals(anchor: Entry, entries: Entry[]) {
  const carbs = anchor.kind === "food" ? (anchor.carbs ?? undefined) : undefined;
  const doses = entries.filter(
    (e) =>
      e.kind === "insulin" &&
      e.insulin === "Rapid-acting" &&
      Math.abs(Date.parse(e.at) - Date.parse(anchor.at)) <= 60 * 60000,
  );
  const units = doses.length ? doses.reduce((sum, e) => sum + (e.units ?? 0), 0) : undefined;
  return { carbs, units };
}

function slotCell(
  day: string,
  slot: LogbookSlot,
  entries: Entry[],
  points: CgmReading[],
  timezone: string,
): LogbookCell {
  const hours = slot === "Bedtime" ? BEDTIME_HOURS : mealHours[slot as MealWindow];
  const { start, end } = windowBounds(day, hours, timezone);
  const inWindow = (at: string) => {
    const ms = Date.parse(at);
    return ms >= start && ms < end;
  };
  const anchorFood =
    slot === "Bedtime" ? undefined : foodEntriesForMeal(day, slot, entries, timezone)[0];
  const fingerstick = entries
    .filter((e) => e.kind === "glucose" && e.source === "Finger-stick" && inWindow(e.at))
    .sort((a, b) => a.at.localeCompare(b.at))[0];
  if (fingerstick) {
    const totals = anchorFood ? linkedTotals(anchorFood, entries) : {};
    return {
      at: fingerstick.at,
      value: fingerstick.glucose,
      status: fingerstick.status ?? null,
      source: "Finger-stick",
      ketones: fingerstick.ketones ?? undefined,
      ...totals,
    };
  }
  const rapidInWindow =
    slot === "Bedtime"
      ? entries
          .filter((e) => e.kind === "insulin" && e.insulin === "Rapid-acting" && inWindow(e.at))
          .sort((a, b) => a.at.localeCompare(b.at))[0]
      : undefined;
  const anchor = anchorFood ?? rapidInWindow;
  if (!anchor) return null;
  const anchorAt = Date.parse(anchor.at);
  const before = uniqueCgm(points)
    .filter((r) => Date.parse(r.at) <= anchorAt)
    .sort((a, b) => a.at.localeCompare(b.at))
    .at(-1);
  if (!before) return null;
  const totals = anchorFood
    ? linkedTotals(anchorFood, entries)
    : rapidInWindow
      ? { units: rapidInWindow.units ?? undefined }
      : {};
  return { at: before.at, value: before.value, status: before.status, source: "CGM", ...totals };
}

export function buildLogbook(o: {
  days: string[];
  entries: Entry[];
  cgm: CgmReading[];
  timezone: string;
  illnesses?: IllnessWindow[];
  now: number;
}): LogbookDay[] {
  const { days, entries, cgm, timezone, illnesses = [], now } = o;
  const points = uniqueCgm(cgm);
  return days.map((day) => {
    const dayStart = Date.parse(fromLocal(`${day}T00:00`, timezone));
    const dayEnd = Date.parse(fromLocal(`${shiftDay(day, 1)}T00:00`, timezone));
    const sick = illnesses.some(
      (w) => isSick(w) && illnessOverlap(w, dayStart, dayEnd, now) !== null,
    );
    const periods = [
      ...new Set(
        illnesses
          .filter((w) => !isSick(w) && illnessOverlap(w, dayStart, dayEnd, now) !== null)
          .map((w) => periodKind(w)),
      ),
    ];
    const cells = Object.fromEntries(
      LOGBOOK_SLOTS.map((slot) => [slot, slotCell(day, slot, entries, points, timezone)]),
    ) as Record<LogbookSlot, LogbookCell>;
    return { day, sick, periods, cells };
  });
}

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
});

/** Descriptive text for one logbook cell in the plan's unit; never a fabricated number for HI/LO. */
export function logbookCellLabel(
  cell: LogbookCell,
  plan: Pick<Plan, "meter" | "glucoseUnit">,
): string {
  if (!cell) return "—";
  if (cell.value !== null) return formatGlucose(cell.value, glucoseUnitOf(plan));
  return cell.status ? meterStatusLabel(cell.status, plan) : "—";
}

/** Plain text to read on the phone: "Sep 25 — Breakfast 143, Lunch 211, Dinner 134, Bedtime 156". */
export function logbookCallIn(
  days: LogbookDay[],
  plan: Pick<Plan, "meter" | "glucoseUnit">,
): string {
  return days
    .map((day) => {
      const parts = LOGBOOK_SLOTS.map(
        (slot) => `${slot} ${logbookCellLabel(day.cells[slot], plan)}`,
      );
      return `${dayFormatter.format(new Date(`${day.day}T12:00:00Z`))} — ${parts.join(", ")}`;
    })
    .join("\n");
}
