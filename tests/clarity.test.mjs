import { test } from "bun:test";
import assert from "node:assert/strict";
import { parseClarity } from "../lib/clarity.ts";
const header =
  "Timestamp (YYYY-MM-DDThh:mm:ss),Event Type,Event Subtype,Patient Info,Glucose Value (mg/dL),Insulin Value (u),Carb Value (grams)";

test("Clarity retains seconds, calibrations, status and dated insulin/carbohydrate events", () => {
  const csv = [
    header,
    ",FirstName,,Sample,,,",
    ",LastName,,Person,,,",
    "2026-09-24T10:14:47,EGV,,,315,,",
    "2026-09-24T10:19:51,EGV,,,High,,",
    "2026-09-24T10:20:12,Calibration,Meter check,,280,,",
    "2026-09-24T10:22:01,Insulin,, , ,2.5,",
    "2026-09-24T10:24:30,Carbs,, , ,,34",
  ].join("\n");
  const result = parseClarity(csv, "America/Chicago");
  assert.equal(result.identity.firstName, "Sample");
  assert.equal(result.identity.lastName, "Person");
  assert.deepEqual(
    result.readings.map(({ at, value, status }) => ({ at, value, status })),
    [
      { at: "2026-09-24T15:14:47.000Z", value: 315, status: null },
      { at: "2026-09-24T15:19:51.000Z", value: null, status: "High" },
    ],
  );
  assert.equal(result.events[0].type, "Calibration");
  assert.equal(result.events[0].value, 280);
  assert.match(result.events[1].details, /2\.5 units insulin/);
  assert.match(result.events[2].details, /34 g carbohydrate/);
  assert.equal(result.skipped, 0);
});

test("Clarity accepts any single internally consistent identity", () => {
  const csv = [
    header,
    ",FirstName,,Different,,,",
    ",LastName,,Identity,,,",
    "2026-09-24T10:14:47,EGV,,,315,,",
  ].join("\n");
  const result = parseClarity(csv, "America/Chicago");
  assert.equal(result.identity.firstName, "Different");
  assert.equal(result.identity.lastName, "Identity");
});

test("Clarity fails closed for contradictory identity metadata within one file", () => {
  const conflicting = [
    header,
    ",FirstName,,Sample,,,",
    ",FirstName,,Other,,,",
    "2026-09-24T10:14:47,EGV,,,315,,",
  ].join("\n");
  assert.throws(() => parseClarity(conflicting, "America/Chicago"), /conflicting patient identity/);
});

test("Clarity has no identity to verify against, ignores undated metadata, and counts invalid dated rows", () => {
  const csv = [
    header,
    ",Alert,Signal Loss,,,,",
    "2026-09-24T10:14:47,EGV,,,315,,",
    "not a timestamp,EGV,,,300,,",
  ].join("\n");
  const result = parseClarity(csv, "America/Chicago");
  assert.equal(result.identity.firstName, null);
  assert.equal(result.events.length, 0);
  assert.equal(result.readings.length, 1);
  assert.equal(result.skipped, 1);
});

test("Clarity skips timestamps impossible in the configured time zone", () => {
  const csv = [header, ",FirstName,,Sample,,,", "2026-03-08T02:30:47,EGV,,,315,,"].join("\n");
  const result = parseClarity(csv, "America/Chicago");
  assert.equal(result.readings.length, 0);
  assert.equal(result.skipped, 1);
});

test("Clarity keeps undated device and alert settings and groups readings by transmitter", () => {
  const csv = [
    "Index,Timestamp (YYYY-MM-DDThh:mm:ss),Event Type,Event Subtype,Patient Info,Device Info,Source Device ID,Glucose Value (mg/dL),Insulin Value (u),Carb Value (grams),Duration (hh:mm:ss),Glucose Rate of Change (mg/dL/min),Transmitter Time (Long Integer),Transmitter ID",
    "1,,Device,,,Dexcom G7,iOS G7,,,,,,,",
    "2,,Sensor,,,G7,iOS G7,,,,,,,",
    "3,,Alert,Urgent Low,,,iOS G7,55,,,,,,",
    "4,,Alert,Rise,,,iOS G7,,,,,3,,",
    "5,,Alert,Signal Loss,,,iOS G7,,,,00:20:00,,,",
    "6,2026-09-24T10:19:47,EGV,,,,iOS G7,150,,,,,300,SENSOR2",
    "7,2026-09-20T08:00:00,EGV,,,,iOS G7,High,,,,,900,SENSOR1",
    "8,2026-09-24T10:14:47,EGV,,,,iOS G7,140,,,,,0,SENSOR2",
  ].join("\n");
  const result = parseClarity(csv, "America/Chicago");
  assert.equal(result.events.length, 0);
  assert.deepEqual(result.device, {
    model: "Dexcom G7",
    sensor: "G7",
    alerts: [
      { kind: "Urgent Low", glucose: 55, rate: null, minutes: null },
      { kind: "Rise", glucose: null, rate: 3, minutes: null },
      { kind: "Signal Loss", glucose: null, rate: null, minutes: 20 },
    ],
  });
  assert.deepEqual(result.sensors, [
    {
      id: "SENSOR1",
      source: "iOS G7",
      firstAt: "2026-09-20T13:00:00.000Z",
      lastAt: "2026-09-20T13:00:00.000Z",
      readings: 1,
    },
    {
      id: "SENSOR2",
      source: "iOS G7",
      firstAt: "2026-09-24T15:14:47.000Z",
      lastAt: "2026-09-24T15:19:47.000Z",
      readings: 2,
    },
  ]);
  assert.equal(
    parseClarity([header, "2026-09-24T10:14:47,EGV,,,315,,"].join("\n"), "UTC").device,
    null,
  );
});
