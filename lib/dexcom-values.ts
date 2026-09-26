import type { CgmReading } from "./care";

/** Decode Share's timestamp/value records without inventing lows from missing values. */
export function parseShareValues(values: unknown, now = Date.now()): CgmReading[] {
  if (!Array.isArray(values)) throw new Error("Dexcom returned unexpected glucose data.");
  const readings: CgmReading[] = [];
  for (const item of values) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const match =
      typeof raw.DT === "string" ? /^\/?Date\((\d+)(?:[+-]\d{4})?\)\/?$/.exec(raw.DT) : null;
    if (!match || !(typeof raw.Value === "number" || typeof raw.Value === "string")) continue;
    const timestamp = Number(match[1]),
      value = Number(raw.Value);
    const status =
      (typeof raw.Value === "string" && raw.Value.toLowerCase() === "high") ||
      (Number.isFinite(value) && value > 400 && value <= 1000)
        ? "High"
        : (typeof raw.Value === "string" && raw.Value.toLowerCase() === "low") ||
            (Number.isFinite(value) && value >= 20 && value < 40)
          ? "Low"
          : null;
    if (
      !Number.isFinite(timestamp) ||
      timestamp < 0 ||
      timestamp > now + 300000 ||
      (!status && (!Number.isInteger(value) || value < 40 || value > 400))
    )
      continue;
    readings.push({
      at: new Date(timestamp).toISOString(),
      value: status ? null : value,
      status,
      source: "Dexcom Share",
    });
  }
  return readings;
}
