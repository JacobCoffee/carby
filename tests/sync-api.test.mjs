import { mock } from "bun:test";
import assert from "node:assert/strict";
import { createTestDatabase, pgTest } from "./pg-test-helper.mjs";

// Two deployments in two schemas: local sends, prod receives. Synthetic data only.
const token = "s".repeat(40);
const LOCAL_PERSON = "local_dev";
const PROD_PERSON = "github:900";
process.env.CARBY_SYNC_PUSH_URL = "https://prod.test";
process.env.CARBY_SYNC_PUSH_TOKEN = token;
process.env.CARBY_SYNC_PUSH_PERSON = LOCAL_PERSON;
process.env.CARBY_SYNC_ACCEPT_TOKEN = token;
process.env.CARBY_SYNC_ACCEPT_PERSON = PROD_PERSON;

mock.module("@/app/auth", () => ({
  getCurrentUser: async () => ({ userId: LOCAL_PERSON, displayName: "Local" }),
}));
mock.module("@/db/raw", () => ({ database: () => globalThis.syncTestDb }));
const care = await import("../app/api/care/route.ts");
const sync = await import("../app/api/sync/route.ts");
const { flushSync, pushConfig } = await import("../lib/sync.ts");

let local, prod;
let prodUp = true;
// Prod's endpoint, reached through its route with prod's database in place.
globalThis.fetch = async (url, init) => {
  if (!prodUp) throw new Error("connect ECONNREFUSED");
  assert.equal(url, "https://prod.test/api/sync");
  const previous = globalThis.syncTestDb;
  globalThis.syncTestDb = prod.database;
  try {
    return await sync.POST(new Request(url, init));
  } finally {
    globalThis.syncTestDb = previous;
  }
};
const flush = () => flushSync(local.database, pushConfig(process.env), LOCAL_PERSON);

async function setup() {
  local = await createTestDatabase();
  prod = await createTestDatabase();
  globalThis.syncTestDb = local.database;
  prodUp = true;
}
async function teardown() {
  await flush().catch(() => {});
  await local.close();
  await prod.close();
}

const origin = "https://local.test";
const post = async (body) => {
  const response = await care.POST(
    new Request(`${origin}/api/care`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  await flush();
};
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
const id = "44444444-4444-4444-8444-444444444444";
const reading = (glucose, revision) => ({
  id,
  ...(revision ? { revision } : {}),
  kind: "glucose",
  at: "2026-09-25T17:00:00.000Z",
  glucose,
  source: "Finger-stick",
  ketones: "Not checked",
  carbs: null,
  units: null,
  insulin: null,
  meal: null,
  note: "",
});
const stored = async (db) => {
  const row = await db.get("SELECT owner, data FROM entries WHERE id = $1", id);
  return row && { owner: row.owner, ...JSON.parse(row.data) };
};
const outbox = () => local.all("SELECT tbl, state FROM sync_outbox ORDER BY tbl");

pgTest("a record saved locally reaches prod as prod's person, audited as the sync", async () => {
  await setup();
  try {
    await post({ action: "plan", plan });
    await post({ action: "entry", entry: reading(110) });
    const there = await stored(prod);
    assert.equal(there.owner, PROD_PERSON);
    assert.equal(there.glucose, 110);
    assert.equal(there.revision, (await stored(local)).revision);
    assert.equal(
      (await prod.get("SELECT count(*)::int AS n FROM plans WHERE owner = $1", PROD_PERSON)).n,
      1,
    );
    const audit = await prod.get("SELECT actor_id, action FROM care_audit WHERE entry_id = $1", id);
    assert.deepEqual(audit, { actor_id: "sync", action: "created" });
    assert.deepEqual(await outbox(), []);

    // An edit and then a delete follow it.
    await post({ action: "entry", entry: reading(125, (await stored(local)).revision) });
    assert.equal((await stored(prod)).glucose, 125);
    await post({ action: "delete", id });
    assert.equal(await stored(prod), null);
    assert.deepEqual(await outbox(), []);
  } finally {
    await teardown();
  }
});

pgTest("an edit made on prod is held back, then replaced only when asked", async () => {
  await setup();
  try {
    await post({ action: "plan", plan });
    await post({ action: "entry", entry: reading(110) });
    // Someone edits the reading on prod directly: a new revision local never had.
    const prodCopy = { ...(await stored(prod)), glucose: 115, revision: "prod-edit" };
    delete prodCopy.owner;
    await prod.run("UPDATE entries SET data = $1 WHERE id = $2", JSON.stringify(prodCopy), id);

    await post({ action: "entry", entry: reading(140, (await stored(local)).revision) });
    assert.equal((await stored(prod)).glucose, 115);
    assert.deepEqual(await outbox(), [{ tbl: "entries", state: "conflict" }]);
    const { sync: status } = await (await care.GET(new Request(`${origin}/api/care`))).json();
    assert.equal(status.held.length, 1);
    assert.equal(status.target, "prod.test");

    await post({ action: "syncResend" });
    assert.equal((await stored(prod)).glucose, 140);
    assert.deepEqual(await outbox(), []);
  } finally {
    await teardown();
  }
});

pgTest("changes wait while prod is unreachable and go once it's back", async () => {
  await setup();
  try {
    await post({ action: "plan", plan });
    prodUp = false;
    await post({ action: "entry", entry: reading(110) });
    assert.equal(await stored(prod), null);
    const { sync: status } = await (await care.GET(new Request(`${origin}/api/care`))).json();
    assert.equal(status.pending, 1);
    assert.match(status.error, /ECONNREFUSED/);
    prodUp = true;
    await flush();
    assert.equal((await stored(prod)).glucose, 110);
    assert.deepEqual(await outbox(), []);
  } finally {
    await teardown();
  }
});

pgTest("prod refuses a wrong token and a record id that belongs to someone else", async () => {
  await setup();
  try {
    const bad = await sync.POST(
      new Request("https://prod.test/api/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${"x".repeat(40)}` },
        body: "{}",
      }),
    );
    assert.equal(bad.status, 401);
    await post({ action: "plan", plan });
    await prod.run(
      "INSERT INTO entries (id, owner, at, data, plan, updated) VALUES ($1, 'github:1', $2, $3, '{}', $2)",
      id,
      "2026-09-25T17:00:00.000Z",
      JSON.stringify(reading(90)),
    );
    await post({ action: "entry", entry: reading(110) });
    assert.equal((await stored(prod)).owner, "github:1");
    assert.deepEqual(await outbox(), [{ tbl: "entries", state: "rejected" }]);
    await post({ action: "syncDiscard" });
    assert.deepEqual(await outbox(), []);
  } finally {
    await teardown();
  }
});
