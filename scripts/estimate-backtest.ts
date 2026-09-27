#!/usr/bin/env bun
// Score the likely-range estimate against a backup's own CGM history, replayed moment by moment.
// Usage: bun scripts/estimate-backtest.ts path/to/carby-backup.ndjson
// Reads the file only; nothing is written or sent anywhere.
import { readFileSync } from "node:fs";
import { BackupParser } from "../lib/backup-import";
import { cgmSchema, type CgmReading } from "../lib/care";
import { backtestEstimate, type HorizonScore } from "../lib/estimate-backtest";
import { glucoseEstimate } from "../lib/glucose-estimate";

const path = process.argv[2];
if (!path) throw new Error("Usage: bun scripts/estimate-backtest.ts path/to/carby-backup.ndjson");
const parser = new BackupParser();
const cgm: CgmReading[] = [];
for (const text of readFileSync(path, "utf8").split("\n")) {
  if (!text.trim() && parser.line > 0) continue;
  const line = parser.push(text);
  if (line.type !== "row" || line.table !== "cgm_readings") continue;
  const { at, value, source } = line.upload.row;
  const status = value === "High" || value === "Low" ? value : null;
  const reading = cgmSchema.safeParse({ at, value: status ? null : Number(value), status, source });
  if (reading.success) cgm.push(reading.data);
}
const { all, byTrend } = backtestEstimate(cgm, glucoseEstimate);
const row = (s: HorizonScore) =>
  `${String(s.minutes).padStart(4)} min  ${String(s.cases).padStart(5)} cases  miss ${Math.round(s.medianMiss)} (stays the same: ${Math.round(s.stayMiss)})  in range ${Math.round(s.covered * 100)}% (aim 80%)  width ${Math.round(s.medianWidth)}`;
console.log(`${cgm.length} readings\n\nAll`);
for (const score of all) console.log(row(score));
for (const [trend, scores] of Object.entries(byTrend)) {
  console.log(`\n${trend[0].toUpperCase()}${trend.slice(1)}`);
  for (const score of scores) console.log(row(score));
}
