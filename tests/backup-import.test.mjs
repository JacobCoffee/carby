import { mock, test } from "bun:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createTestDatabase, pgTest } from "./pg-test-helper.mjs";
mock.module("@/app/auth", () => ({
  getCurrentUser: async () => globalThis.importTestUser ?? null,
}));
mock.module("@/db/raw", () => ({ database: () => globalThis.importTestDb }));
const { GET, POST } = await import("../app/api/import/route.ts");
const care = await import("../app/api/care/route.ts");
const {
  BackupParser,
  BackupError,
  backupLines,
  BACKUP_TABLES,
  PRE_APPOINTMENTS_BACKUP_TABLES,
  PRE_PROFILE_BACKUP_TABLES,
} = await import("../lib/backup-import.ts");

const OWNER = "import-test-owner",
  SOURCE = "source-test-owner",
  OTHER = "other-test-owner";
const sha = (text) => createHash("sha256").update(text).digest("hex");
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
];
const LIVE = [
  "plans",
  "saved_foods",
  "entries",
  "cgm_readings",
  "dexcom_events",
  "dexcom_connections",
  "care_audit",
  "illness_windows",
  "profiles",
];

async function setup() {
  const db = await createTestDatabase();
  globalThis.importTestUser = {
    userId: OWNER,
    displayName: "Synthetic tester",
    email: "tester@example.test",
    fullName: null,
  };
  globalThis.importTestDb = db.database;
  return db;
}
async function teardown(db) {
  delete globalThis.importTestDb;
  delete globalThis.importTestUser;
  await db.close();
}
const rows = async (db, table, owner) =>
  owner
    ? (await db.get(`SELECT COUNT(*)::int AS n FROM "${table}" WHERE owner = $1`, owner)).n
    : (await db.get(`SELECT COUNT(*)::int AS n FROM "${table}"`)).n;
const liveTotal = async (db) => {
  let sum = 0;
  for (const table of LIVE) sum += await rows(db, table);
  return sum;
};
const post = (body, headers = {}) =>
  POST(
    new Request("https://test.example/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://test.example", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

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
  dose: "40000000-0000-4000-8000-000000000004",
  audit: "50000000-0000-4000-8000-000000000005",
  illness: "60000000-0000-4000-8000-000000000006",
  basal: "80000000-0000-4000-8000-000000000008",
  doseAudit: "90000000-0000-4000-8000-000000000009",
  profile: "a0000000-0000-4000-8000-00000000000a",
  appointment: "c0000000-0000-4000-8000-00000000000c",
};
function records(owner = SOURCE, { legacy = false } = {}) {
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
  const dose = {
    id: ids.dose,
    kind: "insulin",
    at: "2026-09-20T13:01:00.000Z",
    glucose: null,
    source: null,
    ketones: null,
    carbs: null,
    units: 0.5,
    insulin: "Rapid-acting",
    purpose: "Meal only",
    calculation: {
      mode: "Carbs",
      carbs: 30,
      glucose: null,
      source: null,
      foodEntryIds: [ids.meal],
      calculatedUnits: 0.5,
      target: 140,
      factor: 80,
      ratio: 40,
    },
    meal: null,
    note: "",
  };
  const event = {
    at: "2026-09-20T12:00:00.000Z",
    type: "Calibration",
    details: "",
    value: 110,
    source: "Dexcom Clarity",
  };
  const illness = {
    id: ids.illness,
    startDate: "2026-09-10",
    endDate: "2026-09-12",
    timezone: "America/Chicago",
    note: "Synthetic illness",
  };
  const list = [
    [
      "plans",
      { id: ids.plan, owner, data: JSON.stringify(plan), created: "2026-09-01T12:00:00.000Z" },
    ],
    [
      "saved_foods",
      {
        id: ids.food,
        owner,
        name: savedFood.name,
        data: JSON.stringify(savedFood),
        updated: "2026-09-01T12:00:00.000Z",
      },
    ],
    [
      "entries",
      {
        id: ids.meal,
        owner,
        at: meal.at,
        data: JSON.stringify(meal),
        plan: JSON.stringify(plan),
        updated: "2026-09-20T13:00:00.000Z",
      },
    ],
    [
      "entries",
      {
        id: ids.dose,
        owner,
        at: dose.at,
        data: JSON.stringify(dose),
        plan: JSON.stringify(plan),
        updated: "2026-09-20T13:01:00.000Z",
      },
    ],
    [
      "cgm_readings",
      {
        id: sha(owner + "|2026-09-20T12:55:00.000Z"),
        owner,
        at: "2026-09-20T12:55:00.000Z",
        value: "120",
        source: "Dexcom Share",
      },
    ],
    [
      "cgm_readings",
      {
        id: sha(owner + "|2026-09-20T13:00:00.000Z"),
        owner,
        at: "2026-09-20T13:00:00.000Z",
        value: "High",
        source: "Dexcom Share",
      },
    ],
    [
      "dexcom_events",
      {
        id: sha(`${owner}|${event.at}|${event.type}|${event.details}|${event.value}`),
        owner,
        at: event.at,
        data: JSON.stringify(event),
      },
    ],
    [
      "dexcom_connections",
      {
        owner,
        credentials: "synthetic-sealed-credential",
        last_sync: "2026-09-20T13:00:00.000Z",
        latest_reading_at: null,
        last_attempt_at: null,
        last_error: null,
        updated: "2026-09-20T13:00:00.000Z",
      },
    ],
    [
      "care_audit",
      {
        id: ids.audit,
        owner,
        entry_id: ids.meal,
        actor_id: owner,
        actor_name: "Synthetic tester",
        action: "created",
        before: null,
        after: JSON.stringify(meal),
        at: "2026-09-20T13:00:00.000Z",
      },
    ],
  ];
  if (!legacy)
    list.push([
      "illness_windows",
      {
        id: ids.illness,
        owner,
        start_date: illness.startDate,
        data: JSON.stringify(illness),
        updated: "2026-09-12T12:00:00.000Z",
      },
    ]);
  return list;
}
function backup(
  list = records(),
  { tables = TABLES, counts, footer = true, format = "carby-d1-ndjson" } = {},
) {
  const tally = Object.fromEntries(tables.map((table) => [table, 0]));
  for (const [table] of list) tally[table] += 1;
  const lines = [
    JSON.stringify({
      kind: "header",
      format,
      version: 1,
      exportedAt: "2026-09-21T00:00:00.000Z",
      tables,
    }),
    ...list.map(([table, row]) => JSON.stringify({ kind: "row", table, row })),
  ];
  if (footer)
    lines.push(
      JSON.stringify({
        kind: "footer",
        counts: counts ?? tally,
        completedAt: "2026-09-21T00:00:01.000Z",
      }),
    );
  return lines;
}
function parse(lines) {
  const parser = new BackupParser();
  let header = null,
    footer = null;
  const items = [];
  for (const text of lines) {
    const line = parser.push(text);
    if (line.type === "header") header = line.value;
    else if (line.type === "footer") footer = line.value;
    else if (line.type === "row") items.push(line);
  }
  return { header, footer, items, summary: parser.summary() };
}
/** Drive the route as the browser does: start, bounded parts, finish. */
async function upload(lines, { chunkRows = 250, beforeFinish, extra = {} } = {}) {
  const { header, footer, items } = parse(lines);
  const started = await post({ action: "start", header, ...extra });
  if (started.status !== 200) return { response: started };
  const { sessionId } = await started.json();
  let index = 0;
  for (let i = 0; i < items.length; i += chunkRows) {
    const group = items.slice(i, i + chunkRows);
    const response = await post({
      action: "chunk",
      sessionId,
      index,
      firstLine: group[0].line,
      rows: group.map((item) => item.upload),
    });
    if (response.status !== 200) return { response, sessionId };
    index++;
  }
  await beforeFinish?.();
  return {
    response: await post({ action: "finish", sessionId, footer, chunks: index, ...extra }),
    sessionId,
    chunks: index,
    footer,
  };
}

pgTest(
  "a current backup restores every table under the signed-in owner with links, timestamps and history intact",
  async () => {
    const db = await setup();
    try {
      const { response } = await upload(backup(), { chunkRows: 3 });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.total, 9);
      assert.equal(result.planReady, true);
      assert.equal(result.connectionSkipped, true);
      for (const table of [
        "plans",
        "saved_foods",
        "care_audit",
        "illness_windows",
        "dexcom_events",
      ])
        assert.equal(await rows(db, table, OWNER), 1, table);
      assert.equal(await rows(db, "entries", OWNER), 2);
      assert.equal(await rows(db, "cgm_readings", OWNER), 2);
      // The imported owner is never trusted: nothing keeps the source owner, and no credential is stored.
      for (const table of LIVE) assert.equal(await rows(db, table, SOURCE), 0, table);
      assert.equal(await rows(db, "dexcom_connections"), 0);
      assert.equal(
        (
          await db.get(
            "SELECT COUNT(*)::int AS n FROM import_rows WHERE payload::text LIKE '%synthetic-sealed-credential%'",
          )
        ).n,
        0,
      );
      assert.equal(await rows(db, "import_rows"), 0);
      const dose = JSON.parse(
        (await db.get("SELECT data FROM entries WHERE id = $1", ids.dose)).data,
      );
      assert.deepEqual(dose.calculation.foodEntryIds, [ids.meal]);
      const meal = await db.get("SELECT at, data FROM entries WHERE id = $1", ids.meal);
      assert.equal(meal.at, "2026-09-20T13:00:00.000Z");
      assert.equal(JSON.parse(meal.data).foodItems[0].savedFoodId, ids.food);
      const audit = await db.get(
        'SELECT entry_id, actor_id, "after", at FROM care_audit WHERE id = $1',
        ids.audit,
      );
      assert.equal(audit.entry_id, ids.meal);
      assert.equal(audit.at, "2026-09-20T13:00:00.000Z");
      assert.equal(JSON.parse(audit.after).id, ids.meal);
      // Owner-derived reading IDs follow the new owner so later Dexcom syncs merge with them.
      assert.ok(
        await db.get(
          "SELECT 1 FROM cgm_readings WHERE id = $1",
          sha(OWNER + "|2026-09-20T12:55:00.000Z"),
        ),
      );
      assert.ok(
        await db.get(
          "SELECT 1 FROM dexcom_events WHERE id = $1",
          sha(`${OWNER}|2026-09-20T12:00:00.000Z|Calibration||110`),
        ),
      );
      const snapshot = await (await care.GET(new Request("https://test.example/api/care"))).json();
      assert.deepEqual(snapshot.plan, plan);
      assert.equal(snapshot.entries.length, 2);
      assert.equal(snapshot.illnessWindows.length, 1);
    } finally {
      await teardown(db);
    }
  },
);

