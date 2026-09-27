import { mock } from "bun:test";
import assert from "node:assert/strict";
import { createTestDatabase, pgTest } from "./pg-test-helper.mjs";

/**
 * app/api/clarity against a real Postgres and a synthetic Clarity. Every value is synthetic, and
 * `syntheticClarity` replaces `fetch`, recording any request aimed somewhere unexpected.
 */

const SECRET_KEY = "0123456789abcdef".repeat(4);
const OWNER = "github:12345";
const OTHER_OWNER = "github:99999";
const CODE = "ABCD2345WXYZ";
const SUBJECT = "1111111111111111111";
const NAME = "Sample Person";
const HOST = "https://clarity.dexcom.com";
const PDF = "%PDF-1.4 synthetic report";

mock.module("@/app/auth", () => ({
  getCurrentUser: async () => ({ userId: globalThis.clarityTestOwner, displayName: "Tester" }),
}));
mock.module("@/db/raw", () => ({ database: () => globalThis.clarityTestDb }));

const { GET, POST, DELETE } = await import("../app/api/clarity/route.ts");
const report = await import("../app/api/clarity/report/route.ts");
const scheduled = await import("../app/api/clarity/scheduled/route.ts");
const { backfillClarityGap, runScheduledClarity } = await import("../lib/clarity-sync.ts");

const b64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = (subjectId) =>
  `${b64url({ alg: "none" })}.${b64url({ subjectId, exp: 1790532375 })}.signature`;

function csv(rows) {
  return [
    '"Index","Timestamp (YYYY-MM-DDThh:mm:ss)","Event Type","Event Subtype","Patient Info","Device Info","Source Device ID","Glucose Value (mg/dL)","Insulin Value (u)","Carb Value (grams)","Duration (hh:mm:ss)","Glucose Rate of Change (mg/dL/min)","Transmitter Time (Long Integer)","Transmitter ID"',
    '"1","","FirstName","","Sample","","","","","","","","",""',
    '"2","","LastName","","Person","","","","","","","","",""',
    '"3","","Device","","","Dexcom G7","iOS G7","","","","","","",""',
    '"4","","Alert","Urgent Low","","","iOS G7","55","","","","","",""',
    ...rows.map(
      ([at, type, value, sensor = ""], i) =>
        `"${i + 5}","${at}","${type}","","","","iOS G7","${value}","","","","","","${sensor}"`,
    ),
  ].join("\r\n");
}
const READINGS = csv([
  ["2026-09-20T08:04:47", "EGV", "120", "SENSOR1"],
  ["2026-09-20T08:09:47", "EGV", "126", "SENSOR1"],
  ["2026-09-20T08:10:12", "Calibration", "118"],
]);

/** Stand in for Clarity. `subject` and `redeem` can change mid-test to model a replaced code. */
function syntheticClarity({ subject = SUBJECT, redeem = 200, body = READINGS } = {}) {
  const original = globalThis.fetch;
  const clarity = {
    subject,
    redeem,
    body,
    calls: [],
    foreign: [],
    restore: () => (globalThis.fetch = original),
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    // The client sends form bodies as URLSearchParams and JSON bodies as strings.
    const body = init.body instanceof URLSearchParams ? init.body.toString() : (init.body ?? null);
    clarity.calls.push({ url: url.href, body });
    if (url.host === "storage.googleapis.com") return new Response(PDF);
    if (url.origin !== HOST) {
      clarity.foreign.push(url.href);
      return new Response("unexpected", { status: 500 });
    }
    if (url.pathname === "/api/access_code/redeem") {
      if (clarity.redeem !== 200 || url.searchParams.get("accesscode") !== CODE)
        return Response.json({ errorName: "INVALID_ACCESS_CODE" }, { status: 400 });
      return Response.json({ accessToken: token(clarity.subject) });
    }
    if (url.pathname === "/user/sharing")
      return new Response(null, {
        status: 302,
        headers: { location: `${HOST}/`, "set-cookie": "_rogue_material_session=abc; path=/" },
      });
    if (url.pathname === "/subject_info")
      return Response.json({
        first_name: "Sample",
        last_name: "Person",
        locale: "en-US",
        country: "US",
      });
    if (url.pathname === `/api/subject/${clarity.subject}/export`)
      return new Response(clarity.body, { headers: { "content-type": "text/csv; charset=UTF-8" } });
    if (url.pathname === `/api/subject/${clarity.subject}/analysis_session`)
      return Response.json({ analysisSessionId: "session-1" });
    if (url.pathname === "/reports/generate")
      return Response.json({
        status: "complete",
        url: `${HOST}/report/r1/status`,
        urls: { attachment: "https://storage.googleapis.com/bucket/report.pdf" },
      });
    clarity.foreign.push(url.href);
    return new Response("unexpected", { status: 500 });
  };
  return clarity;
}

