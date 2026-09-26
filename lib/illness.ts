import { z } from "zod";
import {
  dateKey,
  fromLocal,
  localInput,
  temperatureUnitLabels,
  timeZoneSchema,
  type TemperatureUnit,
} from "./care";

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Enter a valid date.");
const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a valid time (HH:MM).")
  .optional();
export const periodKinds = ["illness", "stress", "vacation", "menstrual", "other"] as const;
export type PeriodKind = (typeof periodKinds)[number];
export const periodKindLabels: Record<PeriodKind, string> = {
  illness: "Illness",
  stress: "Stress",
  vacation: "Vacation",
  menstrual: "Menstrual cycle",
  other: "Other",
};
export const illnessSymptoms = [
  "fever",
  "chills",
  "cough",
  "congestion",
  "soreThroat",
  "nausea",
  "diarrhea",
  "stomachPain",
  "headache",
  "bodyAches",
  "fatigue",
] as const;
export type IllnessSymptom = (typeof illnessSymptoms)[number];
export const illnessSymptomLabels: Record<IllnessSymptom, string> = {
  fever: "Fever",
  chills: "Chills",
  cough: "Cough",
  congestion: "Congestion",
  soreThroat: "Sore throat",
  nausea: "Nausea",
  diarrhea: "Diarrhea",
  stomachPain: "Stomach pain",
  headache: "Headache",
  bodyAches: "Body aches",
  fatigue: "Tired",
};
export const fluidsLevels = ["all", "some", "none"] as const;
export type FluidsLevel = (typeof fluidsLevels)[number];
export const fluidsLabels: Record<FluidsLevel, string> = {
  all: "Keeping fluids down",
  some: "Keeping some fluids down",
  none: "Not keeping fluids down",
};
export const eatingLevels = ["normal", "less", "none"] as const;
export type EatingLevel = (typeof eatingLevels)[number];
export const eatingLabels: Record<EatingLevel, string> = {
  normal: "Eating normally",
  less: "Eating less",
  none: "Not eating",
};
/** Entry bounds that catch a mistyped reading (°C). They are not care thresholds. */
export const TEMPERATURE_C_RANGE = { min: 30, max: 45 } as const;
/**
 * One observation during an illness, at a moment. Every detail is optional, but a check-in
 * records at least one. `vomited` counts episodes since the previous check-in (0 = none).
 */