pgTest("a seven-table backup from before illness tracking imports", async () => {
  const db = await setup();
  try {
    const { response } = await upload(
      backup(records(SOURCE, { legacy: true }), {
        tables: TABLES.filter((table) => table !== "illness_windows" && table !== "profiles"),
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(await rows(db, "entries", OWNER), 2);
    assert.equal(await rows(db, "illness_windows"), 0);
  } finally {
    await teardown(db);
  }
});

pgTest("an eight-table backup without profiles still parses", async () => {
  const parsed = parse(backup(records(), { tables: PRE_PROFILE_BACKUP_TABLES }));
  assert.deepEqual(parsed.header.tables, [...PRE_PROFILE_BACKUP_TABLES]);
  assert.equal(parsed.summary.importRows, 9);
  const db = await setup();
  try {
    const { response } = await upload(backup(records(), { tables: PRE_PROFILE_BACKUP_TABLES }));
    assert.equal(response.status, 200);
    assert.equal(await rows(db, "entries", OWNER), 2);
    assert.equal(await rows(db, "profiles"), 0);
  } finally {
    await teardown(db);
  }
});

pgTest("a nine-table backup with a profile round-trips", async () => {
  const profile = { id: ids.profile, name: "Alex", role: "parent" };
  const list = [
    ...records(),
    [
      "profiles",
      {
        id: ids.profile,
        owner: SOURCE,
        data: JSON.stringify(profile),
        updated: "2026-09-21T00:00:00.000Z",
      },
    ],
  ];
  const parsed = parse(backup(list));
  assert.deepEqual(parsed.header.tables, [...TABLES]);
  assert.equal(parsed.summary.counts.profiles, 1);
  const db = await setup();
  try {
    const { response } = await upload(backup(list));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.total, 10);
    assert.equal(await rows(db, "profiles", OWNER), 1);
    const stored = await db.get("SELECT data FROM profiles WHERE owner = $1", OWNER);
    assert.deepEqual(JSON.parse(stored.data), profile);
    const snapshot = await (await care.GET(new Request("https://test.example/api/care"))).json();
    assert.deepEqual(snapshot.profile, profile);
  } finally {
    await teardown(db);
  }
});

pgTest("a nine-table backup from before appointment tracking still imports", async () => {
  const parsed = parse(backup(records(), { tables: PRE_APPOINTMENTS_BACKUP_TABLES }));
  assert.deepEqual(parsed.header.tables, [...PRE_APPOINTMENTS_BACKUP_TABLES]);
  const db = await setup();
  try {
    const { response } = await upload(
      backup(records(), { tables: PRE_APPOINTMENTS_BACKUP_TABLES }),
    );
    assert.equal(response.status, 200);
    assert.equal(await rows(db, "entries", OWNER), 2);
    assert.equal(await rows(db, "appointments"), 0);
  } finally {
    await teardown(db);
  }
});

pgTest(
  "a backup with an appointment round-trips, and a replacement removes the prior appointment",
  async () => {
    const db = await setup();
    try {
      // A pre-existing appointment that a replacement import should remove.
      await db.run(
        "INSERT INTO appointments (id, owner, at, data, updated) VALUES ($1, $2, $3, $4, $5)",
        "old-appointment",
        OWNER,
        "2026-08-01T15:00:00.000Z",
        "{}",
        "2026-08-01T15:00:00.000Z",
      );
      const appointment = {
        id: ids.appointment,
        at: "2026-10-05T15:00:00.000Z",
        title: "Synthetic follow-up",
        location: "Synthetic clinic",
        note: "Bring the logbook.",
      };
      const list = [
        ...records(),
        [
          "appointments",
          {
            id: ids.appointment,
            owner: SOURCE,
            at: appointment.at,
            data: JSON.stringify(appointment),
            updated: "2026-09-21T00:00:00.000Z",
          },
        ],
      ];
      const parsed = parse(backup(list, { tables: BACKUP_TABLES }));
      assert.deepEqual(parsed.header.tables, [...BACKUP_TABLES]);
      assert.equal(parsed.summary.counts.appointments, 1);
      const { response } = await upload(backup(list, { tables: BACKUP_TABLES }), {
        extra: REPLACE,
      });
      assert.equal(response.status, 200);
      assert.equal(await rows(db, "appointments", OWNER), 1);
      assert.equal(await count(db, "appointments", "old-appointment"), 0);
      const stored = await db.get("SELECT data FROM appointments WHERE id = $1", ids.appointment);
      assert.deepEqual(JSON.parse(stored.data), appointment);
      const snapshot = await (await care.GET(new Request("https://test.example/api/care"))).json();
      assert.deepEqual(snapshot.appointments, [appointment]);
    } finally {
      await teardown(db);
    }
  },
);

pgTest("a second profile row in one backup is refused", async () => {
  const secondId = "b0000000-0000-4000-8000-00000000000b";
  const list = [
    ...records(),
    [
      "profiles",
      {
        id: ids.profile,
        owner: SOURCE,
        data: JSON.stringify({ id: ids.profile, name: "Alex", role: "parent" }),
        updated: "2026-09-21T00:00:00.000Z",
      },
    ],
    [
      "profiles",
      {
        id: secondId,
        owner: SOURCE,
        data: JSON.stringify({ id: secondId, name: "Someone else", role: "self" }),
        updated: "2026-09-21T00:00:00.000Z",
      },
    ],
  ];
  assert.throws(() => parse(backup(list)), /second profile/);
});

pgTest(
  "an older plan missing current settings is kept as history without opening the dashboard",
  async () => {
    const db = await setup();
    try {
      const { correctionHours, ...older } = plan;
      void correctionHours;
      const list = records().map(([table, row]) =>
        table === "plans" ? [table, { ...row, data: JSON.stringify(older) }] : [table, row],
      );
      const { response } = await upload(backup(list));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).planReady, false);
      assert.equal(await rows(db, "plans", OWNER), 1);
      assert.equal(
        (await (await care.GET(new Request("https://test.example/api/care"))).json()).plan,
        null,
      );
    } finally {
      await teardown(db);
    }
  },
);