async function setup(owner = OWNER) {
  const db = await createTestDatabase();
  globalThis.clarityTestDb = db.database;
  globalThis.clarityTestOwner = owner;
  process.env.DEXCOM_SECRET_KEY = SECRET_KEY;
  for (const who of [OWNER, OTHER_OWNER])
    await db.run(
      "INSERT INTO plans (id, owner, data, created) VALUES ($1, $2, $3, $4)",
      `plan-${who}`,
      who,
      JSON.stringify({ timezone: "America/Chicago" }),
      "2026-09-01T00:00:00.000Z",
    );
  return db;
}
async function teardown(db, clarity) {
  clarity?.restore();
  delete process.env.DEXCOM_SECRET_KEY;
  delete process.env.CARBY_SCHEDULER_TOKEN;
  delete globalThis.clarityTestDb;
  delete globalThis.clarityTestOwner;
  await db.close();
}

const post = (payload) =>
  POST(
    new Request("https://test.example/api/clarity", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://test.example" },
      body: JSON.stringify(payload),
    }),
  );
/** The parsed body; the share code must never come back to the browser. */
async function body(response) {
  const text = await response.text();
  assert.equal(text.includes(CODE), false, `the share code reached the browser in: ${text}`);
  return JSON.parse(text);
}
const connect = (extra = {}) =>
  post({
    action: "connect",
    code: "abcd-2345-wxyz",
    region: "us",
    subjectName: NAME,
    autoSync: true,
    monthlyReports: [],
    ...extra,
  });

pgTest("check shows whose data a code opens and stores nothing", async () => {
  const db = await setup();
  const clarity = syntheticClarity();
  try {
    const checked = await body(
      await post({ action: "check", code: "abcd 2345 wxyz", region: "us" }),
    );
    assert.equal(checked.subjectName, NAME);
    assert.equal(checked.expiresAt, "2026-09-27T18:06:15.000Z");
    assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM clarity_connections")).n, 0);
    assert.deepEqual(clarity.foreign, []);
  } finally {
    await teardown(db, clarity);
  }
});

pgTest("connect refuses a code that opens someone other than the confirmed person", async () => {
  const db = await setup();
  const clarity = syntheticClarity();
  try {
    const response = await connect({ subjectName: "Someone Else" });
    assert.equal(response.status, 409);
    await body(response);
    assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM clarity_connections")).n, 0);
  } finally {
    await teardown(db, clarity);
  }
});

pgTest(
  "sync imports readings in the plan's time zone once, and the code stays sealed",
  async () => {
    const db = await setup();
    const clarity = syntheticClarity();
    try {
      assert.equal((await body(await connect())).connected, true);
      const row = await db.get(
        "SELECT credentials FROM clarity_connections WHERE owner = $1",
        OWNER,
      );
      assert.equal(row.credentials.includes(CODE), false, "the stored code is ciphertext");

      const first = await body(
        await post({ action: "sync", start: "2026-09-19", end: "2026-09-21" }),
      );
      assert.deepEqual(
        { ...first.result },
        { readings: 2, changed: 2, events: 1, newEvents: 1, skipped: 0 },
      );
      assert.equal(first.syncedThrough, "2026-09-21");
      assert.equal(first.lastError, null);
      // The sensor and the app's alert settings are kept for reports.
      assert.deepEqual(
        await db.all(
          "SELECT sensor_id, source, first_at, last_at FROM sensor_sessions WHERE owner = $1",
          OWNER,
        ),
        [
          {
            sensor_id: "SENSOR1",
            source: "iOS G7",
            first_at: "2026-09-20T13:04:47.000Z",
            last_at: "2026-09-20T13:09:47.000Z",
          },
        ],
      );
      assert.deepEqual(
        JSON.parse(
          (await db.get("SELECT data FROM cgm_device_settings WHERE owner = $1", OWNER)).data,
        ),
        {
          model: "Dexcom G7",
          sensor: null,
          alerts: [{ kind: "Urgent Low", glucose: 55, rate: null, minutes: null }],
        },
      );
      // Clarity's ranges are half-open; an inclusive end of the 21st is sent as the 22nd.
      const exported = clarity.calls.find((call) => call.url.endsWith("/export"));
      assert.equal(new URLSearchParams(exported.body).get("dateInterval"), "2026-09-19/2026-09-22");
      // 08:04:47 in Chicago during daylight time is 13:04:47 UTC.
      assert.deepEqual(
        await db.all(
          "SELECT at, value, source FROM cgm_readings WHERE owner = $1 ORDER BY at",
          OWNER,
        ),
        [
          { at: "2026-09-20T13:04:47.000Z", value: "120", source: "Dexcom Clarity" },
          { at: "2026-09-20T13:09:47.000Z", value: "126", source: "Dexcom Clarity" },
        ],
      );
      const again = await body(
        await post({ action: "sync", start: "2026-09-19", end: "2026-09-21" }),
      );
      assert.equal(again.result.changed, 0);
      assert.equal(again.result.newEvents, 0);
      // An earlier range never moves synced_through backward.
      assert.equal(
        (await body(await post({ action: "sync", start: "2026-09-01", end: "2026-09-02" })))
          .syncedThrough,
        "2026-09-21",
      );
      assert.deepEqual(clarity.foreign, []);
    } finally {
      await teardown(db, clarity);
    }
  },
);

