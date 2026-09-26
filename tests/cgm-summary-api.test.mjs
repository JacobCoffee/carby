import { mock } from "bun:test";
import assert from "node:assert/strict";
import { createTestDatabase, pgTest } from "./pg-test-helper.mjs";

/** app/api/cgm/summary against a real Postgres. Every value is synthetic. */

const OWNER = "github:12345",
  OTHER = "github:99999";
mock.module("@/app/auth", () => ({
  getCurrentUser: async () => ({ userId: globalThis.summaryTestOwner, displayName: "Tester" }),
}));
mock.module("@/db/raw", () => ({ database: () => globalThis.summaryTestDb }));
const { GET } = await import("../app/api/cgm/summary/route.ts");

const plan = {
  target: 140,
  factor: 80,
  ratio: 40,
  increment: 0.5,
  rounding: "down",
  basal: 6,
  basalTime: "20:00",
  timezone: "America/Chicago",
  correctionHours: 4,
  note: "Synthetic plan",
  lowThreshold: 70,
  ketoneCheckAbove: 180,
  patternRule: { highDays: 3, lowDays: 2 },
  glucoseRanges: { veryLow: 54, low: 90, high: 180, veryHigh: 250 },
};

async function setup() {
  const db = await createTestDatabase();
  globalThis.summaryTestDb = db.database;
  globalThis.summaryTestOwner = OWNER;
  await db.run(
    "INSERT INTO plans (id, owner, data, created) VALUES ($1, $2, $3, $4)",
    "plan-1",
    OWNER,
    JSON.stringify(plan),
    "2026-09-01T00:00:00.000Z",
  );
  return db;
}
async function teardown(db) {
  delete globalThis.summaryTestDb;
  delete globalThis.summaryTestOwner;
  await db.close();
}
const reading = (db, owner, at, value, source = "Dexcom Share") =>
  db.run(
    "INSERT INTO cgm_readings (id, owner, at, value, source) VALUES ($1, $2, $3, $4, $5)",
    crypto.randomUUID(),
    owner,
    at,
    value,
    source,
  );
const get = (query) => GET(new Request(`https://test.example/api/cgm/summary?${query}`));

pgTest(
  "the summary covers the owner's readings in local dates, with sensors and settings",
  async () => {
    const db = await setup();
    try {
      // Sep 20 in Chicago runs 05:00 to 05:00 UTC. 100 for 20 minutes, then 200 for 10.
      for (const [minute, value] of [
        [0, "100"],
        [5, "100"],
        [10, "100"],
        [15, "100"],
        [20, "200"],
        [25, "200"],
        [30, "200"],
      ])
        await reading(
          db,
          OWNER,
          new Date(Date.parse("2026-09-20T12:00:00Z") + minute * 60000).toISOString(),
          value,
        );
      // A number at the same instant wins over a High status.
      await reading(db, OWNER, "2026-09-20T12:30:00.000Z", "High", "Dexcom Share");
      // Outside the dates, and another owner's reading, are left out.
      await reading(db, OWNER, "2026-09-20T04:59:00.000Z", "300");
      await reading(db, OTHER, "2026-09-20T12:02:00.000Z", "50");
      await db.run(
        "INSERT INTO sensor_sessions (owner, sensor_id, source, first_at, last_at, updated) VALUES ($1, $2, $3, $4, $5, $6), ($7, $8, $9, $10, $11, $12)",
        OWNER,
        "SENSOR1",
        "iOS G7",
        "2026-09-18T00:00:00.000Z",
        "2026-09-20T12:30:00.000Z",
        "2026-09-20T12:30:00.000Z",
        OTHER,
        "SENSOR9",
        null,
        "2026-09-18T00:00:00.000Z",
        "2026-09-20T12:30:00.000Z",
        "2026-09-20T12:30:00.000Z",
      );
      const response = await get("start=2026-09-20&end=2026-09-20");
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      const summary = await response.json();
      assert.equal(summary.metrics.readings, 7);
      assert.equal(summary.metrics.observedMinutes, 30);
      assert.deepEqual(summary.metrics.levels, {
        veryLow: 0,
        low: 0,
        inRange: 66.7,
        high: 33.3,
        veryHigh: 0,
      });
      // The plan's own 90–180 range adds its figure alongside the standard levels.
      assert.equal(summary.metrics.inPlanRange, 66.7);
      assert.deepEqual(
        summary.daily.map((d) => d.day),
        ["2026-09-20"],
      );
      assert.equal(summary.agp.length, 96);
      assert.deepEqual(
        summary.sensors.map((s) => s.sensorId),
        ["SENSOR1"],
      );
      assert.equal(summary.device, null);
    } finally {
      await teardown(db);
    }
  },
);

pgTest("the summary refuses ranges it cannot cover", async () => {
  const db = await setup();
  try {
    for (const query of [
      "start=2026-09-20",
      "start=2026-09-21&end=2026-09-20",
      "start=2025-01-01&end=2026-09-20",
      "start=2026-02-30&end=2026-03-01",
      "start=2099-01-01&end=2099-01-02",
    ])
      assert.equal((await get(query)).status, 400, query);
    globalThis.summaryTestOwner = OTHER;
    assert.equal((await get("start=2026-09-20&end=2026-09-20")).status, 409);
  } finally {
    await teardown(db);
  }
});