pgTest(
  "a plan version or entry snapshot without a target, correction factor or carb ratio is refused in the browser and on the server",
  async () => {
    const db = await setup();
    try {
      const { ratio, ...noRatio } = plan;
      void ratio;
      const { factor, ...noFactor } = plan;
      void factor;
      const withPlan = (data) =>
        records().map(([table, row]) =>
          table === "plans" ? [table, { ...row, data: JSON.stringify(data) }] : [table, row],
        );
      assert.throws(() => parse(backup(withPlan(noRatio))), /care plan version/);
      assert.throws(
        () =>
          parse(
            backup(
              records().map(([table, row]) =>
                table === "entries"
                  ? [table, { ...row, plan: JSON.stringify(noFactor) }]
                  : [table, row],
              ),
            ),
          ),
        /log entry/,
      );
      const { header, items } = parse(backup());
      const { sessionId } = await (await post({ action: "start", header })).json();
      const response = await post({
        action: "chunk",
        sessionId,
        index: 0,
        firstLine: 2,
        rows: items.map((item) =>
          item.table === "plans"
            ? { ...item.upload, row: { ...item.upload.row, data: JSON.stringify(noRatio) } }
            : item.upload,
        ),
      });
      assert.equal(response.status, 422);
      assert.match((await response.json()).error, /care plan version/);
      assert.equal(await liveTotal(db), 0);
      assert.equal(await rows(db, "import_rows"), 0);
    } finally {
      await teardown(db);
    }
  },
);

// A synthetic export from before the rename: another project name in the format, insulin
// recorded by product, and plans saved before the correction interval existed.
const PRIOR_FORMAT = "previous-care-d1-ndjson";
const { correctionHours: _unset, ...priorPlan } = plan;
void _unset;
function priorEntries(owner = SOURCE) {
  const dose = JSON.parse(records(owner).find(([, row]) => row.id === ids.dose)[1].data);
  const rapid = {
    ...dose,
    insulin: "Humalog",
    note: "Humalog pen primed first; Semglee later",
    legacyTag: "synthetic extra field",
  };
  const basal = {
    id: ids.basal,
    kind: "insulin",
    at: "2026-09-20T02:00:00.000Z",
    glucose: null,
    source: null,
    ketones: null,
    carbs: null,
    units: 6,
    insulin: "Semglee",
    purpose: null,
    meal: null,
    note: "",
  };
  return { rapid, basal };
}
function priorRecords(owner = SOURCE, { legacy = false } = {}) {
  const { rapid, basal } = priorEntries(owner),
    planText = JSON.stringify(priorPlan);
  return [
    ...records(owner, { legacy }).map(([table, row]) =>
      table === "plans"
        ? [table, { ...row, data: planText }]
        : table === "entries"
          ? [
              table,
              {
                ...row,
                plan: planText,
                ...(row.id === ids.dose ? { data: JSON.stringify(rapid) } : {}),
              },
            ]
          : [table, row],
    ),
    [
      "entries",
      {
        id: ids.basal,
        owner,
        at: basal.at,
        data: JSON.stringify(basal),
        plan: planText,
        updated: "2026-09-20T02:03:00.000Z",
      },
    ],
    [
      "care_audit",
      {
        id: ids.doseAudit,
        owner,
        entry_id: ids.dose,
        actor_id: owner,
        actor_name: "Synthetic tester",
        action: "created",
        before: null,
        after: JSON.stringify(rapid),
        at: "2026-09-20T13:01:00.000Z",
      },
    ],
  ];
}
const priorBackup = (list = priorRecords(), options = {}) =>
  backup(list, { format: PRIOR_FORMAT, ...options });
const withDose = (list, change) =>
  list.map(([table, row]) =>
    row.id === ids.dose && table === "entries"
      ? [table, { ...row, data: JSON.stringify({ ...JSON.parse(row.data), ...change }) }]
      : [table, row],
  );
const withHeader = (lines, change) => [
  JSON.stringify({ ...JSON.parse(lines[0]), ...change }),
  ...lines.slice(1),
];
const byteLength = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

pgTest(
  "a backup from before the rename imports with insulin products mapped to categories and everything else as recorded",
  async () => {
    const db = await setup();
    try {
      const lines = priorBackup();
      const { items, summary } = parse(lines);
      assert.equal(summary.latestPlan.ready, false);
      // Parts are sized from these lengths, so they must cover what is actually uploaded.
      for (const item of items)
        assert.ok(item.length >= byteLength(item.upload), `line ${item.line}`);
      // Mapped rows pass the same checks again unchanged, so reading the file twice or re-validating on the server agrees.
      const mapped = items
        .filter((item) => item.table !== "dexcom_connections")
        .map((item) => [item.table, item.upload.row]);
      assert.deepEqual(
        parse(priorBackup(mapped)).items.map((item) => item.upload.row),
        mapped.map(([, row]) => row),
      );
      assert.deepEqual(
        parse(lines).items.map((item) => item.upload),
        items.map((item) => item.upload),
      );

      const { response } = await upload(lines, { chunkRows: 4 });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.total, 11);
      assert.equal(result.planReady, false);
      // The dashboard stays closed until current settings are entered.
      assert.equal(
        (await (await care.GET(new Request("https://test.example/api/care"))).json()).plan,
        null,
      );

      const { rapid, basal } = priorEntries();
      const dose = await db.get(
        "SELECT at, data, plan, updated FROM entries WHERE id = $1 AND owner = $2",
        ids.dose,
        OWNER,
      );
      assert.deepEqual(JSON.parse(dose.data), { ...rapid, insulin: "Rapid-acting" });
      assert.equal(JSON.parse(dose.data).note, "Humalog pen primed first; Semglee later");
      assert.deepEqual(JSON.parse(dose.data).calculation.foodEntryIds, [ids.meal]);
      assert.equal(dose.at, rapid.at);
      assert.equal(dose.updated, "2026-09-20T13:01:00.000Z");
      assert.deepEqual(JSON.parse(dose.plan), priorPlan);
      const long = await db.get(
        "SELECT at, data FROM entries WHERE id = $1 AND owner = $2",
        ids.basal,
        OWNER,
      );
      assert.deepEqual(JSON.parse(long.data), { ...basal, insulin: "Long-acting" });
      assert.equal(long.at, basal.at);
      // No setting is invented for the older plan.
      assert.deepEqual(
        JSON.parse((await db.get("SELECT data FROM plans WHERE owner = $1", OWNER)).data),
        priorPlan,
      );
      // Change history keeps the snapshot exactly as it was recorded.
      assert.equal(
        (await db.get('SELECT "after" FROM care_audit WHERE id = $1', ids.doseAudit)).after,
        JSON.stringify(rapid),
      );
      assert.equal(await rows(db, "care_audit", OWNER), 2);
      assert.equal(await rows(db, "dexcom_connections"), 0);
    } finally {
      await teardown(db);
    }
  },
);

