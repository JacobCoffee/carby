/** A glucose reading as the chart's hover readout lists it. */
export type ReadoutReading = {
  at: string;
  t: number;
  value: number | null;
  status?: string | null;
  source: string;
};

/**
 * Folds readings that say the same thing in the same minute into one row that names every source,
 * so a value that arrived from Share twice and from Clarity once reads as one line, not three.
 * Different values or statuses in that minute stay separate; the order of first appearance holds.
 */
export function mergeReadings<T extends ReadoutReading>(
  readings: T[],
): (T & { sources: string[] })[] {
  const rows: (T & { sources: string[] })[] = [];
  const byKey = new Map<string, T & { sources: string[] }>();
  for (const reading of readings) {
    const key = `${Math.floor(reading.t / 60000)}|${reading.value ?? ""}|${reading.status ?? ""}`;
    const row = byKey.get(key);
    if (row) {
      if (!row.sources.includes(reading.source)) row.sources.push(reading.source);
      continue;
    }
    const next = { ...reading, sources: [reading.source] };
    byKey.set(key, next);
    rows.push(next);
  }
  return rows;
}