export const illnessCheckInSchema = z
  .object({
    id: z.string().uuid(),
    at: z.string().datetime(),
    temperatureC: z.number().min(TEMPERATURE_C_RANGE.min).max(TEMPERATURE_C_RANGE.max).optional(),
    symptoms: z
      .array(z.enum(illnessSymptoms))
      .max(illnessSymptoms.length)
      .refine((list) => new Set(list).size === list.length, "List each symptom once."),
    vomited: z.number().int().min(0).max(50).optional(),
    fluids: z.enum(fluidsLevels).optional(),
    eating: z.enum(eatingLevels).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine(
    (c) =>
      c.temperatureC !== undefined ||
      c.symptoms.length > 0 ||
      c.vomited !== undefined ||
      c.fluids !== undefined ||
      c.eating !== undefined ||
      !!c.note,
    { message: "Record at least one detail for this check-in." },
  );
export type IllnessCheckIn = z.infer<typeof illnessCheckInSchema>;
export const MAX_CHECK_INS = 300;
export const illnessSchema = z
  .object({
    id: z.string().uuid(),
    revision: z.string().uuid().optional(),
    startDate: calendarDate,
    startTime: clockTime,
    endDate: calendarDate.nullable(),
    endTime: clockTime,
    timezone: timeZoneSchema,
    kind: z.enum(periodKinds).optional(),
    note: z.string().trim().max(1000),
    /** Oldest first. Absent on periods logged before check-ins existed. */
    checkIns: z
      .array(illnessCheckInSchema)
      .max(MAX_CHECK_INS)
      .refine((list) => new Set(list.map((c) => c.id)).size === list.length, "Duplicate check-in.")
      .optional(),
  })
  .refine((value) => !value.endDate || value.endDate >= value.startDate, {
    message: "End date must be on or after the start date.",
    path: ["endDate"],
  })
  .refine(
    (value) =>
      value.endDate !== value.startDate ||
      !value.startTime ||
      !value.endTime ||
      value.endTime > value.startTime,
    { message: "End time must be after the start time.", path: ["endTime"] },
  );
export type IllnessWindow = z.infer<typeof illnessSchema>;
/** Absent `kind` is an older illness record; every other kind is explicit. */
export function periodKind(w: Pick<IllnessWindow, "kind">): PeriodKind {
  return w.kind ?? "illness";
}
/** Only sick periods exclude days from patterns and trigger sick-day mode. */
export function isSick(w: Pick<IllnessWindow, "kind">) {
  return periodKind(w) === "illness";
}
/** The period closed at `now`, to the minute, in its own time zone. */
export function endPeriodNow(w: IllnessWindow, now: number): IllnessWindow {
  const local = localInput(new Date(now), w.timezone);
  return { ...w, endDate: local.slice(0, 10), endTime: local.slice(11, 16) };
}

export function validateIllnessDates(illness: IllnessWindow, now: number) {
  const today = dateKey(new Date(now), illness.timezone);
  const nowClock = localInput(new Date(now), illness.timezone).slice(11, 16);
  if (
    illness.startDate > today ||
    (illness.startDate === today && !!illness.startTime && illness.startTime > nowClock) ||
    (illness.endDate && illness.endDate > today) ||
    (illness.endDate === today && !!illness.endTime && illness.endTime > nowClock)
  )
    throw new Error("Use dates that have happened; leave the end date open if illness is ongoing.");
  let bounds: { start: number; end: number };
  try {
    bounds = illnessBounds(illness, now);
  } catch {
    throw new Error(
      "A selected date does not start at midnight in this timezone. Check the dates and care timezone.",
    );
  }
  for (const checkIn of illness.checkIns ?? []) checkInWithin(checkIn, illness, bounds, now);
}
/** Check-ins may be a minute ahead of `now` to allow for clock drift between devices. */
const CLOCK_SKEW_MS = 60_000;
function checkInWithin(
  checkIn: IllnessCheckIn,
  illness: IllnessWindow,
  bounds: { start: number; end: number },
  now: number,
) {
  const at = Date.parse(checkIn.at);
  if (at > now + CLOCK_SKEW_MS) throw new Error("Use a check-in time that has happened.");
  // An ongoing period has no end yet. A closed one includes its last minute, so a check-in
  // logged just before "All better" still fits.
  if (at < bounds.start || (!!illness.endDate && at > bounds.end))
    throw new Error(
      "A check-in falls outside this period. Change the check-in time or the period dates.",
    );
}
/** The period with `checkIn` added, or replacing the check-in with the same id; oldest first. */
export function withCheckIn(illness: IllnessWindow, checkIn: IllnessCheckIn, now: number) {
  const next: IllnessWindow = {
    ...illness,
    checkIns: [...(illness.checkIns ?? []).filter((c) => c.id !== checkIn.id), checkIn].sort(
      (a, b) => Date.parse(a.at) - Date.parse(b.at),
    ),
  };
  if ((next.checkIns?.length ?? 0) > MAX_CHECK_INS)
    throw new Error(`A period holds up to ${MAX_CHECK_INS} check-ins.`);
  checkInWithin(checkIn, illness, illnessBounds(illness, now), now);
  return next;
}
export function withoutCheckIn(illness: IllnessWindow, checkInId: string): IllnessWindow {
  const checkIns = (illness.checkIns ?? []).filter((c) => c.id !== checkInId);
  const { checkIns: _, ...rest } = illness;
  return checkIns.length ? { ...rest, checkIns } : rest;
}
/** Check-ins recorded in [start, end), oldest first. */
export function checkInsBetween(illness: IllnessWindow, start: number, end: number) {
  return (illness.checkIns ?? []).filter((c) => {
    const at = Date.parse(c.at);
    return at >= start && at < end;
  });
}
/** A temperature typed in `unit`, as stored (°C, two decimals so °F round-trips to 0.1). */
export function toCelsius(value: number, unit: TemperatureUnit) {
  const celsius = unit === "C" ? value : ((value - 32) * 5) / 9;
  return Math.round(celsius * 100) / 100;
}
/** A stored °C reading in `unit`, to one decimal. */
export function fromCelsius(celsius: number, unit: TemperatureUnit) {
  const value = unit === "C" ? celsius : (celsius * 9) / 5 + 32;
  return Math.round(value * 10) / 10;
}
/** Without a care-plan unit, readings show in °C, the unit they are stored in. */
export function formatTemperature(celsius: number, unit: TemperatureUnit | undefined) {
  const shown = unit ?? "C";
  return `${fromCelsius(celsius, shown).toFixed(1)} ${temperatureUnitLabels[shown]}`;
}
/** Short, plain summary of what a check-in recorded, in a fixed order. */
export function checkInDetails(checkIn: IllnessCheckIn, unit: TemperatureUnit | undefined) {
  const parts: string[] = [];
  if (checkIn.temperatureC !== undefined) parts.push(formatTemperature(checkIn.temperatureC, unit));
  if (checkIn.symptoms.length)
    parts.push(checkIn.symptoms.map((s) => illnessSymptomLabels[s]).join(", "));
  if (checkIn.vomited !== undefined)
    parts.push(
      checkIn.vomited === 0
        ? "No vomiting"
        : `Vomited ${checkIn.vomited} ${checkIn.vomited === 1 ? "time" : "times"}`,
    );
  if (checkIn.fluids) parts.push(fluidsLabels[checkIn.fluids]);
  if (checkIn.eating) parts.push(eatingLabels[checkIn.eating]);
  return parts;
}
export function illnessBounds(illness: IllnessWindow, now: number) {
  const start = Date.parse(
    fromLocal(`${illness.startDate}T${illness.startTime ?? "00:00"}`, illness.timezone),
  );
  if (!illness.endDate) return { start, end: now };
  if (illness.endTime)
    return {
      start,
      end: Date.parse(fromLocal(`${illness.endDate}T${illness.endTime}`, illness.timezone)),
    };
  const next = new Date(`${illness.endDate}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return {
    start,
    end: Date.parse(fromLocal(`${next.toISOString().slice(0, 10)}T00:00`, illness.timezone)),
  };
}
export function illnessOverlap(illness: IllnessWindow, start: number, end: number, now: number) {
  try {
    const bounds = illnessBounds(illness, now);
    return bounds.start < end && bounds.end > start
      ? { start: Math.max(start, bounds.start), end: Math.min(end, bounds.end) }
      : null;
  } catch {
    return null;
  }
}
/**
 * The period's dates as recorded, in its own zone. When that differs from `viewZone` (the plan's
 * zone after a move or trip), the label names it so the dates are not read as local ones.
 */
export function illnessLabel(illness: IllnessWindow, viewZone: string) {
  const zone = illness.timezone === viewZone ? "" : ` (${illness.timezone})`;
  const format = (day: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(`${day}T12:00:00Z`));
  const formatTime = (time: string) => {
    const [hour, minute] = time.split(":").map(Number);
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(Date.UTC(2000, 0, 1, hour, minute));
  };
  const start = `${format(illness.startDate)}${illness.startTime ? `, ${formatTime(illness.startTime)}` : ""}`;
  if (illness.endDate === illness.startDate && !illness.startTime && !illness.endTime)
    return start + zone;
  const end = !illness.endDate
    ? "ongoing"
    : illness.endDate === illness.startDate
      ? illness.endTime
        ? formatTime(illness.endTime)
        : format(illness.endDate)
      : `${format(illness.endDate)}${illness.endTime ? `, ${formatTime(illness.endTime)}` : ""}`;
  return `${start} – ${end}${zone}`;
}