pgTest("a seven-table backup from before the rename imports", async () => {
  const db = await setup();
  try {
    const { response } = await upload(
      priorBackup(priorRecords(SOURCE, { legacy: true }), {
        tables: TABLES.filter((table) => table !== "illness_windows" && table !== "profiles"),
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(
      JSON.parse((await db.get("SELECT data FROM entries WHERE id = $1", ids.basal)).data).insulin,
      "Long-acting",
    );
  } finally {
    await teardown(db);
  }
});

pgTest("the server maps insulin products the same way when it receives rows unmapped", async () => {
  const db = await setup();
  try {
    const list = priorRecords(),
      { header, footer } = parse(priorBackup(list));
    const { sessionId } = await (await post({ action: "start", header })).json();
    const raw = list.map(([table, row]) => ({
      kind: "row",
      table,
      row: table === "dexcom_connections" ? { owner: row.owner } : row,
    }));
    assert.equal(
      (await post({ action: "chunk", sessionId, index: 0, firstLine: 2, rows: raw })).status,
      200,
    );
    assert.equal((await post({ action: "finish", sessionId, footer, chunks: 1 })).status, 200);
    const { rapid } = priorEntries();
    assert.equal(
      (await db.get("SELECT data FROM entries WHERE id = $1", ids.dose)).data,
      JSON.stringify({ ...rapid, insulin: "Rapid-acting" }),
    );
  } finally {
    await teardown(db);
  }
});

pgTest("only a well-formed version 1 project name is accepted in place of carby", async () => {
  const lines = priorBackup();
  assert.equal(
    parse(withHeader(lines, { format: "another-app2-d1-ndjson" })).summary.importRows,
    11,
  );
  for (const format of [
    "Previous-Care-d1-ndjson",
    "previous care-d1-ndjson",
    "-d1-ndjson",
    "previous--care-d1-ndjson",
    "previous-care-d2-ndjson",
    "previous-care-d1-json",
    "previous-care-ndjson",
    `${"a".repeat(60)}-d1-ndjson`,
    1,
    null,
  ])
    assert.throws(() => parse(withHeader(lines, { format })), /not a Carby backup/, String(format));
  assert.throws(() => parse(withHeader(lines, { version: 2 })), /format version/);
  assert.throws(
    () => parse(withHeader(lines, { tables: [...TABLES, "extra_table"] })),
    /does not recognize/,
  );
  const db = await setup();
  try {
    const response = await post({
      action: "start",
      header: JSON.parse(withHeader(lines, { format: "Previous-Care-d1-ndjson" })[0]),
    });
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /not a Carby backup/);
    assert.equal(await rows(db, "import_sessions"), 0);
  } finally {
    await teardown(db);
  }
});

pgTest(
  "an insulin value that is not a recognized product or category is refused rather than guessed",
  async () => {
    for (const insulin of ["Mystery-brand", "humalog", "Humalog ", "", "Rapid"])
      assert.throws(
        () => parse(priorBackup(withDose(priorRecords(), { insulin }))),
        /log entry/,
        insulin,
      );
    const db = await setup();
    try {
      const { header, items } = parse(priorBackup());
      const { sessionId } = await (await post({ action: "start", header })).json();
      const response = await post({
        action: "chunk",
        sessionId,
        index: 0,
        firstLine: 2,
        rows: items.map((item) =>
          item.upload.row.id === ids.dose && item.table === "entries"
            ? {
                ...item.upload,
                row: {
                  ...item.upload.row,
                  data: JSON.stringify({
                    ...JSON.parse(item.upload.row.data),
                    insulin: "Mystery-brand",
                  }),
                },
              }
            : item.upload,
        ),
      });
      assert.equal(response.status, 422);
      assert.match((await response.json()).error, /log entry/);
      assert.equal(await liveTotal(db), 0);
      assert.equal(await rows(db, "import_rows"), 0);
    } finally {
      await teardown(db);
    }
  },
);

pgTest(
  "a truncated, miscounted or mixed-owner backup from before the rename is still refused",
  async () => {
    const lines = priorBackup();
    assert.throws(() => parse(lines.slice(0, -1)), /incomplete.*partial backup/s);
    assert.throws(() => parse(lines.slice(0, -2).concat(lines.at(-1))), /should have/);
    const mixed = priorRecords();
    mixed[2] = [mixed[2][0], { ...mixed[2][1], owner: OTHER }];
    assert.throws(() => parse(priorBackup(mixed)), /different account/);
    const db = await setup();
    try {
      const { header, footer, items } = parse(lines);
      const { sessionId } = await (await post({ action: "start", header })).json();
      assert.equal(
        (
          await post({
            action: "chunk",
            sessionId,
            index: 0,
            firstLine: 2,
            rows: items.slice(0, -1).map((item) => item.upload),
          })
        ).status,
        200,
      );
      const response = await post({ action: "finish", sessionId, footer, chunks: 1 });
      assert.equal(response.status, 422);
      assert.match((await response.json()).error, /incomplete/);
      assert.equal(await liveTotal(db), 0);
      assert.equal(await rows(db, "import_rows"), 0);
    } finally {
      await teardown(db);
    }
  },
);

test("the browser check rejects truncated, miscounted, mixed-owner, edited and unsupported files", () => {
  const lines = backup();
  assert.throws(() => parse(lines.slice(0, -1)), /incomplete/);
  assert.throws(() => parse(lines.slice(0, -2).concat(lines.at(-1))), /should have/);
  assert.throws(() => parse([...lines, '{"kind":"row"}']), /after the end/);
  assert.throws(() => parse([lines[0], "", ...lines.slice(1)]), /empty/);
  assert.throws(() => parse([lines[0], lines[1].slice(0, 20), ...lines.slice(2)]), /not readable/);
  const mixed = records();
  mixed[1] = [mixed[1][0], { ...mixed[1][1], owner: OTHER }];
  assert.throws(() => parse(backup(mixed)), /different account/);
  assert.throws(
    () => parse([lines[0].replace('"version":1', '"version":2'), ...lines.slice(1)]),
    /format version/,
  );
  assert.throws(
    () => parse([lines[0].replace("carby-d1-ndjson", "other-format"), ...lines.slice(1)]),
    /not a Carby backup/,
  );
  assert.throws(
    () => parse(backup(records(), { tables: [...TABLES, "extra_table"] })),
    /does not recognize/,
  );
  const future = records().map(([table, row]) =>
    table === "plans" ? [table, { ...row, created: "2099-01-01T00:00:00.000Z" }] : [table, row],
  );
  assert.throws(() => parse(backup(future)), /care plan version/);
  const unsafe = records().map(([table, row]) =>
    table === "plans"
      ? [table, { ...row, data: JSON.stringify({ ...plan, note: { text: "x" } }) }]
      : [table, row],
  );
  assert.throws(() => parse(backup(unsafe)), /care plan version/);
  const wrongId = records().map(([table, row]) =>
    row.id === ids.meal && table === "entries"
      ? [table, { ...row, id: "70000000-0000-4000-8000-000000000007" }]
      : [table, row],
  );
  assert.throws(() => parse(backup(wrongId)), /log entry/);
  assert.throws(() => parse(backup([records()[7]])), /no records to import/);
});

pgTest("the server rejects a miscounted footer and leaves no active or staged rows", async () => {
  const db = await setup();
  try {
    const lines = backup();
    const { header, footer, items } = parse(lines);
    const { sessionId } = await (await post({ action: "start", header })).json();
    assert.equal(
      (
        await post({
          action: "chunk",
          sessionId,
          index: 0,
          firstLine: 2,
          rows: items.slice(0, -1).map((item) => item.upload),
        })
      ).status,
      200,
    );
    const response = await post({ action: "finish", sessionId, footer, chunks: 1 });
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /incomplete.*No records were added/);
    assert.equal(await liveTotal(db), 0);
    assert.equal(await rows(db, "import_rows"), 0);
    assert.equal(await rows(db, "import_sessions"), 0);
  } finally {
    await teardown(db);
  }
});

pgTest(
  "the server re-validates every uploaded row: payloads, owners and credential stubs",
  async () => {
    const db = await setup();
    try {
      const { header, items } = parse(backup());
      const cases = [
        (rows) =>
          rows.map((row) =>
            row.table === "entries" ? { ...row, row: { ...row.row, data: '{"id":"broken"' } } : row,
          ),
        (rows) =>
          rows.map((row, index) =>
            index === 1 ? { ...row, row: { ...row.row, owner: OTHER } } : row,
          ),
        (rows) =>
          rows.map((row) =>
            row.table === "dexcom_connections"
              ? {
                  kind: "row",
                  table: row.table,
                  row: { owner: SOURCE, credentials: "synthetic-sealed-credential" },
                }
              : row,
          ),
        (rows) =>
          rows.map((row) =>
            row.table === "cgm_readings" ? { ...row, row: { ...row.row, value: "1e2" } } : row,
          ),
        (rows) =>
          rows.map((row) =>
            row.table === "care_audit" ? { ...row, row: { ...row.row, after: "not json" } } : row,
          ),
      ];
      for (const change of cases) {
        const { sessionId } = await (await post({ action: "start", header })).json();
        const response = await post({
          action: "chunk",
          sessionId,
          index: 0,
          firstLine: 2,
          rows: change(items.map((item) => item.upload)),
        });
        assert.equal(response.status, 422);
        assert.equal(
          (
            await post({
              action: "chunk",
              sessionId,
              index: 0,
              firstLine: 2,
              rows: items.map((item) => item.upload),
            })
          ).status,
          404,
        );
      }
      assert.equal(await liveTotal(db), 0);
      assert.equal(await rows(db, "import_rows"), 0);
    } finally {
      await teardown(db);
    }
  },
);

pgTest(
  "a record ID repeated in a later part rolls that part back and fails the import",
  async () => {
    const db = await setup();
    try {
      const list = records();
      const { header, footer, items } = parse(
        backup([...list, list[2]], {
          counts: {
            ...Object.fromEntries(TABLES.map((table) => [table, 0])),
            plans: 1,
            saved_foods: 1,
            entries: 3,
            cgm_readings: 2,
            dexcom_events: 1,
            dexcom_connections: 1,
            care_audit: 1,
            illness_windows: 1,
          },
        }),
      );
      const { sessionId } = await (await post({ action: "start", header })).json();
      assert.equal(
        (
          await post({
            action: "chunk",
            sessionId,
            index: 0,
            firstLine: 2,
            rows: items.slice(0, 5).map((item) => item.upload),
          })
        ).status,
        200,
      );
      const repeated = await post({
        action: "chunk",
        sessionId,
        index: 1,
        firstLine: 7,
        rows: items.slice(5).map((item) => item.upload),
      });
      assert.equal(repeated.status, 422);
      assert.match((await repeated.json()).error, /repeat/);
      assert.equal((await post({ action: "finish", sessionId, footer, chunks: 2 })).status, 404);
      assert.equal(await liveTotal(db), 0);
      assert.equal(await rows(db, "import_rows"), 0);
    } finally {
      await teardown(db);
    }
  },
);

pgTest(
  "an account with an existing invalid plan is refused before upload and left unchanged",
  async () => {
    const db = await setup();
    try {
      const { correctionHours, ...legacy } = plan;
      void correctionHours;
      await db.run(
        "INSERT INTO plans (id, owner, data, created) VALUES ($1, $2, $3, $4)",
        "legacy-plan",
        OWNER,
        JSON.stringify(legacy),
        "2026-09-01T00:00:00.000Z",
      );
      const status = await (await GET()).json();
      assert.equal(status.empty, false);
      assert.deepEqual(status.existing, ["plans"]);
      const { response } = await upload(backup());
      assert.equal(response.status, 409);
      const body = await response.json();
      assert.equal(body.code, "not-empty");
      assert.match(body.error, /care plan versions.*nothing was changed/);
      assert.equal(await liveTotal(db), 1);
      assert.equal(
        (await db.get("SELECT data FROM plans WHERE id = $1", "legacy-plan")).data,
        JSON.stringify(legacy),
      );
      assert.equal(await rows(db, "import_sessions"), 0);
    } finally {
      await teardown(db);
    }
  },
);

pgTest("a record saved in another window during upload blocks activation atomically", async () => {
  const db = await setup();
  try {
    const { response } = await upload(backup(), {
      chunkRows: 4,
      beforeFinish: () =>
        care.POST(
          new Request("https://test.example/api/care", {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin: "https://test.example" },
            body: JSON.stringify({ action: "plan", plan }),
          }),
        ),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "not-empty");
    assert.equal(await rows(db, "plans", OWNER), 1);
    assert.equal(
      (await db.get("SELECT COUNT(*)::int AS n FROM plans WHERE id = $1", ids.plan)).n,
      0,
    );
    assert.equal(await rows(db, "entries"), 0);
    assert.equal(await rows(db, "cgm_readings"), 0);
    assert.equal(await rows(db, "import_rows"), 0);
  } finally {
    await teardown(db);
  }
});

pgTest("IDs already used by another account are reported and never overwritten", async () => {
  const db = await setup();
  try {
    await db.run(
      "INSERT INTO entries (id, owner, at, data, plan, updated) VALUES ($1, $2, $3, $4, $5, $6)",
      ids.meal,
      OTHER,
      "2026-09-01T00:00:00.000Z",
      '{"kept":true}',
      "{}",
      "2026-09-01T00:00:00.000Z",
    );
    const { response } = await upload(backup());
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "id-conflict");
    assert.equal(
      (await db.get("SELECT owner, data FROM entries WHERE id = $1", ids.meal)).data,
      '{"kept":true}',
    );
    assert.equal(await rows(db, "entries", OWNER), 0);
    assert.equal(await liveTotal(db), 1);
    assert.equal(await rows(db, "import_rows"), 0);
  } finally {
    await teardown(db);
  }
});

