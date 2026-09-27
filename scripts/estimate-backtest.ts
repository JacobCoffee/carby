#!/usr/bin/env bun
// Score the likely-range estimate against a backup's own history, replayed moment by moment, and
// compare it with the estimate that also learns from logged food and rapid-acting insulin.
// Usage: bun scripts/estimate-backtest.ts path/to/carby-backup.ndjson
// Reads the file only; nothing is written or sent anywhere.
import { readFileSync } from "node:fs";
import { BackupParser } from "../lib/backup-import";
import { cgmSchema, entrySchema, type CgmReading, type Entry } from "../lib/care";
import { backtestEstimate, loggedGroup, type HorizonScore } from "../lib/estimate-backtest";
import { glucoseEstimate, loggedEstimate } from "../lib/glucose-estimate";
import { illnessBounds, illnessSchema, isSick } from "../lib/illness";

const path = process.argv[2];
if (!path) throw new Error("Usage: bun scripts/estimate-backtest.ts path/to/carby-backup.ndjson");
const parser = new BackupParser();
const cgm: CgmReading[] = [];
const entries: Entry[] = [];
const sick: { start: number; end: number }[] = [];
const json = (text: unknown) => {
  try {
    return JSON.parse(String(text)) as unknown;
  } catch {
    return null;
  }
};
for (const text of readFileSync(path, "utf8").split("\n")) {
  if (!text.trim() && parser.line > 0) continue;
  const line = parser.push(text);
  if (line.type !== "row") continue;
  const row = line.upload.row;
  if (line.table === "cgm_readings") {
    const { at, value, source } = row;
    const status = value === "High" || value === "Low" ? value : null;
    const reading = cgmSchema.safeParse({
      at,
      value: status ? null : Number(value),
      status,
      source,
    });
    if (reading.success) cgm.push(reading.data);
  } else if (line.table === "entries") {
    const entry = entrySchema.safeParse(json(row.data));
    if (entry.success) entries.push(entry.data);
  } else if (line.table === "illness_windows") {
    const illness = illnessSchema.safeParse(json(row.data));
    if (illness.success && isSick(illness.data)) {
      try {
        sick.push(illnessBounds(illness.data, Date.now()));
      } catch {
        // A period that can't be placed in time is left out.
      }
    }
  }
}

const options = { group: (now: number) => loggedGroup(entries, now) };
const plain = backtestEstimate(cgm, glucoseEstimate, options);
const sickApart = backtestEstimate(
  cgm,
  (seen, now) => loggedEstimate(seen, now, { entries: [], excluded: sick }),
  options,
);
const logged = backtestEstimate(
  cgm,
  (seen, now) => loggedEstimate(seen, now, { entries, excluded: sick }),
  options,
);
/** Median miss and share in range for each estimate, side by side, at each horizon. */
const table = (label: string, pick: (run: typeof plain) => HorizonScore[] | undefined) => {
  const runs = [plain, sickApart, logged].map(pick);
  if (!runs[0]) return;
  console.log(`\n${label}`);
  console.log("           cases   miss: CGM only / sick apart / with logs   in range (aim 80%)");
  for (const s of runs[0]) {
    const row = runs.map((run) => run?.find((x) => x.minutes === s.minutes));
    const miss = row.map((x) => (x ? String(Math.round(x.medianMiss)) : "—").padStart(3));
    const inRange = row.map((x) => (x ? `${Math.round(x.covered * 100)}%` : "—").padStart(4));
    console.log(
      `${String(s.minutes).padStart(4)} min  ${String(s.cases).padStart(5)}   ${miss.join(" / ")}                    ${inRange.join(" / ")}`,
    );
  }
};
console.log(
  `${cgm.length} readings, ${entries.length} log entries, ${sick.length} sick periods`,
  "\nSick apart: sick periods learned only from sick periods. With logs: also learns from food and rapid-acting insulin logged in the 3 hours before.",
);
table("All", (run) => run.all);
for (const name of ["Nothing logged", "Food only", "Insulin only", "Food and insulin"])
  table(`${name} in the 3 hours before`, (run) => run.byGroup[name]);
console.log(
  "\nThe app shows the CGM-only estimate. Switch only when another misses less in every group, over enough cases, and stays near 80% in range.",
);