pgTest(
  "a code that now opens a different account, or none, stops the sync and says why",
  async () => {
    const db = await setup();
    const clarity = syntheticClarity();
    try {
      await body(await connect());
      clarity.subject = "2222222222222222222";
      const swapped = await post({ action: "sync", start: "2026-09-19", end: "2026-09-21" });
      assert.equal(swapped.status, 422);
      assert.match((await body(swapped)).error, /different Clarity account/);

      clarity.subject = SUBJECT;
      clarity.redeem = 400;
      const expired = await post({ action: "sync", start: "2026-09-19", end: "2026-09-21" });
      assert.equal(expired.status, 422);
      const { error } = await body(expired);
      assert.match(error, /Generate a new one/);
      assert.equal(
        (await body(await GET(new Request("https://test.example/api/clarity")))).lastError,
        error,
      );
      assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM cgm_readings")).n, 0);
    } finally {
      await teardown(db, clarity);
    }
  },
);

pgTest("an archived report downloads for its owner only and outlives a disconnect", async () => {
  const db = await setup();
  const clarity = syntheticClarity();
  try {
    await body(await connect());
    const made = await body(
      await post({
        action: "report",
        reports: ["agp", "overview"],
        start: "2026-09-01",
        end: "2026-09-14",
      }),
    );
    // Kinds come back in Clarity's order, whatever order they were asked in.
    assert.deepEqual(made.report.reports, ["overview", "agp"]);
    assert.equal(made.reports.length, 1);
    const url = `https://test.example/api/clarity/report?id=${made.report.id}`;
    const pdf = await report.GET(new Request(url));
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.equal(await pdf.text(), PDF);

    await body(await DELETE(new Request("https://test.example/api/clarity", { method: "DELETE" })));
    assert.equal((await report.GET(new Request(url))).status, 200);

    globalThis.clarityTestOwner = OTHER_OWNER;
    assert.equal((await report.GET(new Request(url))).status, 404);
    assert.equal((await report.DELETE(new Request(url, { method: "DELETE" }))).status, 404);
    assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM clarity_reports")).n, 1);
  } finally {
    await teardown(db, clarity);
  }
});

pgTest(
  "the schedule syncs about daily and archives last month once, only if it has readings",
  async () => {
    const db = await setup();
    const clarity = syntheticClarity();
    try {
      await body(await connect({ monthlyReports: ["agp"] }));
      // Mid-September in Chicago, so every run falls in the same month and looks at August.
      const now = new Date("2026-09-10T17:00:00Z");
      const hoursLater = (hours) => new Date(now.getTime() + hours * 3600000);
      const archived = () =>
        db.all(
          "SELECT start_date, end_date, scheduled FROM clarity_reports WHERE owner = $1",
          OWNER,
        );
      assert.deepEqual(await runScheduledClarity(db.database, now), {
        synced: 1,
        backfilled: 0,
        failed: 0,
      });
      // Claimed moments ago, so a second process or the next hourly tick finds nothing due.
      assert.deepEqual(await runScheduledClarity(db.database, now), {
        synced: 0,
        backfilled: 0,
        failed: 0,
      });
      assert.deepEqual(await runScheduledClarity(db.database, hoursLater(21)), {
        synced: 1,
        backfilled: 0,
        failed: 0,
      });
      assert.equal(
        (await db.get("SELECT synced_through FROM clarity_connections WHERE owner = $1", OWNER))
          .synced_through,
        "2026-09-11",
      );
      assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM cgm_readings")).n, 2);
      // August has no readings, so no blank report was stored.
      assert.deepEqual(await archived(), []);

      // A reading from the last local evening of August (Sep 1 02:00 UTC) makes it worth archiving.
      await db.run(
        "INSERT INTO cgm_readings (id, owner, at, value, source) VALUES ($1, $2, $3, $4, $5)",
        "late-august",
        OWNER,
        "2026-09-01T02:00:00.000Z",
        "120",
        "Dexcom Clarity",
      );
      for (const hours of [42, 63])
        assert.deepEqual(await runScheduledClarity(db.database, hoursLater(hours)), {
          synced: 1,
          backfilled: 0,
          failed: 0,
        });
      assert.deepEqual(await archived(), [
        { start_date: "2026-08-01", end_date: "2026-08-31", scheduled: true },
      ]);

      await body(await post({ action: "settings", autoSync: false, monthlyReports: [] }));
      assert.deepEqual(await runScheduledClarity(db.database, hoursLater(96)), {
        synced: 0,
        backfilled: 0,
        failed: 0,
      });
    } finally {
      await teardown(db, clarity);
    }
  },
);