pgTest("a backup cannot reserve reading IDs another account will derive later", async () => {
  const db = await setup();
  try {
    const at = "2026-09-20T14:00:00.000Z",
      reserved = sha(OTHER + "|" + at);
    const list = [
      ...records(),
      ["cgm_readings", { id: reserved, owner: SOURCE, at, value: "130", source: "Dexcom Share" }],
    ];
    const { response } = await upload(backup(list));
    assert.equal(response.status, 200);
    assert.equal(
      (await db.get("SELECT COUNT(*)::int AS n FROM cgm_readings WHERE id = $1", reserved)).n,
      0,
    );
    assert.ok(
      await db.get(
        "SELECT 1 FROM cgm_readings WHERE id = $1 AND owner = $2",
        sha(`${OWNER}|import|cgm_readings|${reserved}`),
        OWNER,
      ),
    );
  } finally {
    await teardown(db);
  }
});

pgTest("retried parts and a retried finish do not duplicate records", async () => {
  const db = await setup();
  try {
    const { header, footer, items } = parse(backup());
    const { sessionId } = await (await post({ action: "start", header })).json();
    const part = {
      action: "chunk",
      sessionId,
      index: 0,
      firstLine: 2,
      rows: items.map((item) => item.upload),
    };
    assert.equal((await post(part)).status, 200);
    const replay = await post(part);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).replayed, true);
    const first = await post({ action: "finish", sessionId, footer, chunks: 1 });
    assert.equal(first.status, 200);
    const again = await post({ action: "finish", sessionId, footer, chunks: 1 });
    assert.equal(again.status, 200);
    const body = await again.json();
    assert.equal(body.replayed, true);
    assert.equal(body.total, 9);
    assert.equal(await rows(db, "entries", OWNER), 2);
  } finally {
    await teardown(db);
  }
});

pgTest(
  "a delayed copy of a part that arrives after finishing starts neither adds rows nor fails the import",
  async () => {
    const db = await setup();
    try {
      const { header, footer, items } = parse(backup());
      const { sessionId } = await (await post({ action: "start", header })).json();
      const parts = [items.slice(0, 4), items.slice(4)].map((group, index) => ({
        action: "chunk",
        sessionId,
        index,
        firstLine: group[0].line,
        rows: group.map((item) => item.upload),
      }));
      for (const part of parts) assert.equal((await post(part)).status, 200);
      const staged = await rows(db, "import_rows");
      // Finishing freezes the session before it checks counts; simulate a part that lands in that gap.
      await db.run("UPDATE import_sessions SET state = 'ready' WHERE id = $1", sessionId);
      const replay = await post(parts[1]);
      assert.equal(replay.status, 200);
      assert.equal((await replay.json()).replayed, true);
      const stale = await post(parts[0]);
      assert.equal(stale.status, 409);
      assert.equal((await stale.json()).code, "duplicate");
      assert.equal(await rows(db, "import_rows"), staged);
      assert.equal(
        (await db.get("SELECT state FROM import_sessions WHERE id = $1", sessionId)).state,
        "ready",
      );
      const finished = await post({ action: "finish", sessionId, footer, chunks: 2 });
      assert.equal(finished.status, 200);
      assert.equal((await finished.json()).total, 9);
      assert.equal(await rows(db, "entries", OWNER), 2);
    } finally {
      await teardown(db);
    }
  },
);

pgTest("cancelling removes staged rows and a later part is refused", async () => {
  const db = await setup();
  try {
    const { header, items } = parse(backup());
    const { sessionId } = await (await post({ action: "start", header })).json();
    assert.equal(
      (
        await post({
          action: "chunk",
          sessionId,
          index: 0,
          firstLine: 2,
          rows: items.slice(0, 4).map((item) => item.upload),
        })
      ).status,
      200,
    );
    assert.ok((await rows(db, "import_rows")) > 0);
    const cancelled = await post({ action: "cancel", sessionId });
    assert.equal((await cancelled.json()).state, "cancelled");
    assert.equal(await rows(db, "import_rows"), 0);
    assert.equal(await rows(db, "import_sessions"), 0);
    assert.equal(
      (
        await post({
          action: "chunk",
          sessionId,
          index: 1,
          firstLine: 6,
          rows: items.slice(4).map((item) => item.upload),
        })
      ).status,
      404,
    );
    assert.equal(await liveTotal(db), 0);
  } finally {
    await teardown(db);
  }
});

