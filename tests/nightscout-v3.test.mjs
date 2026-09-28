import { mock, test } from "bun:test";
import assert from "node:assert/strict";
import { createTestDatabase, pgTest } from "./pg-test-helper.mjs";

const mom = { userId: "github:1", displayName: "Mom" };
mock.module("@/app/auth", () => ({ getCurrentUser: async () => mom }));
mock.module("@/db/raw", () => ({ database: () => globalThis.nightscoutV3TestDb }));
const people = await import("../app/api/people/route.ts");
const care = await import("../app/api/care/route.ts");
const v3 = await import("../app/api/v3/[...path]/route.ts");
const v2 = await import("../app/api/v2/authorization/request/[token]/route.ts");
const { v3Identifier, v3Route, parseV3Query } = await import("../lib/nightscout.ts");

test("a document sent without an identifier gets the one Nightscout would give it", async () => {
  // Reference values from Python's uuid.uuid5 with Nightscout's "NightscoutRocks!" namespace.
  assert.equal(
    await v3Identifier({ eventType: "Meal Bolus" }, 1727451600000),
    "a34e3798-52b6-5967-9b9c-d20bf315fe52",
  );
  assert.equal(
    await v3Identifier({ device: "openaps://samsung" }, 1727451600000),
    "88273a64-813d-5421-9112-915a2888b359",
  );
});

