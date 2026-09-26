import { mock } from "bun:test";
import assert from "node:assert/strict";
import { createTestDatabase, pgTest } from "./pg-test-helper.mjs";
mock.module("@/app/auth", () => ({
  getCurrentUser: async () => ({ userId: "illness-test-owner", displayName: "Synthetic tester" }),
}));
mock.module("@/db/raw", () => ({ database: () => globalThis.illnessTestDb }));
const { GET, POST } = await import("../app/api/care/route.ts");
async function setup() {
  const db = await createTestDatabase();
  globalThis.illnessTestDb = db.database;
  return db;
}
async function teardown(db) {
  delete globalThis.illnessTestDb;
  await db.close();
}
const original = {
  id: "11111111-1111-4111-8111-111111111111",
  startDate: "2026-09-22",
  endDate: "2026-09-24",
  timezone: "America/Chicago",
  note: "Synthetic illness",
};
const post = (action, illness) =>
  POST(
    new Request("https://test.example/api/care", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://test.example" },
      body: JSON.stringify({ action, illness }),
    }),
  );
pgTest(
  "illness API saves separate ranges, refreshes GET, audits edits and guards stale deletion",
  async () => {
    const db = await setup();
    try {
      const before = await GET(new Request("https://test.example/api/care"));
      const created = await post("illness", original);
      assert.equal(created.status, 200);
      const { illness } = await created.json();
      assert.ok(illness.revision);
      const after = await GET(new Request("https://test.example/api/care"));
      assert.notEqual(after.headers.get("etag"), before.headers.get("etag"));
      const snapshot = await after.json();
      assert.equal(snapshot.entries.length, 0);
      assert.deepEqual(snapshot.illnessWindows, [illness]);
      const updated = await post("illness", { ...illness, endDate: null });
      assert.equal(updated.status, 200);
      const latest = (await updated.json()).illness;
      assert.notEqual(latest.revision, illness.revision);
      assert.equal((await post("illness", { ...illness, note: "Stale draft" })).status, 409);
      assert.equal((await post("deleteIllness", illness)).status, 409);
      assert.equal((await post("deleteIllness", latest)).status, 200);
      assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM illness_windows")).n, 0);
      assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM care_audit")).n, 3);
      assert.equal((await post("illness", latest)).status, 409);
    } finally {
      await teardown(db);
    }
  },
);
pgTest("illness reads/writes remain owner-scoped and invalid dates never persist", async () => {
  const db = await setup();
  try {
    await db.run(
      "INSERT INTO illness_windows VALUES ($1, $2, $3, $4, $5)",
      original.id,
      "another-owner",
      original.startDate,
      JSON.stringify(original),
      "test",
    );
    assert.equal((await post("illness", original)).status, 403);
    assert.equal((await post("deleteIllness", original)).status, 403);
    const snapshot = await (await GET(new Request("https://test.example/api/care"))).json();
    assert.deepEqual(snapshot.illnessWindows, []);
    assert.equal(
      (
        await post("illness", {
          ...original,
          id: "22222222-2222-4222-8222-222222222222",
          endDate: "2026-09-21",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post("illness", {
          ...original,
          id: "22222222-2222-4222-8222-222222222222",
          startDate: "2011-12-30",
          endDate: "2011-12-31",
          timezone: "Pacific/Apia",
        })
      ).status,
      400,
    );
    assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM care_audit")).n, 0);
  } finally {
    await teardown(db);
  }
});
pgTest(
  "a context period's kind persists through the care API, and an old record without one is illness",
  async () => {
    const db = await setup();
    try {
      const stress = { ...original, id: "33333333-3333-4333-8333-333333333333", kind: "stress" };
      const created = await post("illness", stress);
      assert.equal(created.status, 200);
      const { illness } = await created.json();
      assert.equal(illness.kind, "stress");
      const snapshot = await (await GET(new Request("https://test.example/api/care"))).json();
      assert.deepEqual(
        snapshot.illnessWindows.map((w) => w.kind),
        ["stress"],
      );
      assert.equal((await post("illness", { ...original, kind: "not-a-kind" })).status, 400);
    } finally {
      await teardown(db);
    }
  },
);
pgTest("check-ins save with their period, are audited, and never persist outside it", async () => {
  const db = await setup();
  try {
    const checkIn = {
      id: "33333333-3333-4333-8333-333333333333",
      at: "2026-09-23T15:00:00.000Z",
      temperatureC: 38.5,
      symptoms: ["fever", "cough"],
      vomited: 2,
      fluids: "some",
      eating: "less",
    };
    const created = await post("illness", { ...original, checkIns: [checkIn] });
    assert.equal(created.status, 200);
    const { illness } = await created.json();
    const snapshot = await (await GET(new Request("https://test.example/api/care"))).json();
    assert.deepEqual(snapshot.illnessWindows[0].checkIns, [checkIn]);
    assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM care_audit")).n, 1);
    // A check-in after the period's last day, or a period shortened past one, is refused.
    const outside = {
      ...checkIn,
      id: "44444444-4444-4444-8444-444444444444",
      at: "2026-09-25T15:00:00.000Z",
    };
    assert.equal((await post("illness", { ...illness, checkIns: [checkIn, outside] })).status, 400);
    assert.equal((await post("illness", { ...illness, endDate: "2026-09-22" })).status, 400);
    const stored = JSON.parse((await db.get("SELECT data FROM illness_windows")).data);
    assert.deepEqual(stored.checkIns, [checkIn]);
    assert.equal(stored.endDate, "2026-09-24");
  } finally {
    await teardown(db);
  }
});