pgTest("a newer import replaces an unfinished one for the same owner", async () => {
  const db = await setup();
  try {
    const { header, items } = parse(backup());
    const first = (await (await post({ action: "start", header })).json()).sessionId;
    assert.equal(
      (
        await post({
          action: "chunk",
          sessionId: first,
          index: 0,
          firstLine: 2,
          rows: items.slice(0, 3).map((item) => item.upload),
        })
      ).status,
      200,
    );
    const { response } = await upload(backup());
    assert.equal(response.status, 200);
    assert.equal(await rows(db, "import_rows"), 0);
    assert.equal(
      (
        await post({
          action: "chunk",
          sessionId: first,
          index: 1,
          firstLine: 5,
          rows: items.slice(3).map((item) => item.upload),
        })
      ).status,
      404,
    );
  } finally {
    await teardown(db);
  }
});

pgTest(
  "requests are signed in, same-origin, JSON and size-limited; other owners cannot use a session",
  async () => {
    const db = await setup();
    try {
      const { header, items } = parse(backup());
      assert.equal(
        (await post({ action: "start", header }, { Origin: "https://evil.example" })).status,
        403,
      );
      assert.equal(
        (await post({ action: "start", header }, { "Sec-Fetch-Site": "cross-site" })).status,
        403,
      );
      assert.equal(
        (await post(JSON.stringify({ action: "start", header }), { "Content-Type": "text/plain" }))
          .status,
        415,
      );
      assert.equal(
        (await post({ action: "start", header, padding: "x".repeat(1100000) })).status,
        413,
      );
      const { sessionId } = await (await post({ action: "start", header })).json();
      globalThis.importTestUser = { ...globalThis.importTestUser, userId: OTHER };
      assert.equal(
        (
          await post({
            action: "chunk",
            sessionId,
            index: 0,
            firstLine: 2,
            rows: items.map((item) => item.upload),
          })
        ).status,
        404,
      );
      assert.equal((await post({ action: "cancel", sessionId })).status, 404);
      globalThis.importTestUser = null;
      assert.equal((await post({ action: "start", header })).status, 401);
      assert.equal(await rows(db, "import_rows"), 0);
    } finally {
      await teardown(db);
    }
  },
);

test("line splitting handles CRLF and split chunks, and rejects non-UTF-8 files", async () => {
  const text = backup().join("\r\n") + "\r\n";
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      controller.close();
    },
  });
  const lines = [];
  for await (const line of backupLines(stream)) lines.push(line);
  assert.equal(parse(lines).summary.importRows, 9);
  const invalid = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([0x7b, 0xff, 0xfe, 0x0a]));
      controller.close();
    },
  });
  await assert.rejects(
    async () => {
      for await (const line of backupLines(invalid)) void line;
    },
    (error) => error instanceof BackupError,
  );
});

pgTest("an account holding only a Dexcom connection is not treated as empty", async () => {
  const db = await setup();
  try {
    await db.run(
      "INSERT INTO dexcom_connections (owner, credentials, updated) VALUES ($1, $2, $3)",
      OWNER,
      "synthetic-destination-credential",
      "2026-09-01T00:00:00.000Z",
    );
    const { response } = await upload(backup());
    assert.equal(response.status, 409);
    assert.deepEqual((await response.json()).existing, ["dexcom_connections"]);
    assert.equal(
      (await db.get("SELECT credentials FROM dexcom_connections WHERE owner = $1", OWNER))
        .credentials,
      "synthetic-destination-credential",
    );
    assert.equal(await liveTotal(db), 1);
  } finally {
    await teardown(db);
  }
});

pgTest(
  "staging abandoned for a day is removed by any later cleanup, without touching live rows",
  async () => {
    const db = await setup();
    try {
      const { cleanupImports, importCleanupNeeded } = await import("../lib/care-records.ts");
      const { header, items } = parse(backup());
      const { sessionId } = await (await post({ action: "start", header })).json();
      assert.equal(
        (
          await post({
            action: "chunk",
            sessionId,
            index: 0,
            firstLine: 2,
            rows: items.map((item) => item.upload),
          })
        ).status,
        200,
      );
      await db.run(
        "INSERT INTO plans (id, owner, data, created) VALUES ($1, $2, $3, $4)",
        "other-plan",
        OTHER,
        JSON.stringify(plan),
        "2026-09-01T00:00:00.000Z",
      );
      assert.equal(await importCleanupNeeded(globalThis.importTestDb, OTHER), false);
      await db.run(
        "UPDATE import_sessions SET updated = $1 WHERE id = $2",
        "2026-01-01T00:00:00.000Z",
        sessionId,
      );
      assert.equal(await importCleanupNeeded(globalThis.importTestDb, OTHER), true);
      assert.equal(await cleanupImports(globalThis.importTestDb, OTHER), false);
      assert.equal(await rows(db, "import_rows"), 0);
      assert.equal(await rows(db, "plans", OTHER), 1);
      assert.equal(
        (await post({ action: "finish", sessionId, footer: null, chunks: 1 })).status,
        404,
      );
    } finally {
      await teardown(db);
    }
  },
);

// Replacing a populated account.
const REPLACE = { mode: "replace", confirmReplace: true };
/** One record in every account table, like the populated account on the setup screen. */
async function seed(db, owner, tag) {
  const at = "2026-08-01T00:00:00.000Z";
  const id = (table) => `${tag}-${table}`;
  await db.run(
    "INSERT INTO plans (id, owner, data, created) VALUES ($1, $2, $3, $4)",
    id("plans"),
    owner,
    JSON.stringify({ ...priorPlan, note: tag }),
    at,
  );
  await db.run(
    "INSERT INTO saved_foods (id, owner, name, data, updated) VALUES ($1, $2, $3, $4, $5)",
    id("saved_foods"),
    owner,
    `${tag} food`,
    "{}",
    at,
  );
  await addEntry(db, owner, id("entries"), at);
  await db.run(
    "INSERT INTO cgm_readings (id, owner, at, value, source) VALUES ($1, $2, $3, $4, $5)",
    id("cgm_readings"),
    owner,
    at,
    "100",
    "Dexcom Share",
  );
  await db.run(
    "INSERT INTO dexcom_events (id, owner, at, data) VALUES ($1, $2, $3, $4)",
    id("dexcom_events"),
    owner,
    at,
    "{}",
  );
  await db.run(
    "INSERT INTO dexcom_connections (owner, credentials, updated) VALUES ($1, $2, $3)",
    owner,
    `${tag}-sealed-credential`,
    at,
  );
  await db.run(
    'INSERT INTO care_audit (id, owner, entry_id, actor_id, actor_name, action, "before", "after", at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    id("care_audit"),
    owner,
    id("entries"),
    owner,
    "Synthetic tester",
    "created",
    null,
    "{}",
    at,
  );
  await db.run(
    "INSERT INTO illness_windows (id, owner, start_date, data, updated) VALUES ($1, $2, $3, $4, $5)",
    id("illness_windows"),
    owner,
    "2026-08-01",
    "{}",
    at,
  );
}
async function addEntry(db, owner, id, at = "2026-09-25T00:00:00.000Z", data = "{}") {
  await db.run(
    "INSERT INTO entries (id, owner, at, data, plan, updated) VALUES ($1, $2, $3, $4, $5, $6)",
    id,
    owner,
    at,
    data,
    "{}",
    at,
  );
}
async function dump(db, owner) {
  const result = {};
  for (const table of LIVE)
    result[table] = await db.all(
      `SELECT * FROM "${table}" WHERE owner = $1 ORDER BY ${table === "dexcom_connections" ? "owner" : "id"}`,
      owner,
    );
  return result;
}
const count = async (db, table, id) =>
  (await db.get(`SELECT COUNT(*)::int AS n FROM "${table}" WHERE id = $1`, id)).n;
const sessionState = async (db, id) =>
  (await db.get("SELECT state FROM import_sessions WHERE id = $1", id))?.state;
