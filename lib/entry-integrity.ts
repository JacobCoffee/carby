import type { Entry } from "./care";

/** Preserve provenance when changing the descriptive fields of an existing record. */
export function preserveEntryContext(entry: Entry, previous: Entry | null): Entry {
  if (!previous) return entry;
  const next = { ...entry };
  if (
    entry.kind === "insulin" &&
    previous.kind === "insulin" &&
    entry.insulin === previous.insulin
  ) {
    next.calculation = previous.calculation;
  }
  if (
    entry.kind === "food" &&
    previous.kind === "food" &&
    entry.carbs === previous.carbs &&
    !entry.foodItems
  ) {
    next.foodItems = previous.foodItems;
  }
  return next;
}

/** Compare payloads independently of server-assigned revisions and object key order. */
export function sameEntry(left: Entry, right: Entry): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key, item]) => key !== "revision" && item !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)]),
      );
    }
    return value;
  };
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
