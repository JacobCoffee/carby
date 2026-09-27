import { mock } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createTestDatabase, pgTest } from "./pg-test-helper.mjs";
mock.module("@/app/auth", () => ({
  getCurrentUser: async () => globalThis.exportTestUser ?? null,
}));
mock.module("@/db/raw", () => ({ database: () => globalThis.exportTestDb }));
const { GET: exportBackup } = await import("../app/api/export/route.ts");
const { POST: importPost } = await import("../app/api/import/route.ts");
const { BackupParser, backupLines } = await import("../lib/backup-import.ts");

const SOURCE = "export-source-owner",
  TARGET = "export-target-owner",
  OTHER = "export-other-owner";
const TABLES = [
  "plans",
  "saved_foods",
  "entries",
  "cgm_readings",
  "dexcom_events",
  "dexcom_connections",
  "care_audit",
  "illness_windows",
  "profiles",
  "appointments",
];
const DEADLINE = 5000;
const sha = (text) => createHash("sha256").update(text).digest("hex");

/** A fresh Postgres schema per account environment; `fail` makes matching reads throw. */
async function setup(user, { fail } = {}) {
  const db = await createTestDatabase();
  const failing = (statement) => ({
    bind: (...values) => failing(statement.bind(...values)),
    first: () => statement.first(),
    async all() {
      throw new Error("synthetic storage failure");
    },
    run: () => statement.run(),
  });
  const adapter = fail
    ? {
        prepare: (sql) =>
          fail(sql) ? failing(db.database.prepare(sql)) : db.database.prepare(sql),
        batch: (statements) => db.database.batch(statements),
      }
    : db.database;
  return {
    db,
    adapter,
    user: {
      userId: user,
      displayName: "Synthetic tester",
      email: "tester@example.test",
      fullName: null,
    },
  };
}
function activateTestEnvironment(env) {
  globalThis.exportTestDb = env.adapter;
  globalThis.exportTestUser = env.user;
}
async function teardown(...envs) {
  delete globalThis.exportTestDb;
  delete globalThis.exportTestUser;
  for (const env of envs) await env.db.close();
}
const count = async (env, table, owner) =>
  (await env.db.get(`SELECT COUNT(*)::int AS n FROM "${table}" WHERE owner = $1`, owner)).n;