/** Hand the next batch to `hook`. Finishing sends exactly one batch: the activation. */
function onNextBatch(hook) {
  const database = globalThis.importTestDb;
  const original = database.batch;
  database.batch = async (statements) => {
    database.batch = original;
    return hook(statements, (list = statements) => original.call(database, list));
  };
}
/** A statement that fails in the database, standing in for a storage failure. */
const failing = () => globalThis.importTestDb.prepare("SELECT simulated_storage_failure()");

pgTest(
  "a populated account without replacement consent is refused and keeps every record",
  async () => {
    const db = await setup();
    try {
      await seed(db, OWNER, "old");
      const before = await dump(db, OWNER);
      const { response } = await upload(backup());
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, "not-empty");
      const { header } = parse(backup());
      for (const extra of [
        { mode: "replace" },
        { mode: "replace", confirmReplace: "yes" },
        { confirmReplace: true },
        { mode: "merge", confirmReplace: true },
      ]) {
        const started = await post({ action: "start", header, ...extra });
        assert.equal(started.status, 400, JSON.stringify(extra));
      }
      assert.deepEqual(await dump(db, OWNER), before);
      assert.equal(await rows(db, "import_sessions"), 0);
    } finally {
      await teardown(db);
    }
  },
);

pgTest(
  "a confirmed replacement swaps every account table for this owner and leaves other accounts alone",
  async () => {
    const db = await setup();
    try {
      await seed(db, OWNER, "old");
      await seed(db, OTHER, "other");
      const others = await dump(db, OTHER);
      const { response } = await upload(backup(), { chunkRows: 3, extra: REPLACE });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.replaced, true);
      assert.equal(result.total, 9);
      assert.equal(result.planReady, true);
      for (const table of LIVE.filter((table) => table !== "dexcom_connections"))
        assert.equal(await count(db, table, `old-${table}`), 0, table);
      // The old connection is removed and the backup's sealed sign-in is never stored.
      assert.equal(await rows(db, "dexcom_connections", OWNER), 0);
      for (const table of [
        "plans",
        "saved_foods",
        "care_audit",
        "illness_windows",
        "dexcom_events",
      ])
        assert.equal(await rows(db, table, OWNER), 1, table);
      assert.equal(await rows(db, "entries", OWNER), 2);
      assert.equal(await rows(db, "cgm_readings", OWNER), 2);
      assert.deepEqual(await dump(db, OTHER), others);
      assert.equal(await rows(db, "import_rows"), 0);
      const snapshot = await (await care.GET(new Request("https://test.example/api/care"))).json();
      assert.deepEqual(snapshot.plan, plan);
      assert.equal(snapshot.entries.length, 2);
    } finally {
      await teardown(db);
    }
  },
);

pgTest(
  "a replacement may reuse this owner's own record IDs and discards edits made since",
  async () => {
    const db = await setup();
    try {
      assert.equal((await upload(backup())).response.status, 200);
      await db.run("UPDATE entries SET data = $1 WHERE id = $2", '{"edited":true}', ids.meal);
      await addEntry(db, OWNER, "later-entry");
      const { response } = await upload(backup(), { extra: REPLACE });
      assert.equal(response.status, 200);
      assert.equal(await rows(db, "entries", OWNER), 2);
      assert.equal(await count(db, "entries", "later-entry"), 0);
      const meal = await db.get("SELECT data FROM entries WHERE id = $1", ids.meal);
      assert.equal(JSON.parse(meal.data).id, ids.meal);
      assert.equal(await rows(db, "cgm_readings", OWNER), 2);
    } finally {
      await teardown(db);
    }
  },
);

pgTest("an ID held by another account blocks a replacement and changes nothing", async () => {
  const db = await setup();
  try {
    await seed(db, OWNER, "old");
    await addEntry(db, OTHER, ids.meal, "2026-09-01T00:00:00.000Z", '{"kept":true}');
    const before = await dump(db, OWNER);
    const { response } = await upload(backup(), { extra: REPLACE });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, "id-conflict");
    assert.match(body.error, /current records were not changed/);
    assert.deepEqual(await dump(db, OWNER), before);
    assert.equal((await db.get("SELECT owner FROM entries WHERE id = $1", ids.meal)).owner, OTHER);
  } finally {
    await teardown(db);
  }
});

pgTest(
  "a conflict or storage failure inside the replacement transaction rolls back the deletes",
  async () => {
    const db = await setup();
    try {
      await seed(db, OWNER, "old");
      const before = await dump(db, OWNER);
      // Another account saves a clashing ID after the pre-check, so an insert fails after the deletes.
      const conflict = await upload(backup(), {
        extra: REPLACE,
        beforeFinish: () =>
          onNextBatch(async (statements, run) => {
            await db.run(
              "INSERT INTO saved_foods (id, owner, name, data, updated) VALUES ($1, $2, $3, $4, $5)",
              ids.food,
              OTHER,
              "Other food",
              "{}",
              "2026-09-01T00:00:00.000Z",
            );
            return run();
          }),
      });
      assert.equal(conflict.response.status, 409);
      assert.equal((await conflict.response.json()).code, "id-conflict");
      assert.deepEqual(await dump(db, OWNER), before);
      assert.notEqual(await sessionState(db, conflict.sessionId), "complete");
      await db.run("DELETE FROM saved_foods WHERE owner = $1", OTHER);

      // The last statement fails after every delete and insert ran; the session stays ready to retry.
      const broken = await upload(backup(), {
        extra: REPLACE,
        beforeFinish: () =>
          onNextBatch((statements, run) => run([...statements.slice(0, -1), failing()])),
      });
      assert.equal(broken.response.status, 503);
      assert.equal((await broken.response.json()).retry, true);
      assert.deepEqual(await dump(db, OWNER), before);
      assert.equal(await sessionState(db, broken.sessionId), "ready");
      const retried = await post({
        action: "finish",
        sessionId: broken.sessionId,
        footer: broken.footer,
        chunks: broken.chunks,
        ...REPLACE,
      });
      assert.equal(retried.status, 200);
      assert.equal((await retried.json()).replaced, true);
      assert.equal(await rows(db, "plans", OWNER), 1);
      assert.equal(await count(db, "plans", "old-plans"), 0);
    } finally {
      await teardown(db);
    }
  },
);

pgTest(
  "cancelling, a rejected footer, an empty backup or a missing confirmation leaves a populated account unchanged",
  async () => {
    const db = await setup();
    try {
      await seed(db, OWNER, "old");
      const before = await dump(db, OWNER);
      const { header, footer, items } = parse(backup());
      const { sessionId } = await (await post({ action: "start", header, ...REPLACE })).json();
      const part = {
        action: "chunk",
        sessionId,
        index: 0,
        firstLine: 2,
        rows: items.map((item) => item.upload),
      };
      assert.equal((await post(part)).status, 200);
      const unconfirmed = await post({ action: "finish", sessionId, footer, chunks: 1 });
      assert.equal(unconfirmed.status, 400);
      assert.equal((await unconfirmed.json()).code, "confirm-replace");
      assert.deepEqual(await dump(db, OWNER), before);
      assert.equal((await (await post({ action: "cancel", sessionId })).json()).state, "cancelled");
      assert.equal(
        (await post({ action: "finish", sessionId, footer, chunks: 1, ...REPLACE })).status,
        404,
      );
      assert.deepEqual(await dump(db, OWNER), before);

      const short = (await (await post({ action: "start", header, ...REPLACE })).json()).sessionId;
      assert.equal(
        (await post({ ...part, sessionId: short, rows: part.rows.slice(0, -1) })).status,
        200,
      );
      const miscounted = await post({
        action: "finish",
        sessionId: short,
        footer,
        chunks: 1,
        ...REPLACE,
      });
      assert.equal(miscounted.status, 422);
      assert.match((await miscounted.json()).error, /incomplete.*current records were not changed/);
      assert.deepEqual(await dump(db, OWNER), before);

      const lines = backup([]);
      const blank = await (
        await post({ action: "start", header: JSON.parse(lines[0]), ...REPLACE })
      ).json();
      const empty = await post({
        action: "finish",
        sessionId: blank.sessionId,
        footer: JSON.parse(lines[lines.length - 1]),
        chunks: 0,
        ...REPLACE,
      });
      assert.equal(empty.status, 422);
      assert.match((await empty.json()).error, /no records/);
      assert.deepEqual(await dump(db, OWNER), before);
      assert.equal(await rows(db, "import_rows"), 0);
    } finally {
      await teardown(db);
    }
  },
);

