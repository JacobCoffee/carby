import { mock } from "bun:test";
import assert from "node:assert/strict";
import { createTestDatabase, pgTest } from "./pg-test-helper.mjs";
mock.module("@/app/auth", () => ({
  getCurrentUser: async () => ({ userId: "care-test-owner", displayName: "Synthetic tester" }),
}));
mock.module("@/db/raw", () => ({ database: () => globalThis.careTestDb }));
const { GET, POST } = await import("../app/api/care/route.ts");
async function setup() {
  const db = await createTestDatabase();
  globalThis.careTestDb = db.database;
  return db;
}
async function teardown(db) {
  delete globalThis.careTestDb;
  await db.close();
}
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
};
const entry = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "glucose",
  at: "2026-09-25T17:00:00.000Z",
  glucose: 110,
  source: "Finger-stick",
  ketones: "Not checked",
  carbs: null,
  units: null,
  insulin: null,
  meal: null,
  note: "",
};
const get = () => GET(new Request("https://test.example/api/care"));
const post = (body) =>
  POST(
    new Request("https://test.example/api/care", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://test.example" },
      body: JSON.stringify(body),
    }),
  );

pgTest("a new user has no plan and none is invented", async () => {
  const db = await setup();
  try {
    const snapshot = await (await get()).json();
    assert.equal(snapshot.plan, null);
    assert.equal(snapshot.planDraft, undefined);
  } finally {
    await teardown(db);
  }
});

pgTest(
  "an entry cannot be saved before a care plan is configured, and works once one is",
  async () => {
    const db = await setup();
    try {
      const blocked = await post({ action: "entry", entry });
      assert.equal(blocked.status, 400);
      assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM entries")).n, 0);
      assert.equal((await post({ action: "plan", plan })).status, 200);
      const saved = await post({ action: "entry", entry });
      assert.equal(saved.status, 200);
      assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM entries")).n, 1);
      const snapshot = await (await get()).json();
      assert.deepEqual(snapshot.plan, plan);
    } finally {
      await teardown(db);
    }
  },
);

pgTest(
  "a stored plan missing a required field (e.g. correctionHours) loads as unconfigured rather than defaulted",
  async () => {
    const db = await setup();
    try {
      const { correctionHours, ...legacyPlan } = plan;
      void correctionHours;
      await db.run(
        "INSERT INTO plans (id, owner, data, created) VALUES ($1, $2, $3, $4)",
        "legacy-plan",
        "care-test-owner",
        JSON.stringify(legacyPlan),
        new Date().toISOString(),
      );
      const snapshot = await (await get()).json();
      assert.equal(snapshot.plan, null);
      // Setup gets the other saved settings to prefill; the missing one is not filled in.
      assert.deepEqual(snapshot.planDraft, {
        values: legacyPlan,
        missing: ["correctionHours"],
        invalid: [],
      });
      assert.equal(snapshot.history.length, 1);
      assert.deepEqual(snapshot.history[0].plan, legacyPlan);
    } finally {
      await teardown(db);
    }
  },
);

pgTest(
  "completing an imported plan from its draft adds a version and leaves the imported row as it was",
  async () => {
    const db = await setup();
    try {
      const imported = JSON.stringify({
        target: 120,
        factor: 60,
        ratio: 15,
        mealRatios: { breakfast: 18, lunch: 24, dinner: 20, snack: null },
        increment: 0.5,
        rounding: "down",
        basal: 0,
        basalTime: "",
        timezone: "Europe/London",
        note: "Synthetic imported plan",
        lowThreshold: 70,
        ketoneCheckAbove: 180,
        patternRule: { highDays: 3, lowDays: 2 },
      });
      await db.run(
        "INSERT INTO plans (id, owner, data, created) VALUES ($1, $2, $3, $4)",
        "imported-plan",
        "care-test-owner",
        imported,
        "2026-09-01T12:00:00.000Z",
      );
      const { planDraft } = await (await get()).json();
      assert.deepEqual(planDraft.missing, ["correctionHours"]);
      const completed = { ...planDraft.values, correctionHours: 3 };
      assert.equal((await post({ action: "plan", plan: completed })).status, 200);
      const snapshot = await (await get()).json();
      assert.deepEqual(snapshot.plan, completed);
      assert.deepEqual(snapshot.plan.mealRatios, {
        breakfast: 18,
        lunch: 24,
        dinner: 20,
        snack: null,
      });
      assert.equal(snapshot.planDraft, undefined);
      assert.equal(
        (await db.get("SELECT data FROM plans WHERE id = $1", "imported-plan")).data,
        imported,
      );
      assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM plans")).n, 2);
    } finally {
      await teardown(db);
    }
  },
);