test("reads the v3 paths and search parameters AAPS sends", () => {
  assert.deepEqual(v3Route("/api/v3/treatments/history/1727451500000"), {
    kind: "history",
    collection: "treatments",
    since: 1727451500000,
  });
  assert.deepEqual(v3Route("/api/v3/entries/abc-123"), {
    kind: "document",
    collection: "entries",
    identifier: "abc-123",
  });
  assert.equal(v3Route("/api/v3/lastModified").kind, "lastModified");
  assert.equal(v3Route("/api/v3/food").kind, "search");
  assert.equal(v3Route("/api/v3/activity"), null);
  const query = parseV3Query(
    "entries",
    new URLSearchParams(
      "sort$desc=date&type=sgv&limit=6&fields=sgv,direction&date$gt=1727451600000",
    ),
  );
  assert.equal(query.count, 6);
  assert.equal(query.type, "sgv");
  assert.equal(query.descending, true);
  assert.deepEqual(query.from, { at: new Date(1727451600000).toISOString(), inclusive: false });
  assert.equal(
    parseV3Query("treatments", new URLSearchParams("sort=created_at")).descending,
    false,
  );
});

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
const post = (handler, path, body) =>
  handler.POST(
    new Request(`${origin}${path}`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
async function setup() {
  const db = await createTestDatabase();
  globalThis.nightscoutV3TestDb = db.database;
  assert.equal((await post(care, "/api/care", { action: "plan", plan })).status, 200);
  return db;
}
async function teardown(db) {
  delete globalThis.nightscoutV3TestDb;
  await db.close();
}
async function jwtFor(label, scopes = ["read", "upload"]) {
  const made = await (
    await post(people, "/api/people", { action: "createToken", label, scopes })
  ).json();
  const grant = await v2.GET(new Request(`${origin}/api/v2/authorization/request/${made.token}`));
  return (await grant.json()).token;
}
/** An API v3 request as AAPS makes it: a Bearer JWT, and a Date header Nightscout ignores. */
async function call(method, path, jwt, body) {
  const headers = { Date: String(Date.now()) };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await v3[method](
    new Request(`${origin}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  return { status: response.status, headers: response.headers, body: await response.json() };
}
const kinds = async (db) =>
  (await db.all("SELECT data FROM entries ORDER BY at, id")).map((r) => {
    const e = JSON.parse(r.data);
    return [e.kind, e.carbs ?? e.units, e.insulin ?? e.meal];
  });

pgTest("AAPS: status says what the token may do, and only a full token can upload", async () => {
  const db = await setup();
  try {
    assert.equal((await call("GET", "/api/v3/status", "")).status, 401);
    const full = await call("GET", "/api/v3/status", await jwtFor("AAPS"));
    assert.equal(full.body.result.apiVersion, "3.0.5");
    assert.deepEqual(full.body.result.apiPermissions, {
      entries: "crud",
      treatments: "crud",
      devicestatus: "crud",
      profile: "crud",
      food: "crud",
      settings: "crud",
    });
    const reader = await call("GET", "/api/v3/status", await jwtFor("Watch", ["read"]));
    assert.equal(reader.body.result.apiPermissions.treatments, "r");
  } finally {
    await teardown(db);
  }
});

pgTest("AAPS: create, deduplicate, patch, delete, and learn it all from history", async () => {
  const db = await setup();
  try {
    const jwt = await jwtFor("AAPS");
    const date = Date.now() - 900000;
    const meal = {
      date,
      utcOffset: -300,
      app: "AAPS",
      isReadOnly: false,
      isValid: true,
      eventType: "Meal Bolus",
      notes: "lunch",
      carbs: 45.0,
    };
    const created = await call("POST", "/api/v3/treatments", jwt, meal);
    assert.equal(created.status, 201);
    assert.match(
      created.body.identifier,
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const identifier = created.body.identifier;
    const again = await call("POST", "/api/v3/treatments", jwt, meal);
    assert.equal(again.status, 200);
    assert.equal(again.body.isDeduplication, true);
    assert.equal(again.body.identifier, identifier);
    const smb = await call("POST", "/api/v3/treatments", jwt, {
      date: date + 60000,
      utcOffset: -300,
      app: "AAPS",
      isReadOnly: false,
      isValid: true,
      eventType: "Correction Bolus",
      insulin: 0.35,
      type: "SMB",
      isBasalInsulin: false,
      pumpId: 4102,
      pumpType: "OMNIPOD_DASH",
      pumpSerial: "33013206",
    });
    assert.equal(smb.status, 201);
    assert.deepEqual(await kinds(db), [
      ["food", 45, "Meal"],
      ["insulin", 0.35, "Rapid-acting"],
    ]);

    // AAPS pages history by the ETag, W/"<ms>".
    const history = await call("GET", "/api/v3/treatments/history/0", jwt);
    assert.deepEqual(
      history.body.result.map((d) => d.identifier),
      [identifier, smb.body.identifier],
    );
    assert.ok(
      history.body.result.every((d) => d.isValid === true && typeof d.srvModified === "number"),
    );
    const etag = history.headers.get("ETag");
    assert.match(etag, /^W\/"\d+"$/);
    const since = etag.slice(3, -1);
    assert.deepEqual(
      (await call("GET", `/api/v3/treatments/history/${since}`, jwt)).body.result,
      [],
    );

    // An update sends the changed fields with the stored identifier and event type, and no date.
    const patched = await call("PATCH", `/api/v3/treatments/${identifier}`, jwt, {
      app: "AAPS",
      isValid: true,
      identifier,
      eventType: "Meal Bolus",
      notes: "lunch",
      carbs: 50.0,
    });
    assert.equal(patched.status, 200);
    assert.deepEqual((await kinds(db))[0], ["food", 50, "Meal"]);
    const refused = await call("PATCH", `/api/v3/treatments/${identifier}`, jwt, {
      eventType: "Snack Bolus",
    });
    assert.equal(refused.status, 400);
    assert.match(refused.body.message, /cannot be modified/);

    // A deletion reaches history as isValid: false and leaves search.
    assert.equal((await call("DELETE", `/api/v3/treatments/${identifier}`, jwt)).status, 200);
    const later = await call("GET", `/api/v3/treatments/history/${since}`, jwt);
    assert.deepEqual(
      later.body.result.map((d) => [d.identifier, d.isValid]),
      [[identifier, false]],
    );
    assert.equal((await call("GET", `/api/v3/treatments/${identifier}`, jwt)).status, 410);
    assert.equal((await call("PUT", `/api/v3/treatments/${identifier}`, jwt, meal)).status, 410);
    const search = await call("GET", "/api/v3/treatments?sort=date&limit=10", jwt);
    assert.deepEqual(
      search.body.result.map((d) => d.identifier),
      [smb.body.identifier],
    );
    assert.deepEqual(await kinds(db), [["insulin", 0.35, "Rapid-acting"]]);

    const modified = await call("GET", "/api/v3/lastModified", jwt);
    assert.equal(modified.body.result.collections.treatments, later.body.result[0].srvModified);
  } finally {
    await teardown(db);
  }
});

pgTest("Juggluco v3: readings one per request, and delete-then-send updates a dose", async () => {
  const db = await setup();
  try {
    const jwt = await jwtFor("Juggluco");
    const base = Date.now() - 1800000;
    for (let i = 0; i < 3; i++) {
      const saved = await call("POST", "/api/v3/entries", jwt, {
        app: "Juggluco",
        device: "3MH0051KF8",
        date: base + i * 300000,
        sgv: 120 + i,
        delta: 1,
        direction: "Flat",
        type: "sgv",
        utcOffset: 0,
        identifier: `4b33304d-4830-3035-46ee-${String(1234 + i).padStart(12, "e")}`,
        _id: `4b33304d4830303546ee${1234 + i}`,
      });
      assert.equal(saved.status, 201);
    }
    const latest = await call("GET", "/api/v3/entries?sort$desc=date&type=sgv&limit=2", jwt);
    assert.deepEqual(
      latest.body.result.map((d) => d.sgv),
      [122, 121],
    );
    assert.equal(latest.body.result[0].date, base + 600000);

    const dose = {
      identifier: "0fffffff-ffff-ffff-ffff-17ffffffffff",
      _id: "ba0e17bbbbbbbbbbbbbbbbbb",
      date: base,
      utcOffset: 0,
      eventType: "<none>",
      app: "Juggluco",
      notes: "Rapid-Acting",
      insulin: 4.5,
      insulinType: "Fast insulin",
    };
    assert.equal((await call("POST", "/api/v3/treatments", jwt, dose)).status, 201);
    assert.equal((await call("DELETE", `/api/v3/treatments/${dose.identifier}`, jwt)).status, 200);
    assert.equal(
      (await call("POST", "/api/v3/treatments", jwt, { ...dose, insulin: 5 })).status,
      200,
    );
    assert.deepEqual(await kinds(db), [["insulin", 5, "Rapid-acting"]]);
  } finally {
    await teardown(db);
  }
});