pgTest("a finish request cannot turn an ordinary import into a replacement", async () => {
  const db = await setup();
  try {
    const { header, footer, items } = parse(backup());
    const { sessionId } = await (await post({ action: "start", header })).json();
    assert.equal(
      (
        await post({
          action: "chunk",
          sessionId,
          index: 0,
          firstLine: 2,
          rows: items.map((item) => item.upload),
        })
      ).status,
      200,
    );
    await seed(db, OWNER, "saved-meanwhile");
    const before = await dump(db, OWNER);
    const upgraded = await post({ action: "finish", sessionId, footer, chunks: 1, ...REPLACE });
    assert.equal(upgraded.status, 400);
    assert.equal((await upgraded.json()).code, "mode-mismatch");
    assert.deepEqual(await dump(db, OWNER), before);
    const plain = await post({ action: "finish", sessionId, footer, chunks: 1 });
    assert.equal(plain.status, 409);
    assert.equal((await plain.json()).code, "not-empty");
    assert.deepEqual(await dump(db, OWNER), before);
    assert.equal(await count(db, "plans", ids.plan), 0);
  } finally {
    await teardown(db);
  }
});

pgTest(
  "a repeated finish after a replacement returns the first outcome and keeps later edits",
  async () => {
    const db = await setup();
    try {
      await seed(db, OWNER, "old");
      const { response, sessionId, footer, chunks } = await upload(backup(), { extra: REPLACE });
      assert.equal(response.status, 200);
      const first = await response.json();
      await addEntry(db, OWNER, "after-import");
      const edited = await dump(db, OWNER);
      for (const body of [
        { action: "finish", sessionId, footer, chunks, ...REPLACE },
        { action: "cancel", sessionId },
      ]) {
        const again = await post(body);
        assert.equal(again.status, 200);
        const replay = await again.json();
        assert.equal(replay.total, first.total);
        assert.equal(replay.replaced, true);
      }
      assert.deepEqual(await dump(db, OWNER), edited);
    } finally {
      await teardown(db);
    }
  },
);

pgTest(
  "an activation that lost its claim to a completed finish or a cancel deletes nothing",
  async () => {
    const db = await setup();
    try {
      await seed(db, OWNER, "old");
      let captured = null;
      const done = await upload(backup(), {
        extra: REPLACE,
        beforeFinish: () =>
          onNextBatch((statements, run) => {
            captured = statements;
            return run();
          }),
      });
      assert.equal(done.response.status, 200);
      await addEntry(db, OWNER, "after-import");
      const edited = await dump(db, OWNER);
      // The same activation transaction delivered again, as a losing concurrent finish would be.
      await globalThis.importTestDb.batch(captured);
      assert.deepEqual(await dump(db, OWNER), edited);

      const before = await dump(db, OWNER);
      const stalled = await upload(backup(), {
        extra: REPLACE,
        beforeFinish: () =>
          onNextBatch((statements, run) => {
            captured = statements;
            return run([...statements.slice(0, -1), failing()]);
          }),
      });
      assert.equal(stalled.response.status, 503);
      assert.equal(
        (await (await post({ action: "cancel", sessionId: stalled.sessionId })).json()).state,
        "cancelled",
      );
      await globalThis.importTestDb.batch(captured);
      assert.deepEqual(await dump(db, OWNER), before);
    } finally {
      await teardown(db);
    }
  },
);

pgTest(
  "an empty account still imports without replacement consent and reports no replacement",
  async () => {
    const db = await setup();
    try {
      const { response, sessionId } = await upload(backup());
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.replaced, undefined);
      assert.equal(result.total, 9);
      assert.equal(
        (await db.get("SELECT replace_existing FROM import_sessions WHERE id = $1", sessionId))
          .replace_existing,
        0,
      );
    } finally {
      await teardown(db);
    }
  },
);

pgTest(
  "care contacts round-trip through a backup unchanged, and unsafe contacts are refused",
  async () => {
    const db = await setup();
    try {
      // Synthetic contacts only: reserved 555 numbers and a generic clinic label.
      const withContacts = JSON.stringify({
        ...plan,
        contacts: { careTeamName: "Synthetic Clinic", afterHoursPhone: "(555) 010-0199" },
      });
      const list = records().map(([table, row]) =>
        table === "plans" ? [table, { ...row, data: withContacts }] : [table, row],
      );
      for (const phone of ["javascript:alert(1)", "<img src=x>", "555\u0000"]) {
        const unsafe = JSON.stringify({ ...plan, contacts: { emergencyPhone: phone } });
        const plans = records().map(([table, row]) =>
          table === "plans" ? [table, { ...row, data: unsafe }] : [table, row],
        );
        assert.throws(() => parse(backup(plans)), /care plan version/, phone);
        const snapshots = records().map(([table, row]) =>
          table === "entries" ? [table, { ...row, plan: unsafe }] : [table, row],
        );
        assert.throws(() => parse(backup(snapshots)), /log entry/, phone);
      }
      const { response } = await upload(backup(list));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).planReady, true);
      assert.equal(
        (await db.get("SELECT data FROM plans WHERE owner = $1", OWNER)).data,
        withContacts,
      );
      const snapshot = await (await care.GET(new Request("https://test.example/api/care"))).json();
      assert.deepEqual(snapshot.plan.contacts, JSON.parse(withContacts).contacts);
    } finally {
      await teardown(db);
    }
  },
);

pgTest(
  "emergency instructions round-trip unchanged, even on an incomplete plan, and bad ones are refused",
  async () => {
    const db = await setup();
    try {
      // Synthetic, non-clinical instruction text and contacts only.
      const { correctionHours, ...older } = plan;
      void correctionHours;
      const emergencyInstructions = {
        lowGlucose: "Synthetic low-care note.\n\nSecond synthetic paragraph.",
        sickDay: "Synthetic sick-day note.",
      };
      const contacts = { afterHoursName: "Synthetic Line", afterHoursHours: "Synthetic hours" };
      const incomplete = JSON.stringify({ ...older, contacts, emergencyInstructions });
      for (const bad of [
        { lowGlucose: "x".repeat(4001) },
        { severeLow: 5 },
        { sickDay: "Synthetic\u0000note" },
        "Synthetic low-care note.",
      ]) {
        const unsafe = JSON.stringify({ ...plan, emergencyInstructions: bad });
        const plans = records().map(([table, row]) =>
          table === "plans" ? [table, { ...row, data: unsafe }] : [table, row],
        );
        assert.throws(() => parse(backup(plans)), /care plan version/, JSON.stringify(bad));
        const snapshots = records().map(([table, row]) =>
          table === "entries" ? [table, { ...row, plan: unsafe }] : [table, row],
        );
        assert.throws(() => parse(backup(snapshots)), /log entry/, JSON.stringify(bad));
      }
      const list = records().map(([table, row]) =>
        table === "plans"
          ? [table, { ...row, data: incomplete }]
          : table === "entries"
            ? [table, { ...row, plan: incomplete }]
            : [table, row],
      );
      const { response } = await upload(backup(list));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).planReady, false);
      assert.equal(
        (await db.get("SELECT data FROM plans WHERE owner = $1", OWNER)).data,
        incomplete,
      );
      for (const { plan: snapshot } of await db.all(
        "SELECT plan FROM entries WHERE owner = $1",
        OWNER,
      ))
        assert.equal(snapshot, incomplete);
      const draft = (await (await care.GET(new Request("https://test.example/api/care"))).json())
        .planDraft;
      assert.deepEqual(draft.values.emergencyInstructions, emergencyInstructions);
      assert.deepEqual(draft.values.contacts, contacts);
      assert.equal(draft.missing.includes("emergencyInstructions"), false);
    } finally {
      await teardown(db);
    }
  },
);

test("the review summary carries the backup plan's own zone for its dates", () => {
  assert.equal(parse(backup()).summary.latestPlan.timezone, "America/Chicago");
  const unusable = records().map(([table, row]) =>
    table === "plans"
      ? [
          table,
          { ...row, data: JSON.stringify({ ...JSON.parse(row.data), timezone: "Mars/Base" }) },
        ]
      : [table, row],
  );
  assert.equal(parse(backup(unusable)).summary.latestPlan.timezone, null);
});
