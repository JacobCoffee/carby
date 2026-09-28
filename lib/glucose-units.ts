import { z } from "zod";

/**
 * Glucose is stored in mg/dL everywhere: records, plans, backups, sync and the Nightscout API.
 * Only what a person reads and types changes with the unit, and this is the one place that
 * converts. Levels show as whole mg/dL or mmol/L to one decimal; a typed value is taken at that
 * precision and converted exactly, so the dose math gives the same result in either unit.
 */

/**
 * mg/dL in one mmol/L: glucose's molar mass, 180.1559 g/mol, over 10. Nightscout, xDrip and AAPS
 * use this value, so Carby shows the same mmol/L as the apps it shares data with.
 */
export const MGDL_PER_MMOL = 18.01559;
export const glucoseUnits = ["mg/dL", "mmol/L"] as const;
export type GlucoseUnit = (typeof glucoseUnits)[number];
export const glucoseUnitSchema = z.enum(glucoseUnits);

/** The unit a person's glucose is entered and shown in. Plans saved before the setting existed were entered in mg/dL. */
export function glucoseUnitOf(plan: { glucoseUnit?: GlucoseUnit } | null | undefined): GlucoseUnit {
  return plan?.glucoseUnit ?? "mg/dL";
}

/** The unit a clinician may need beside the person's own, as on the report's range note. */
export function otherGlucoseUnit(unit: GlucoseUnit): GlucoseUnit {
  return unit === "mg/dL" ? "mmol/L" : "mg/dL";
}

const levelPlaces: Record<GlucoseUnit, number> = { "mg/dL": 0, "mmol/L": 1 };
const factorPlaces: Record<GlucoseUnit, number> = { "mg/dL": 1, "mmol/L": 2 };
const perMgdl = (unit: GlucoseUnit) => (unit === "mmol/L" ? MGDL_PER_MMOL : 1);
const round = (value: number, places: number) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

/** The smallest change a glucose level shows in the unit: 1 mg/dL or 0.1 mmol/L. */
export function glucoseStep(unit: GlucoseUnit): number {
  return 10 ** -levelPlaces[unit];
}

/** mg/dL as a number in the unit, without rounding. For chart positions, not for display. */
export function glucoseToUnit(mgdl: number, unit: GlucoseUnit): number {
  return mgdl / perMgdl(unit);
}

/** A value in the unit as exact mg/dL. For values that already carry their own precision, such as imports. */
export function glucoseToMgdl(value: number, unit: GlucoseUnit): number {
  return value * perMgdl(unit);
}

/**
 * A stored mg/dL level, or a change in glucose, in the unit as it is shown: whole mg/dL, or
 * mmol/L to one decimal.
 */
export function glucoseIn(mgdl: number, unit: GlucoseUnit): number {
  return round(glucoseToUnit(mgdl, unit), levelPlaces[unit]);
}

/** A number already in the unit, as text at the unit's precision: "99" or "5.0". */
export function formatUnitValue(value: number, unit: GlucoseUnit): string {
  return round(value, levelPlaces[unit]).toFixed(levelPlaces[unit]);
}

/** A stored mg/dL level, or a change in glucose, as text in the unit without the unit: "99" or "5.5". */
export function formatGlucose(mgdl: number, unit: GlucoseUnit): string {
  return formatUnitValue(glucoseToUnit(mgdl, unit), unit);
}

/** A stored mg/dL level with its unit: "99 mg/dL" or "5.5 mmol/L". */
export function glucoseWithUnit(mgdl: number, unit: GlucoseUnit): string {
  return `${formatGlucose(mgdl, unit)} ${unit}`;
}

/**
 * A level typed in the unit, in mg/dL. It is taken at the precision the unit shows, so what was
 * typed is what shows again, then converted exactly. NaN (a blank field) stays NaN.
 */
export function glucoseFromInput(value: number, unit: GlucoseUnit): number {
  return glucoseToMgdl(round(value, levelPlaces[unit]), unit);
}

/** A glucose field's text in mg/dL: NaN when blank or not a number, so a blank is never 0. */
export function parseGlucose(text: string, unit: GlucoseUnit): number {
  const trimmed = text.trim();
  return glucoseFromInput(trimmed === "" ? NaN : Number(trimmed), unit);
}

/** Input limits in the unit for a level stored between these mg/dL bounds: the first and last values the unit can show that fall inside them. */
export function glucoseInputBounds(minMgdl: number, maxMgdl: number, unit: GlucoseUnit) {
  const step = glucoseStep(unit);
  const places = levelPlaces[unit];
  // A tiny allowance keeps floating-point error from pushing an exact bound out by one step.
  return {
    min: round(Math.ceil(glucoseToUnit(minMgdl, unit) / step - 1e-9) * step, places),
    max: round(Math.floor(glucoseToUnit(maxMgdl, unit) / step + 1e-9) * step, places),
    step,
  };
}

/** A correction factor, stored as mg/dL per insulin unit, in the unit per insulin unit: mg/dL to one decimal, mmol/L to two. */
export function factorIn(mgdlPerUnit: number, unit: GlucoseUnit): number {
  return round(mgdlPerUnit / perMgdl(unit), factorPlaces[unit]);
}

/** A correction factor as text in the unit, without trailing zeros: "36", "37.5" or "2.25". */
export function formatFactor(mgdlPerUnit: number, unit: GlucoseUnit): string {
  return String(factorIn(mgdlPerUnit, unit));
}

/** A correction factor typed in the unit per insulin unit, in mg/dL per unit, taken at the precision it shows with. */
export function factorFromInput(value: number, unit: GlucoseUnit): number {
  return round(value, factorPlaces[unit]) * perMgdl(unit);
}

/** Input limits in the unit for a correction factor: above zero, and at most 1000 mg/dL per unit. */
export function factorInputBounds(unit: GlucoseUnit) {
  const places = factorPlaces[unit];
  const step = 10 ** -places;
  return { min: step, max: round(Math.floor(1000 / perMgdl(unit) / step) * step, places), step };
}

/** A rate of change, stored as mg/dL per minute, with its unit: "2 mg/dL per min" or "0.11 mmol/L per min". */
export function formatGlucoseRate(mgdlPerMinute: number, unit: GlucoseUnit): string {
  return `${round(mgdlPerMinute / perMgdl(unit), factorPlaces[unit])} ${unit} per min`;
}
