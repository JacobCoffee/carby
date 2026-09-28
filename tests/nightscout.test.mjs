import { mock, test } from "bun:test";
import assert from "node:assert/strict";
import { createTestDatabase, pgTest } from "./pg-test-helper.mjs";

const mom = { userId: "github:1", displayName: "Mom" };
let signedIn = mom;
mock.module("@/app/auth", () => ({ getCurrentUser: async () => signedIn }));
mock.module("@/db/raw", () => ({ database: () => globalThis.nightscoutTestDb }));
const people = await import("../app/api/people/route.ts");
const care = await import("../app/api/care/route.ts");
const v1 = await import("../app/api/v1/[...path]/route.ts");
const v2 = await import("../app/api/v2/authorization/request/[token]/route.ts");
const { nightscoutRoute, parseQuery, project } = await import("../lib/nightscout.ts");
const { tokenSecret } = await import("../lib/api-tokens.ts");

const at = Date.parse("2026-09-27T15:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

test("sensor entries become CGM readings, with Low and High beyond 40 and 400", () => {
  const reading = (sgv) =>
    project("entries", { type: "sgv", sgv, device: "xDrip-DexcomG6" }, at, "xDrip+").cgm;
  assert.deepEqual(reading(142), {
    at: iso(at),
    value: 142,
    status: null,
    source: "xDrip-DexcomG6",
  });
  assert.equal(reading(39).status, "Low");
  assert.equal(reading(401).status, "High");
  // Dexcom error codes are not readings.
  assert.equal(reading(5), null);
  // An upload never passes itself off as Carby's own Dexcom sync.
  assert.equal(
    project("entries", { type: "sgv", sgv: 120, device: "Dexcom Share" }, at, "x").cgm.source,
    "Dexcom Share upload",
  );
  const mbg = project("entries", { type: "mbg", mbg: 188 }, at, "x").entries;
  assert.deepEqual(
    mbg.map((p) => [p.entry.kind, p.entry.glucose, p.entry.source]),
    [["glucose", 188, "Finger-stick"]],
  );
});

test("insulin is logged only with the type the upload states", () => {
  const kinds = (doc) =>
    project("treatments", doc, at, "Loop").entries.map((p) => ({
      kind: p.entry.kind,
      ...(p.entry.carbs !== null && { carbs: p.entry.carbs, meal: p.entry.meal }),
      ...(p.entry.units !== null && { units: p.entry.units, insulin: p.entry.insulin }),
      ...(p.entry.note && { note: p.entry.note }),
    }));
  assert.deepEqual(kinds({ eventType: "Meal Bolus", carbs: 45, insulin: 3.5, notes: "Pizza" }), [
    { kind: "food", carbs: 45, meal: "Meal", note: "Pizza" },
    { kind: "insulin", units: 3.5, insulin: "Rapid-acting" },
  ]);
  // Loop sends meal boluses as corrections too, so no dose claims a purpose.
  const [loop] = project(
    "treatments",
    { eventType: "Correction Bolus", insulin: 1.2 },
    at,
    "x",
  ).entries;
  assert.equal(loop.entry.purpose, "Other / unknown");
  assert.deepEqual(kinds({ eventType: "External Insulin", insulin: 2 }), [
    { kind: "insulin", units: 2, insulin: "Rapid-acting" },
  ]);
  assert.deepEqual(kinds({ eventType: "Snack Bolus", carbs: 12 }), [
    { kind: "food", carbs: 12, meal: "Snack" },
  ]);
  // Juggluco names the type in notes; AAPS flags basal insulin.
  assert.deepEqual(kinds({ eventType: "<none>", insulin: 18, notes: "Long-Acting" }), [
    { kind: "insulin", units: 18, insulin: "Long-acting" },
  ]);
  assert.deepEqual(kinds({ eventType: "Correction Bolus", insulin: 8, isBasalInsulin: true }), [
    { kind: "insulin", units: 8, insulin: "Long-acting" },
  ]);
  // xDrip+ doesn't say which insulin, so the dose isn't logged; priming isn't a dose.
  assert.deepEqual(kinds({ eventType: "<none>", insulin: 10, carbs: 20 }), [
    { kind: "food", carbs: 20, meal: "Meal" },
  ]);
  assert.deepEqual(kinds({ eventType: "Correction Bolus", insulin: 2, type: "PRIMING" }), []);
  assert.deepEqual(kinds({ eventType: "Temp Basal", rate: 0.5, duration: 30 }), []);
  // Trio sends its overrides as "Exercise"; they're kept as sent.
  assert.deepEqual(kinds({ eventType: "Exercise", duration: 60, notes: "Workout" }), []);
});

test("finger-stick glucose from a treatment is logged in mg/dL; sensor glucose is not repeated", () => {
  const glucose = (doc) =>
    project("treatments", doc, at, "x").entries.map((p) => [p.entry.kind, p.entry.glucose]);
  assert.deepEqual(
    glucose({ eventType: "BG Check", glucose: 7.2, units: "mmol", glucoseType: "Finger" }),
    [["glucose", 130]],
  );
  assert.deepEqual(glucose({ eventType: "BG Check", glucose: 143 }), [["glucose", 143]]);
  assert.deepEqual(glucose({ eventType: "Meal Bolus", glucose: 150, glucoseType: "Sensor" }), []);
});

test("reads the paths and queries Nightscout clients send", () => {
  assert.deepEqual(nightscoutRoute("/api/v1/entries.json"), {
    kind: "collection",
    collection: "entries",
    type: null,
    id: null,
  });
  assert.equal(nightscoutRoute("/api/v1/entries/sgv.json").type, "sgv");
  assert.equal(
    nightscoutRoute("/api/v1/treatments/5f2b1c9e8a1b2c3d4e5f6a7b").id,
    "5f2b1c9e8a1b2c3d4e5f6a7b",
  );
  assert.equal(nightscoutRoute("/api/v1/status.json").kind, "status");
  assert.equal(nightscoutRoute("/api/v1/verifyauth").kind, "verifyauth");
  assert.equal(nightscoutRoute("/api/v1/experiments/test").kind, "test");
  assert.equal(nightscoutRoute("/api/v1/activity.json"), null);
  assert.equal(nightscoutRoute("/api/v1/treatments/not%20an%20id"), null);

  const none = { type: null, id: null };
  const query = parseQuery(
    "treatments",
    new URLSearchParams(
      `count=5&find[created_at][$gte]=${iso(at)}&find[date][$lt]=${at + 3600000}&find[eventType]=Meal%20Bolus&find[uuid]=abc`,
    ),
    none,
  );
  assert.deepEqual(query, {
    count: 5,
    from: { at: iso(at), inclusive: true },
    to: { at: iso(at + 3600000), inclusive: false },
    type: "Meal Bolus",
    all: [{ field: "uuid", value: "abc" }],
    any: [],
    descending: true,
  });
  // Trio deletes a manual reading by its id or its time.
  const trio = parseQuery(
    "entries",
    new URLSearchParams(
      `find[$or][0][id][$eq]=A1B2&find[$or][1][dateString][$eq]=${encodeURIComponent(iso(at))}`,
    ),
    none,
  );
  assert.deepEqual(trio.any, [
    { field: "id", value: "A1B2" },
    { field: "at", value: iso(at) },
  ]);
  assert.equal(parseQuery("entries", new URLSearchParams("count=99999"), none).count, 1000);
});

// Route-level tests against a disposable database.

const origin = "https://test.example";
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
async function setup({ withPlan = true } = {}) {
  const db = await createTestDatabase();
  globalThis.nightscoutTestDb = db.database;
  signedIn = mom;
  if (withPlan) assert.equal((await carePost({ action: "plan", plan })).status, 200);
  return db;
}
async function teardown(db) {
  delete globalThis.nightscoutTestDb;
  await db.close();
}
function carePost(body) {
  return care.POST(
    new Request(`${origin}/api/care`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
async function makeToken(label, scopes = ["read", "upload"]) {
  const response = await people.POST(
    new Request(`${origin}/api/people`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "createToken", label, scopes }),
    }),
  );
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body.token;
}
/** A Nightscout client request, authenticated the way xDrip+ and Loop do: the SHA-1 in api-secret. */
async function ns(method, path, token, body) {
  const headers = token ? { "api-secret": await tokenSecret(token) } : {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const handler = { GET: v1.GET, POST: v1.POST, PUT: v1.PUT, DELETE: v1.DELETE }[method];
  const response = await handler(
    new Request(`${origin}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  return { status: response.status, body: await response.json() };
}
const entryRows = (db) => db.all("SELECT id, data FROM entries ORDER BY at, id");
const recent = (ms) => iso(Date.now() - ms);

pgTest(
  "a client's id comes back from every read, a re-upload is a no-op, and delete-and-resend updates",
  async () => {
    const db = await setup();
    try {
      const token = await makeToken("Loop");
      const id = "6F1D2C3B-4A59-4E68-9B7A-1C2D3E4F5A6B";
      const bolus = {
        _id: id,
        eventType: "Meal Bolus",
        created_at: recent(600000),
        carbs: 30,
        insulin: 2,
        enteredBy: "Loop",
      };
      const saved = await ns("POST", "/api/v1/treatments", token, [bolus]);
      assert.equal(saved.status, 200);
      assert.equal(saved.body[0]._id, id);
      assert.equal(saved.body[0].carbs, 30);
      const listed = await ns("GET", "/api/v1/treatments.json", token);
      assert.deepEqual(
        listed.body.map((d) => d._id),
        [id],
      );
      assert.equal((await ns("GET", `/api/v1/treatments/${id}`, token)).body[0]._id, id);
      assert.equal((await entryRows(db)).length, 2);
      const history = await db.all(
        "SELECT action, actor_id, actor_name FROM care_audit WHERE action = 'created'",
      );
      assert.deepEqual(
        history.map((h) => [h.actor_id, h.actor_name]),
        [
          ["github:1", "Mom via Loop"],
          ["github:1", "Mom via Loop"],
        ],
      );

      // The same document again, keys in another order, changes nothing.
      const before = await db.all("SELECT id FROM care_audit");
      const { carbs, ...rest } = bolus;
      assert.equal(
        (await ns("POST", "/api/v1/treatments", token, { ...rest, carbs })).body[0]._id,
        id,
      );
      assert.equal((await db.all("SELECT id FROM care_audit")).length, before.length);

      // An edit replaces the Carby records it made.
      await ns("PUT", "/api/v1/treatments", token, { ...bolus, carbs: 40, insulin: 0 });
      const edited = (await entryRows(db)).map((r) => JSON.parse(r.data));
      assert.deepEqual(
        edited.map((e) => [e.kind, e.carbs]),
        [["food", 40]],
      );

      // Deleting removes them. Loop and Juggluco update by deleting and resending, so the
      // uploader's own resend brings the record back.
      const deleted = await ns("DELETE", `/api/v1/treatments/${id}`, token);
      assert.deepEqual(deleted.body, { n: 1, ok: 1 });
      assert.equal((await entryRows(db)).length, 0);
      assert.deepEqual((await ns("GET", "/api/v1/treatments.json", token)).body, []);
      const again = await ns("POST", "/api/v1/treatments", token, [bolus]);
      assert.equal(again.body[0]._id, id);
      assert.equal((await entryRows(db)).length, 2);
      assert.deepEqual(
        (await ns("GET", "/api/v1/treatments.json", token)).body.map((d) => d._id),
        [id],
      );
    } finally {
      await teardown(db);
    }
  },
);

pgTest(
  "an identifier is kept, and a document sent without one is found by type and time",
  async () => {
    const db = await setup();
    try {
      const token = await makeToken("AAPS");
      const identifier = "0a6e4a4e-6f6c-4b8a-9d3c-5e7f8a9b0c1d";
      const saved = await ns("POST", "/api/v1/treatments", token, {
        identifier,
        eventType: "Correction Bolus",
        created_at: recent(300000),
        insulin: 1,
      });
      assert.equal(saved.body[0].identifier, identifier);
      assert.match(saved.body[0]._id, /^[0-9a-f]{24}$/);
      assert.equal((await ns("DELETE", `/api/v1/treatments/${identifier}`, token)).body.n, 1);
      assert.equal((await entryRows(db)).length, 0);

      // A carb entry with no ids at all: the same event type and time is the same record.
      const carbs = { eventType: "Carb Correction", created_at: recent(200000), carbs: 15 };
      const first = await ns("POST", "/api/v1/treatments", token, carbs);
      const second = await ns("POST", "/api/v1/treatments", token, carbs);
      assert.equal(first.body[0]._id, second.body[0]._id);
      assert.equal((await entryRows(db)).length, 1);
    } finally {
      await teardown(db);
    }
  },
);

pgTest(
  "sensor readings are saved once per time, and never replace another source's reading",
  async () => {
    const db = await setup();
    try {
      const token = await makeToken("xDrip+");
      const date = Date.now() - 300000;
      const sgv = {
        type: "sgv",
        sgv: 120,
        date,
        dateString: iso(date),
        device: "xDrip-DexcomG6",
        direction: "Flat",
      };
      await ns("POST", "/api/v1/entries", token, [sgv]);
      await ns("POST", "/api/v1/entries", token, [sgv]);
      await ns("POST", "/api/v1/entries", token, [{ ...sgv, sgv: 124 }]);
      assert.deepEqual(await db.all("SELECT value, source FROM cgm_readings"), [
        { value: "124", source: "xDrip-DexcomG6" },
      ]);
      assert.equal((await ns("GET", "/api/v1/entries/sgv.json?count=5", token)).body.length, 1);

      // Dexcom Share already has the next reading; the upload doesn't overwrite or delete it.
      const next = date + 300000 - 60000;
      await db.run(
        "INSERT INTO cgm_readings (id, owner, at, value, source) SELECT id, owner, $1, '131', 'Dexcom Share' FROM (SELECT encode(sha256(convert_to($2, 'UTF8')), 'hex') AS id, $3::text AS owner) s",
        iso(next),
        `${mom.userId}|${iso(next)}`,
        mom.userId,
      );
      const shared = { ...sgv, sgv: 200, date: next, dateString: iso(next) };
      const saved = await ns("POST", "/api/v1/entries", token, shared);
      await ns("DELETE", `/api/v1/entries/${saved.body[0]._id}`, token);
      assert.deepEqual(
        await db.all("SELECT value, source FROM cgm_readings WHERE at = $1", iso(next)),
        [{ value: "131", source: "Dexcom Share" }],
      );
    } finally {
      await teardown(db);
    }
  },
);

pgTest("deleting an uploaded entry in Carby stops the uploader bringing it back", async () => {
  const db = await setup();
  try {
    const token = await makeToken("Trio");
    const doc = {
      _id: "trio-1",
      eventType: "Carb Correction",
      created_at: recent(400000),
      carbs: 25,
    };
    await ns("POST", "/api/v1/treatments", token, doc);
    const [food] = await entryRows(db);
    assert.equal((await carePost({ action: "delete", id: food.id })).status, 200);
    // Even changed, the record stays deleted.
    await ns("POST", "/api/v1/treatments", token, { ...doc, carbs: 30 });
    assert.equal((await entryRows(db)).length, 0);
    assert.deepEqual((await ns("GET", "/api/v1/treatments.json", token)).body, []);
  } finally {
    await teardown(db);
  }
});

pgTest("uploads are refused without the right token, a care plan or a valid document", async () => {
  const db = await setup({ withPlan: false });
  try {
    const upload = await makeToken("Uploader", ["upload"]);
    const read = await makeToken("Watch", ["read"]);
    const now = recent(60000);
    assert.equal((await ns("POST", "/api/v1/treatments", null, { created_at: now })).status, 401);
    assert.equal(
      (await ns("POST", "/api/v1/treatments", read, { created_at: now, carbs: 5 })).status,
      403,
    );
    assert.equal((await ns("GET", "/api/v1/treatments.json", upload)).status, 403);
    // Readings need no care plan; treatments that become log entries do.
    const date = Date.now() - 60000;
    assert.equal(
      (await ns("POST", "/api/v1/entries", upload, { type: "sgv", sgv: 100, date })).status,
      200,
    );
    const planless = await ns("POST", "/api/v1/treatments", upload, {
      eventType: "Carb Correction",
      created_at: now,
      carbs: 5,
    });
    assert.equal(planless.status, 422);
    assert.equal(
      (await ns("POST", "/api/v1/treatments", upload, { _id: "bad id!", created_at: now })).status,
      400,
    );
    assert.equal(
      (await ns("POST", "/api/v1/treatments", upload, { eventType: "Note" })).status,
      400,
    );
    const tooMany = Array.from({ length: 1001 }, (_, i) => ({
      type: "sgv",
      sgv: 100,
      date: date - i * 300000,
    }));
    assert.equal((await ns("POST", "/api/v1/entries", upload, tooMany)).status, 413);
    // A reading from the future is answered (Loop needs one answer per document) but not saved.
    const future = await ns("POST", "/api/v1/entries", upload, {
      type: "sgv",
      sgv: 100,
      date: Date.now() + 3600000,
    });
    assert.equal(future.body.length, 1);
    assert.match(future.body[0]._id, /^[0-9a-f]{24}$/);
    assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM nightscout_records")).n, 1);
    assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM cgm_readings")).n, 1);
  } finally {
    await teardown(db);
  }
});

pgTest(
  "clients can check their token, and trade it for a JWT that works until it's revoked",
  async () => {
    const db = await setup();
    try {
      const token = await makeToken("AAPS");
      const status = await ns("GET", "/api/v1/status.json", null);
      assert.equal(status.body.settings.units, "mg/dl");
      assert.deepEqual((await ns("GET", "/api/v1/verifyauth", token)).body.message.canWrite, true);
      assert.deepEqual(
        (await ns("GET", "/api/v1/verifyauth", null)).body.message.rolefound,
        "NOTFOUND",
      );
      assert.equal((await ns("GET", "/api/v1/experiments/test", token)).status, 200);
      assert.equal((await ns("GET", "/api/v1/experiments/test", null)).status, 401);

      const exchanged = await v2.GET(
        new Request(`${origin}/api/v2/authorization/request/${token}`),
      );
      const grant = await exchanged.json();
      assert.equal(grant.sub, "AAPS");
      assert.deepEqual(grant.permissionGroups, [
        ["api:*:read", "api:*:create", "api:*:update", "api:*:delete"],
      ]);
      const bearer = (path) =>
        v1.GET(
          new Request(`${origin}${path}`, { headers: { Authorization: `Bearer ${grant.token}` } }),
        );
      assert.equal((await bearer("/api/v1/treatments.json")).status, 200);
      const id = (await db.get("SELECT id FROM api_tokens")).id;
      assert.equal(
        (
          await people.POST(
            new Request(`${origin}/api/people`, {
              method: "POST",
              headers: { Origin: origin, "Content-Type": "application/json" },
              body: JSON.stringify({ action: "revokeToken", id }),
            }),
          )
        ).status,
        200,
      );
      assert.equal((await bearer("/api/v1/treatments.json")).status, 401);
      assert.equal(
        (await v2.GET(new Request(`${origin}/api/v2/authorization/request/${token}`))).status,
        401,
      );
    } finally {
      await teardown(db);
    }
  },
);

// Contract tests: documents shaped as each app's source sends them (xDrip+ NightscoutUploader.java,
// Juggluco watchserver/*.cpp, LoopKit NightscoutKit, Trio NightscoutAPI.swift), with recent times.
const kinds = async (db) =>
  (await entryRows(db)).map((r) => {
    const e = JSON.parse(r.data);
    return [e.kind, e.carbs ?? e.units ?? e.glucose, e.insulin ?? e.meal ?? e.source];
  });

pgTest("xDrip+: entries in one array, treatments one PUT each, found again by uuid", async () => {
  const db = await setup();
  try {
    const token = await makeToken("xDrip+");
    const date = Date.now() - 600000;
    const entries = await ns("POST", "/api/v1/entries", token, [
      {
        device: "xDrip-DexcomG5",
        date,
        dateString: "2026-09-27T10:40:00.000-0500",
        sgv: 123,
        delta: -1.523,
        direction: "Flat",
        type: "sgv",
        filtered: 123000.0,
        unfiltered: 124500.0,
        rssi: 100,
        noise: 1,
        sysTime: "2026-09-27T10:40:00.000-0500",
      },
      { device: "xDrip-DexcomG5", type: "mbg", date: date - 60000, mbg: 118.0 },
      {
        device: "xDrip-DexcomG5",
        type: "cal",
        date: date - 60000,
        slope: 1000.0,
        intercept: -25000.0,
        scale: 1,
      },
    ]);
    assert.equal(entries.status, 200);
    assert.equal(entries.body.length, 3);
    const uuid = "3f2c9b7e-1a4d-4c8e-9f0a-2b6c7d8e9f01";
    const treatment = {
      timestamp: date,
      eventType: "<none>",
      enteredBy: "xdrip",
      notes: "Lunch",
      uuid,
      carbs: 45,
      insulin: 4.5,
      insulinInjections: '[{"units":4.5,"insulin":"Novorapid"}]',
      created_at: new Date(date).toISOString().replace(/\.\d+Z$/, "Z"),
      _id: "3f2c9b7e1a4d4c8e9f0a2b6c",
    };
    assert.equal((await ns("PUT", "/api/v1/treatments", token, treatment)).status, 200);
    // The reading, the meter check and the meal; xDrip+ doesn't say which insulin it was.
    assert.deepEqual(await db.all("SELECT value, source FROM cgm_readings"), [
      { value: "123", source: "xDrip-DexcomG5" },
    ]);
    assert.deepEqual(await kinds(db), [
      ["glucose", 118, "Finger-stick"],
      ["food", 45, "Meal"],
    ]);
    // xDrip+ finds a treatment's _id by uuid before it deletes it.
    const found = await ns("GET", `/api/v1/treatments.json?find[uuid]=${uuid}`, token);
    assert.equal(found.body[0]._id, "3f2c9b7e1a4d4c8e9f0a2b6c");
    await ns("DELETE", `/api/v1/treatments/${found.body[0]._id}`, token);
    assert.deepEqual(await kinds(db), [["glucose", 118, "Finger-stick"]]);
  } finally {
    await teardown(db);
  }
});

pgTest(
  "Juggluco: a long-acting dose is logged as long-acting, and delete-then-send updates it",
  async () => {
    const db = await setup();
    try {
      const token = await makeToken("Juggluco");
      const date = Date.now() - 900000;
      await ns("POST", "/api/v1/entries", token, [
        {
          type: "sgv",
          device: "3MH0051KF8",
          dateString: "2026-09-27T10:40:00.000-05:00",
          date,
          sgv: 123,
          delta: -1.234,
          direction: "Flat",
          noise: 1,
          filtered: 123000,
          unfiltered: 123000,
          rssi: 100,
        },
      ]);
      const dose = {
        _id: "ba0e17bbbbbbbbbbbbbbbbbb",
        date,
        eventType: "<none>",
        enteredBy: "Juggluco",
        created_at: new Date(date).toISOString(),
        notes: "Long-Acting",
        carbs: null,
        insulin: 18,
        insulinType: "Long insulin",
      };
      assert.equal((await ns("PUT", "/api/v1/treatments", token, dose)).status, 200);
      assert.deepEqual(await kinds(db), [["insulin", 18, "Long-acting"]]);
      // Juggluco sends an edit as a delete of the same _id, then the new document.
      assert.equal((await ns("DELETE", `/api/v1/treatments/${dose._id}`, token)).status, 200);
      await ns("PUT", "/api/v1/treatments", token, { ...dose, insulin: 20 });
      assert.deepEqual(await kinds(db), [["insulin", 20, "Long-acting"]]);
      const [entry] = await entryRows(db);
      assert.equal(JSON.parse(entry.data).note, "");
    } finally {
      await teardown(db);
    }
  },
);

pgTest(
  "Loop: one answer per document with an _id, retries are no-ops, overrides are kept",
  async () => {
    const db = await setup();
    try {
      const token = await makeToken("Loop");
      assert.equal((await ns("GET", "/api/v1/experiments/test", token)).status, 200);
      const at = (ms) => new Date(Date.now() - ms).toISOString().replace(/\.\d+Z$/, "Z");
      const carbs = {
        created_at: at(1200000),
        timestamp: at(1200000),
        enteredBy: "loop://iPhone",
        eventType: "Carb Correction",
        syncIdentifier: "A1B2C3D4-0000-4000-8000-1234567890AB",
        carbs: 45,
        absorptionTime: 180,
        foodType: "🌮",
      };
      const bolus = {
        created_at: at(1100000),
        timestamp: at(1100000),
        enteredBy: "loop://iPhone",
        eventType: "Correction Bolus",
        insulinType: "Humalog",
        syncIdentifier: "6f1c2d3e4a5b",
        type: "normal",
        insulin: 2.35,
        programmed: 2.35,
        unabsorbed: 0,
        duration: 0,
        automatic: true,
      };
      const override = {
        created_at: at(3600000),
        timestamp: at(3600000),
        enteredBy: "Loop",
        _id: "9C1E4A7B-3D2F-4E8A-B6C5-0123456789AB",
        eventType: "Temporary Override",
        duration: 60,
        reason: "🏃 Running",
        insulinNeedsScaleFactor: 0.8,
        correctionRange: [140, 160],
      };
      const first = await ns("POST", "/api/v1/treatments", token, [carbs, bolus, override]);
      assert.equal(first.status, 200);
      assert.equal(first.body.length, 3);
      assert.ok(first.body.every((doc) => typeof doc._id === "string"));
      assert.equal(first.body[2]._id, override._id);
      // A retry of the same batch returns the same ids and saves nothing twice.
      const retry = await ns("POST", "/api/v1/treatments", token, [carbs, bolus, override]);
      assert.deepEqual(
        retry.body.map((d) => d._id),
        first.body.map((d) => d._id),
      );
      assert.deepEqual(await kinds(db), [
        ["food", 45, "Meal"],
        ["insulin", 2.35, "Rapid-acting"],
      ]);
      // Loop edits carbs with PUT and the _id it was given.
      await ns("PUT", "/api/v1/treatments", token, { ...carbs, carbs: 50, _id: first.body[0]._id });
      assert.deepEqual((await kinds(db))[0], ["food", 50, "Meal"]);
      // An override is replaced by deleting its UUID and posting it again.
      await ns("DELETE", `/api/v1/treatments/${override._id}`, token);
      await ns("POST", "/api/v1/treatments", token, [{ ...override, duration: 90 }]);
      const kept = await ns("GET", `/api/v1/treatments/${override._id}`, token);
      assert.equal(kept.body[0].duration, 90);
      const status = [
        {
          device: "loop://iPhone",
          created_at: at(60000),
          loop: { name: "Loop", iob: { iob: 1.23 } },
        },
      ];
      assert.equal((await ns("POST", "/api/v1/devicestatus", token, status)).body.length, 1);
      assert.equal(
        (await ns("GET", "/api/v1/devicestatus.json", token)).body[0].loop.iob.iob,
        1.23,
      );
    } finally {
      await teardown(db);
    }
  },
);

pgTest(
  "Trio: doses and carbs by id, fat and protein rows kept apart, deletes by query",
  async () => {
    const db = await setup();
    try {
      const token = await makeToken("Trio");
      const at = (ms) => new Date(Date.now() - ms).toISOString();
      // Trio checks the connection by posting a note.
      const note = await ns("POST", "/api/v1/treatments.json", token, {
        eventType: "Note",
        enteredBy: "Trio",
        notes: "Trio connected",
        created_at: at(1000),
      });
      assert.equal(note.status, 200);
      const fpu = "F00D0000-1111-4222-8333-444455556666";
      await ns("POST", "/api/v1/treatments.json", token, [
        {
          eventType: "SMB",
          created_at: at(1500000),
          enteredBy: "Trio",
          insulin: 0.3,
          id: "5E0F3C2A-7B1D-4F6E-9A8B-C1D2E3F4A5B6",
        },
        {
          eventType: "Carb Correction",
          created_at: at(1400000),
          enteredBy: "Trio",
          carbs: 12,
          fat: 0,
          protein: 0,
          id: fpu,
        },
        {
          eventType: "Carb Correction",
          created_at: at(1300000),
          enteredBy: "Trio",
          carbs: 10,
          fat: 0,
          protein: 0,
          id: fpu,
        },
      ]);
      assert.deepEqual(await kinds(db), [
        ["insulin", 0.3, "Rapid-acting"],
        ["food", 12, "Meal"],
        ["food", 10, "Meal"],
      ]);
      assert.deepEqual(
        (await ns("DELETE", `/api/v1/treatments.json?find[id][$eq]=${fpu}`, token)).body,
        { n: 2, ok: 1 },
      );
      assert.deepEqual(await kinds(db), [["insulin", 0.3, "Rapid-acting"]]);
      // A manual reading, deleted by id or time.
      const date = Date.now() - 200000;
      await ns("POST", "/api/v1/entries.json", token, [
        { id: "M1", mbg: 150, date, dateString: new Date(date).toISOString(), type: "mbg" },
      ]);
      assert.equal((await kinds(db)).length, 2);
      const gone = await ns(
        "DELETE",
        `/api/v1/entries.json?find[$or][0][id][$eq]=M1&find[$or][1][dateString][$eq]=${encodeURIComponent(new Date(date).toISOString())}`,
        token,
      );
      assert.equal(gone.body.n, 1);
      assert.equal((await kinds(db)).length, 1);
      // A bare delete never empties a collection.
      assert.equal((await ns("DELETE", "/api/v1/treatments.json", token)).status, 400);
    } finally {
      await teardown(db);
    }
  },
);