pgTest(
  "a gap from being out of range fills from Clarity, retrying at most every half hour",
  async () => {
    const db = await setup();
    const clarity = syntheticClarity();
    const share = (at, value) =>
      db.run(
        "INSERT INTO cgm_readings (id, owner, at, value, source) VALUES ($1, $2, $3, $4, $5)",
        `share-${at}`,
        OWNER,
        at,
        String(value),
        "Dexcom Share",
      );
    const exports = () => clarity.calls.filter((c) => c.url.endsWith("/export")).length;
    const minutesAfter = (minutes) =>
      new Date(Date.parse("2026-09-20T13:20:00Z") + minutes * 60000);
    try {
      await body(await connect());
      // Share stops at 07:50 Chicago time and resumes at 08:20. Clarity has 08:04 and 08:09.
      await share("2026-09-20T12:50:00.000Z", 110);
      await share("2026-09-20T13:20:00.000Z", 130);

      const filled = await backfillClarityGap(db.database, OWNER, minutesAfter(20));
      assert.deepEqual(filled.gap, {
        from: "2026-09-20T12:50:00.000Z",
        to: "2026-09-20T13:20:00.000Z",
      });
      assert.equal(filled.result.changed, 2);
      assert.match(clarity.calls.at(-1).body, /dateInterval=2026-09-20%2F2026-09-21/);
      // Filled, so later checks find nothing to ask about.
      assert.equal(await backfillClarityGap(db.database, OWNER, minutesAfter(60)), null);
      assert.equal(exports(), 1);

      // Out of range again 09:00–09:30 Chicago, and Clarity has nothing for it either.
      clarity.body = csv([]);
      await share("2026-09-20T14:00:00.000Z", 140);
      await share("2026-09-20T14:30:00.000Z", 150);
      const tried = await backfillClarityGap(db.database, OWNER, minutesAfter(75));
      assert.equal(tried.result.changed, 0);
      assert.equal(exports(), 2);
      // Asked 10 minutes ago: wait. After half an hour: ask again. Six hours after it closed: stop.
      assert.equal(await backfillClarityGap(db.database, OWNER, minutesAfter(85)), null);
      assert.notEqual(await backfillClarityGap(db.database, OWNER, minutesAfter(106)), null);
      assert.equal(await backfillClarityGap(db.database, OWNER, minutesAfter(70 + 361)), null);
      assert.equal(exports(), 3);

      // The hourly scheduler fills a new gap for an account synced earlier in the day.
      await share("2026-09-20T20:00:00.000Z", 160);
      assert.deepEqual(await runScheduledClarity(db.database, minutesAfter(430)), {
        synced: 0,
        backfilled: 1,
        failed: 0,
      });

      // With automatic sync off, gaps are left for the person to sync by hand.
      await body(await post({ action: "settings", autoSync: false, monthlyReports: [] }));
      await share("2026-09-20T21:00:00.000Z", 170);
      assert.equal(await backfillClarityGap(db.database, OWNER, minutesAfter(500)), null);
      assert.equal(exports(), 4);
      assert.deepEqual(clarity.foreign, []);
    } finally {
      await teardown(db, clarity);
    }
  },
);

pgTest("the scheduler endpoint answers only the launcher's token", async () => {
  const db = await setup();
  const clarity = syntheticClarity();
  const call = (authorization) =>
    scheduled.POST(
      new Request("http://127.0.0.1/api/clarity/scheduled", {
        method: "POST",
        headers: authorization ? { Authorization: authorization } : {},
      }),
    );
  try {
    assert.equal((await call("Bearer anything")).status, 404, "no token configured");
    process.env.CARBY_SCHEDULER_TOKEN = "launcher-token";
    assert.equal((await call()).status, 404);
    assert.equal((await call("Bearer wrong-token")).status, 404);
    const ok = await call("Bearer launcher-token");
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { synced: 0, backfilled: 0, failed: 0 });
  } finally {
    await teardown(db, clarity);
  }
});