function within(promise, label) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`${label} did not finish within ${DEADLINE}ms; the export stream stalled`),
        ),
      DEADLINE,
    );
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}
/** Read the real response body chunk by chunk, as a download does. */
async function download() {
  const response = await exportBackup(new Request("https://test.example/api/export"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /application\/x-ndjson/);
  const reader = response.body.getReader(),
    decoder = new TextDecoder(),
    chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  const text = chunks.join("");
  assert.ok(text.endsWith("\n"));
  const lines = text
    .slice(0, -1)
    .split("\n")
    .map((line) => JSON.parse(line));
  return {
    chunks: chunks.filter(Boolean),
    text,
    lines,
    header: lines[0],
    footer: lines.at(-1),
    rows: lines.slice(1, -1),
  };
}
const exported = (label) => within(download(), label);
function tally(rows) {
  const counts = Object.fromEntries(TABLES.map((table) => [table, 0]));
  for (const line of rows) counts[line.table] += 1;
  return counts;
}
function assertComplete(result, expected) {
  assert.equal(result.header.kind, "header");
  assert.equal(result.header.format, "carby-d1-ndjson");
  assert.deepEqual(result.header.tables, TABLES);
  assert.equal(result.footer.kind, "footer");
  assert.ok(result.rows.every((line) => line.kind === "row"));
  const counts = { ...Object.fromEntries(TABLES.map((table) => [table, 0])), ...expected };
  assert.deepEqual(result.footer.counts, counts);
  assert.deepEqual(tally(result.rows), counts);
}

// Synthetic records only.
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
const ids = {
  plan: "10000000-0000-4000-8000-000000000001",
  food: "20000000-0000-4000-8000-000000000002",
  meal: "30000000-0000-4000-8000-000000000003",
  created: "50000000-0000-4000-8000-000000000005",
  edited: "50000000-0000-4000-8000-000000000006",
};
const savedFood = { id: ids.food, name: "Synthetic toast", carbs: 15, serving: 1, unit: "slice" };
const meal = {
  id: ids.meal,
  kind: "food",
  at: "2026-09-20T13:00:00.000Z",
  glucose: null,
  source: null,
  ketones: null,
  carbs: 30,
  foodItems: [
    { name: "Synthetic toast", carbs: 30, amount: 2, unit: "slice", savedFoodId: ids.food },
  ],
  units: null,
  insulin: null,
  meal: "Breakfast",
  note: "",
};
const insert = (env, table, row) =>
  env.db.run(
    `INSERT INTO "${table}" (${Object.keys(row)
      .map((column) => `"${column}"`)
      .join(", ")}) VALUES (${Object.keys(row)
      .map((_, index) => `$${index + 1}`)
      .join(", ")})`,
    ...Object.values(row),
  );
/** The reported migration: one plan, food and entry, two audit rows, every later table empty. */
async function seedMigration(env, owner) {
  await insert(env, "plans", {
    id: ids.plan,
    owner,
    data: JSON.stringify(plan),
    created: "2026-09-01T12:00:00.000Z",
  });
  await insert(env, "saved_foods", {
    id: ids.food,
    owner,
    name: savedFood.name,
    data: JSON.stringify(savedFood),
    updated: "2026-09-01T12:00:00.000Z",
  });
  await insert(env, "entries", {
    id: ids.meal,
    owner,
    at: meal.at,
    data: JSON.stringify(meal),
    plan: JSON.stringify(plan),
    updated: "2026-09-20T13:00:00.000Z",
  });
  await insert(env, "care_audit", {
    id: ids.created,
    owner,
    entry_id: ids.meal,
    actor_id: owner,
    actor_name: "Synthetic tester",
    action: "created",
    before: null,
    after: JSON.stringify(meal),
    at: "2026-09-20T13:00:00.000Z",
  });
  await insert(env, "care_audit", {
    id: ids.edited,
    owner,
    entry_id: ids.meal,
    actor_id: owner,
    actor_name: "Synthetic tester",
    action: "updated",
    before: JSON.stringify(meal),
    after: JSON.stringify({ ...meal, note: "edited" }),
    at: "2026-09-20T13:05:00.000Z",
  });
}
const minute = (index) =>
  new Date(Date.parse("2026-09-10T00:00:00.000Z") + index * 60000).toISOString();
async function seedReadings(env, owner, total) {
  for (let index = 0; index < total; index++) {
    const at = minute(index);
    await insert(env, "cgm_readings", {
      id: sha(owner + "|" + at),
      owner,
      at,
      value: String(80 + (index % 200)),
      source: "Dexcom Share",
    });
  }
}
async function seedGlucose(env, owner, total) {
  for (let index = 0; index < total; index++) {
    const id = `70000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      at = minute(index);
    await insert(env, "entries", {
      id,
      owner,
      at,
      data: JSON.stringify({
        id,
        kind: "glucose",
        at,
        glucose: 110,
        source: "Finger-stick",
        ketones: "Not checked",
        carbs: null,
        units: null,
        insulin: null,
        meal: null,
        note: "",
      }),
      plan: JSON.stringify(plan),
      updated: at,
    });
  }
}

const post = (body) =>
  importPost(
    new Request("https://test.example/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://test.example" },
      body: JSON.stringify(body),
    }),
  );
/** Import exported text the way the browser does: split lines, check, then send bounded parts. */
async function importText(text) {
  const parser = new BackupParser(),
    items = [];
  let header = null,
    footer = null;
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 4096) controller.enqueue(bytes.slice(i, i + 4096));
      controller.close();
    },
  });
  for await (const raw of backupLines(stream)) {
    const line = parser.push(raw);
    if (line.type === "header") header = line.value;
    else if (line.type === "footer") footer = line.value;
    else if (line.type === "row") items.push(line);
  }
  const summary = parser.summary();
  const started = await post({ action: "start", header });
  assert.equal(started.status, 200);
  const { sessionId } = await started.json();
  let index = 0;
  for (let i = 0; i < items.length; i += 250) {
    const group = items.slice(i, i + 250);
    const part = await post({
      action: "chunk",
      sessionId,
      index,
      firstLine: group[0].line,
      rows: group.map((item) => item.upload),
    });
    assert.equal(part.status, 200);
    index++;
  }
  return { summary, response: await post({ action: "finish", sessionId, footer, chunks: index }) };
}

pgTest(
  "the reported migration exports every table through the footer and imports into a new account",
  async () => {
    const source = await setup(SOURCE),
      target = await setup(TARGET);
    try {
      await seedMigration(source, SOURCE);
      await insert(source, "plans", {
        id: "10000000-0000-4000-8000-0000000000ff",
        owner: OTHER,
        data: JSON.stringify(plan),
        created: "2026-09-01T12:00:00.000Z",
      });
      await seedReadings(source, OTHER, 3);
      activateTestEnvironment(source);
      const result = await exported("export of the migration account");
      assertComplete(result, { plans: 1, saved_foods: 1, entries: 1, care_audit: 2 });
      assert.ok(result.rows.every((line) => line.row.owner === SOURCE));
      assert.deepEqual(
        result.rows.filter((line) => line.table === "care_audit").map((line) => line.row.action),
        ["created", "updated"],
      );
      // The browser path reads the whole body with text(); it must reach the footer too.
      const text = await within(
        exportBackup(new Request("https://test.example/api/export")).then((response) =>
          response.text(),
        ),
        "response.text() export",
      );
      assert.equal(JSON.parse(text.trimEnd().split("\n").at(-1)).kind, "footer");

      activateTestEnvironment(target);
      const { summary, response } = await importText(result.text);
      assert.equal(summary.totalRows, 5);
      assert.deepEqual(summary.counts, result.footer.counts);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).total, 5);
      for (const [table, n] of Object.entries({
        plans: 1,
        saved_foods: 1,
        entries: 1,
        care_audit: 2,
        cgm_readings: 0,
        dexcom_events: 0,
        illness_windows: 0,
        profiles: 0,
      }))
        assert.equal(await count(target, table, TARGET), n, table);

      // The restored account exports the same shape again.
      const again = await exported("export of the restored account");
      assertComplete(again, { plans: 1, saved_foods: 1, entries: 1, care_audit: 2 });
    } finally {
      await teardown(source, target);
    }
  },
);

pgTest(
  "a complete plan with meal ratios, an unset snack ratio, no long-acting dose, a correction interval, optional contacts and emergency instructions survives export and import unchanged",
  async () => {
    const source = await setup(SOURCE),
      target = await setup(TARGET);
    try {
      const older = { ...plan, timezone: "America/New_York" };
      const complete = {
        ...plan,
        mealRatios: { breakfast: 18, lunch: 24, dinner: 20, snack: null },
        basal: 0,
        basalTime: "",
        timezone: "Europe/London",
        correctionHours: 3,
        note: "Synthetic complete plan",
        contacts: {
          careTeamName: "Synthetic Example Clinic",
          careTeamPhone: "202-555-0101",
          careTeamHours: "Weekdays 9:00 to 17:00 (synthetic)",
          afterHoursName: "Synthetic <script>alert(1)</script> line",
          afterHoursPhone: "(202) 555-0102",
          afterHoursHours: "Evenings & weekends (synthetic)",
          emergencyPhone: "202-555-0199",
        },
        emergencyInstructions: {
          lowGlucose: "Synthetic step one.\nSynthetic step two.\n\tIndented synthetic note.",
          severeLow: 'Synthetic <script>alert("x")</script> text & more\r\nSecond synthetic line.',
          sickDay: "Synthetic placeholder only.\nNot real guidance.",
        },
      };
      await insert(source, "plans", {
        id: ids.plan,
        owner: SOURCE,
        data: JSON.stringify(older),
        created: "2026-08-01T12:00:00.000Z",
      });
      await insert(source, "plans", {
        id: "10000000-0000-4000-8000-000000000007",
        owner: SOURCE,
        data: JSON.stringify(complete),
        created: "2026-09-01T12:00:00.000Z",
      });
      activateTestEnvironment(source);
      const result = await exported("export of a complete plan");
      assertComplete(result, { plans: 2 });

      activateTestEnvironment(target);
      const { summary, response } = await importText(result.text);
      assert.equal(summary.latestPlan.ready, true);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).planReady, true);
      const restored = await target.db.all(
        "SELECT data, created FROM plans WHERE owner = $1 ORDER BY created",
        TARGET,
      );
      assert.deepEqual(
        restored.map((row) => [JSON.parse(row.data), row.created]),
        [
          [older, "2026-08-01T12:00:00.000Z"],
          [complete, "2026-09-01T12:00:00.000Z"],
        ],
      );
    } finally {
      await teardown(source, target);
    }
  },
);

pgTest("an account with no records exports a header and a zero-count footer", async () => {
  const env = await setup(SOURCE);
  try {
    await seedMigration(env, OTHER);
    activateTestEnvironment(env);
    const result = await exported("export of an empty account");
    assert.equal(result.lines.length, 2);
    assertComplete(result, {});
    const parser = new BackupParser();
    for (const line of result.text.trimEnd().split("\n")) parser.push(line);
    assert.throws(() => parser.summary(), /no records to import/);
  } finally {
    await teardown(env);
  }
});

pgTest("a saved profile survives export and import unchanged", async () => {
  const source = await setup(SOURCE),
    target = await setup(TARGET);
  try {
    const profile = {
      id: "70000000-0000-4000-8000-000000000007",
      name: "Alex",
      role: "parent",
      caregiverName: "Jacob",
    };
    await seedMigration(source, SOURCE);
    await insert(source, "profiles", {
      id: profile.id,
      owner: SOURCE,
      data: JSON.stringify(profile),
      updated: "2026-09-01T12:00:00.000Z",
    });
    activateTestEnvironment(source);
    const result = await exported("export with a profile");
    assertComplete(result, { plans: 1, saved_foods: 1, entries: 1, care_audit: 2, profiles: 1 });

    activateTestEnvironment(target);
    const { response } = await importText(result.text);
    assert.equal(response.status, 200);
    assert.equal(await count(target, "profiles", TARGET), 1);
    const stored = await target.db.get("SELECT data FROM profiles WHERE owner = $1", TARGET);
    assert.deepEqual(JSON.parse(stored.data), profile);
  } finally {
    await teardown(source, target);
  }
});

pgTest("a saved appointment survives export and import unchanged", async () => {
  const source = await setup(SOURCE),
    target = await setup(TARGET);
  try {
    const appointment = {
      id: "70000000-0000-4000-8000-000000000008",
      at: "2026-10-05T15:00:00.000Z",
      title: "Synthetic follow-up",
      location: "Synthetic clinic",
      note: "Bring the logbook.",
    };
    await seedMigration(source, SOURCE);
    await insert(source, "appointments", {
      id: appointment.id,
      owner: SOURCE,
      at: appointment.at,
      data: JSON.stringify(appointment),
      updated: "2026-09-01T12:00:00.000Z",
    });
    activateTestEnvironment(source);
    const result = await exported("export with an appointment");
    assertComplete(result, {
      plans: 1,
      saved_foods: 1,
      entries: 1,
      care_audit: 2,
      appointments: 1,
    });

    activateTestEnvironment(target);
    const { response } = await importText(result.text);
    assert.equal(response.status, 200);
    assert.equal(await count(target, "appointments", TARGET), 1);
    const stored = await target.db.get("SELECT data FROM appointments WHERE owner = $1", TARGET);
    assert.deepEqual(JSON.parse(stored.data), appointment);
  } finally {
    await teardown(source, target);
  }
});

pgTest(
  "rows are paged at 250 across exact and partial page boundaries and empty tables in between",
  async () => {
    const source = await setup(SOURCE),
      target = await setup(TARGET);
    try {
      await insert(source, "plans", {
        id: ids.plan,
        owner: SOURCE,
        data: JSON.stringify(plan),
        created: "2026-09-01T12:00:00.000Z",
      });
      await seedGlucose(source, SOURCE, 500);
      await seedReadings(source, SOURCE, 251);
      await seedReadings(source, OTHER, 3);
      activateTestEnvironment(source);
      const result = await exported("paged export");
      assertComplete(result, { plans: 1, entries: 500, cgm_readings: 251 });
      for (const table of ["entries", "cgm_readings"]) {
        const exportedIds = result.rows
          .filter((line) => line.table === table)
          .map((line) => line.row.id);
        assert.equal(
          new Set(exportedIds).size,
          exportedIds.length,
          `${table} has no repeated rows`,
        );
        assert.deepEqual(
          exportedIds,
          [...exportedIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
          `${table} is exported in key order`,
        );
      }
      for (const chunk of result.chunks)
        assert.ok(chunk.split("\n").length - 1 <= 250, "no chunk holds more than one page");
      assert.ok(
        result.rows.every((line) => line.row.owner === SOURCE),
        "other owners' rows are excluded",
      );

      activateTestEnvironment(target);
      const { summary, response } = await importText(result.text);
      assert.deepEqual(summary.counts, result.footer.counts);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).total, 752);
      assert.equal(await count(target, "entries", TARGET), 500);
      assert.equal(await count(target, "cgm_readings", TARGET), 251);
    } finally {
      await teardown(source, target);
    }
  },
);

pgTest(
  "a storage failure mid-export errors the download instead of ending it with a footer",
  async () => {
    const env = await setup(SOURCE, { fail: (sql) => sql.includes('FROM "dexcom_events"') });
    try {
      await seedMigration(env, SOURCE);
      activateTestEnvironment(env);
      await assert.rejects(within(download(), "failing export"), /synthetic storage failure/);
    } finally {
      await teardown(env);
    }
  },
);

pgTest("signed-out requests are refused", async () => {
  const env = await setup(SOURCE);
  try {
    globalThis.exportTestDb = env.adapter;
    const response = await exportBackup(new Request("https://test.example/api/export"));
    assert.equal(response.status, 401);
  } finally {
    await teardown(env);
  }
});