pgTest(
  "care contacts persist with the plan, clear without defaults, and stay with their owner",
  async () => {
    const db = await setup();
    try {
      // Synthetic contacts only: reserved 555 numbers and a generic clinic label.
      const contacts = { careTeamName: "Synthetic Clinic", careTeamPhone: "+1 555-0100" };
      await db.run(
        "INSERT INTO plans (id, owner, data, created) VALUES ($1, $2, $3, $4)",
        "other-plan",
        "other-test-owner",
        JSON.stringify({ ...plan, contacts: { emergencyPhone: "555-0199" } }),
        new Date().toISOString(),
      );
      assert.equal((await (await get()).json()).plan, null);
      const unsafe = { ...plan, contacts: { careTeamPhone: "javascript:alert(1)" } };
      assert.equal((await post({ action: "plan", plan: unsafe })).status, 400);
      assert.equal((await post({ action: "plan", plan: { ...plan, contacts } })).status, 200);
      assert.deepEqual((await (await get()).json()).plan.contacts, contacts);
      // Plan versions are ordered by save time, so keep the two saves in distinct milliseconds.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const blank = {
        careTeamName: "",
        careTeamPhone: " ",
        afterHoursPhone: "",
        emergencyPhone: "",
      };
      const cleared = await post({ action: "plan", plan: { ...plan, contacts: blank } });
      assert.equal(cleared.status, 200);
      const snapshot = await (await get()).json();
      assert.deepEqual(snapshot.plan, plan);
      assert.deepEqual(snapshot.history.map((version) => version.plan.contacts).toSorted(), [
        contacts,
        undefined,
      ]);
      const other = await db.get("SELECT data FROM plans WHERE owner = $1", "other-test-owner");
      assert.deepEqual(JSON.parse(other.data).contacts, { emergencyPhone: "555-0199" });
    } finally {
      await teardown(db);
    }
  },
);

pgTest(
  "emergency instructions and contact availability persist, clear without defaults, and stay with their owner",
  async () => {
    const db = await setup();
    try {
      // Synthetic, non-clinical instruction text and contacts only.
      const emergencyInstructions = {
        lowGlucose: "Synthetic low-care note.\n\nSecond synthetic paragraph.",
        severeLow: "Synthetic severe-low note.",
      };
      const contacts = {
        careTeamHours: "Synthetic weekday availability",
        afterHoursName: "Synthetic Answering Line",
      };
      await db.run(
        "INSERT INTO plans (id, owner, data, created) VALUES ($1, $2, $3, $4)",
        "other-plan",
        "other-test-owner",
        JSON.stringify({ ...plan, emergencyInstructions: { sickDay: "Synthetic other note." } }),
        new Date().toISOString(),
      );
      const oversized = { ...plan, emergencyInstructions: { lowGlucose: "x".repeat(4001) } };
      assert.equal((await post({ action: "plan", plan: oversized })).status, 400);
      const saved = await post({
        action: "plan",
        plan: {
          ...plan,
          contacts,
          emergencyInstructions: {
            ...emergencyInstructions,
            lowGlucose: ` ${emergencyInstructions.lowGlucose}\n`,
          },
        },
      });
      assert.equal(saved.status, 200);
      const first = (await (await get()).json()).plan;
      assert.deepEqual(first.emergencyInstructions, emergencyInstructions);
      assert.deepEqual(first.contacts, contacts);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const cleared = await post({
        action: "plan",
        plan: {
          ...plan,
          contacts: { careTeamHours: " ", afterHoursName: "" },
          emergencyInstructions: { lowGlucose: "", severeLow: "\n" },
        },
      });
      assert.equal(cleared.status, 200);
      const snapshot = await (await get()).json();
      assert.deepEqual(snapshot.plan, plan);
      assert.deepEqual(
        snapshot.history.map((version) => version.plan.emergencyInstructions).toSorted(),
        [emergencyInstructions, undefined],
      );
      const other = await db.get("SELECT data FROM plans WHERE owner = $1", "other-test-owner");
      assert.deepEqual(JSON.parse(other.data).emergencyInstructions, {
        sickDay: "Synthetic other note.",
      });
    } finally {
      await teardown(db);
    }
  },
);

pgTest(
  "appointments are saved sorted by time, guard stale edits, and stay with their owner",
  async () => {
    const db = await setup();
    try {
      await post({ action: "plan", plan });
      const later = {
        id: "70000000-0000-4000-8000-000000000007",
        at: "2026-10-10T15:00:00.000Z",
        title: "Endocrinology follow-up",
        location: "Synthetic clinic",
        note: "Bring the logbook.",
      };
      const sooner = {
        id: "80000000-0000-4000-8000-000000000008",
        at: "2026-10-01T15:00:00.000Z",
        title: "Dietitian check-in",
        note: "",
      };
      assert.equal((await post({ action: "saveAppointment", appointment: later })).status, 200);
      const savedSooner = await post({ action: "saveAppointment", appointment: sooner });
      assert.equal(savedSooner.status, 200);
      const { appointment } = await savedSooner.json();
      assert.ok(appointment.revision);
      const snapshot = await (await get()).json();
      assert.deepEqual(
        snapshot.appointments.map((a) => a.id),
        [sooner.id, later.id],
      );
      const stale = await post({
        action: "saveAppointment",
        appointment: { ...sooner, note: "Stale edit" },
      });
      assert.equal(stale.status, 409);
      const updated = await post({
        action: "saveAppointment",
        appointment: { ...appointment, note: "Bring recent glucose logs." },
      });
      assert.equal(updated.status, 200);
      assert.equal((await post({ action: "deleteAppointment", id: sooner.id })).status, 200);
      assert.equal((await post({ action: "deleteAppointment", id: sooner.id })).status, 404);
      const final = await (await get()).json();
      assert.deepEqual(
        final.appointments.map((a) => a.id),
        [later.id],
      );
      assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM appointments")).n, 1);
    } finally {
      await teardown(db);
    }
  },
);

pgTest(
  "the snapshot names the owner's newest sensor and how fresh their Clarity data is",
  async () => {
    const db = await setup();
    try {
      assert.equal((await post({ action: "plan", plan })).status, 200);
      const before = await (await get()).json();
      assert.equal(before.sensor, null);
      assert.equal(before.clarity, null, "no Clarity connection, no freshness");
      const sensor = (owner, id, firstAt, lastAt) =>
        db.run(
          "INSERT INTO sensor_sessions (owner, sensor_id, source, first_at, last_at, updated) VALUES ($1, $2, $3, $4, $5, $6)",
          owner,
          id,
          "iOS G7",
          firstAt,
          lastAt,
          lastAt,
        );
      await sensor("care-test-owner", "OLDER", "2026-09-10T00:00:00Z", "2026-09-20T00:00:00Z");
      await sensor("care-test-owner", "NEWER", "2026-09-20T01:00:00Z", "2026-09-25T12:00:00Z");
      await sensor("other-test-owner", "FOREIGN", "2026-09-24T00:00:00Z", "2026-09-26T00:00:00Z");
      const reading = (owner, at, source) =>
        db.run(
          "INSERT INTO cgm_readings (id, owner, at, value, source) VALUES ($1, $2, $3, $4, $5)",
          crypto.randomUUID(),
          owner,
          at,
          "120",
          source,
        );
      await reading("care-test-owner", "2026-09-25T12:00:00.000Z", "Dexcom Clarity");
      // A newer Share point and another owner's newer Clarity point are not Clarity freshness.
      await reading("care-test-owner", "2026-09-26T12:00:00.000Z", "Dexcom Share");
      await reading("other-test-owner", "2026-09-26T13:00:00.000Z", "Dexcom Clarity");
      await db.run(
        "INSERT INTO clarity_connections (owner, credentials, subject_id, subject_name, expires_at, auto_sync, monthly_reports, synced_through, last_sync, last_attempt_at, last_error, updated) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
        "care-test-owner",
        "sealed",
        "subject",
        "Synthetic tester",
        "2026-10-26T00:00:00Z",
        true,
        "[]",
        "2026-09-25",
        "2026-09-26T06:00:00Z",
        "2026-09-26T18:00:00Z",
        "Share code expired.",
        "2026-09-26T18:00:00Z",
      );
      const after = await (await get()).json();
      assert.deepEqual(after.sensor, {
        sensorId: "NEWER",
        source: "iOS G7",
        firstAt: "2026-09-20T01:00:00Z",
        lastAt: "2026-09-25T12:00:00Z",
      });
      assert.deepEqual(after.clarity, {
        lastSync: "2026-09-26T06:00:00Z",
        lastError: "Share code expired.",
        latestAt: "2026-09-25T12:00:00.000Z",
      });
    } finally {
      await teardown(db);
    }
  },
);
