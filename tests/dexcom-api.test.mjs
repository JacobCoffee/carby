import { mock } from "bun:test";
import assert from "node:assert/strict";
import { createTestDatabase, pgTest } from "./pg-test-helper.mjs";

/**
 * Regression tests for app/api/dexcom/route.ts against a real Postgres: the native `$n`
 * placeholders, and the server-side defaults the connect form leans on.
 *
 * Every value here is synthetic. The encryption is real — the route seals with the key below and
 * these tests unseal the stored row — but no request leaves the process: `syntheticShare` replaces
 * `fetch` and records anything aimed somewhere unexpected instead of sending it.
 */

// A throwaway 32-byte key in the shape DEXCOM_SECRET_KEY requires. It guards nothing real.
const SECRET_KEY = "0123456789abcdef".repeat(4);
const CONFIGURED_PASSWORD = "configured-share-password";
const TYPED_PASSWORD = "typed-share-password";
const USERNAME = "publisher@example.com";
const OWNER = "github:12345";
const OTHER_OWNER = "github:99999";
const LOCAL_OWNER = "local_dev";
const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";

mock.module("@/app/auth", () => ({
  getCurrentUser: async () => ({
    userId: globalThis.dexcomTestOwner,
    displayName: "Synthetic tester",
  }),
}));
mock.module("@/db/raw", () => ({ database: () => globalThis.dexcomTestDb }));

const { GET, POST, DELETE } = await import("../app/api/dexcom/route.ts");
const { unseal } = await import("../lib/dexcom-share.ts");

const ENV_KEYS = [
  "DEXCOM_SECRET_KEY",
  "DEXCOM_USERNAME",
  "DEXCOM_PASSWORD",
  "DEXCOM_REGION",
  "DEXCOM_DEFAULT_OWNER",
  "CARBY_AUTH_MODE",
  "CARBY_LOCAL_LAUNCHER",
];
const scopedEnv = {
  DEXCOM_SECRET_KEY: SECRET_KEY,
  DEXCOM_USERNAME: USERNAME,
  DEXCOM_PASSWORD: CONFIGURED_PASSWORD,
  DEXCOM_REGION: "ous",
  DEXCOM_DEFAULT_OWNER: OWNER,
};

/** Assigning undefined to process.env stores the string "undefined", so unset really unsets. */
function setEnv(values) {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values))
    if (value !== undefined) process.env[key] = value;
}

const US_BASE = "https://share2.dexcom.com/ShareWebServices/Services/";
const OUS_BASE = "https://shareous1.dexcom.com/ShareWebServices/Services/";

function shareValue(minutesAgo, value) {
  return { DT: `/Date(${Date.now() - minutesAgo * 60000})/`, Value: value };
}

/**
 * Stand in for Dexcom Share. `calls` keeps what each request carried so a test can prove which
 * password actually went upstream; `foreign` collects any URL outside the Share bases, which is
 * asserted empty rather than thrown, since the route would otherwise fold a throw into a 503.
 */
function syntheticShare({
  base = OUS_BASE,
  values = [shareValue(10, 118), shareValue(5, 126)],
  readFailure = null,
} = {}) {
  const original = globalThis.fetch;
  const share = { calls: [], foreign: [], restore: () => (globalThis.fetch = original) };
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    share.calls.push({ url, body });
    if (!url.startsWith(base)) {
      share.foreign.push(url);
      return Response.json({ Code: "Unexpected" }, { status: 500 });
    }
    const path = url.slice(base.length).split("?")[0];
    if (path === "General/AuthenticatePublisherAccount") return Response.json(ACCOUNT_ID);
    if (path === "General/LoginPublisherAccountById") return Response.json(SESSION_ID);
    if (path === "Publisher/ReadPublisherLatestGlucoseValues")
      return readFailure
        ? Response.json({ Code: readFailure }, { status: 500 })
        : Response.json(values);
    share.foreign.push(url);
    return Response.json({ Code: "Unexpected" }, { status: 500 });
  };
  return share;
}

/** Every password sent upstream, in order. */
function passwordsSent(share) {
  return share.calls.map((call) => call.body?.password).filter((value) => value !== undefined);
}

async function setup(owner, env = scopedEnv) {
  const db = await createTestDatabase();
  globalThis.dexcomTestDb = db.database;
  globalThis.dexcomTestOwner = owner;
  setEnv(env);
  return db;
}

async function teardown(db, share) {
  share?.restore();
  setEnv({});
  delete globalThis.dexcomTestDb;
  delete globalThis.dexcomTestOwner;
  await db.close();
}

const get = () => GET(new Request("https://test.example/api/dexcom"));
const post = (body) =>
  POST(
    new Request("https://test.example/api/dexcom", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://test.example" },
      body: JSON.stringify(body),
    }),
  );
const remove = () =>
  DELETE(
    new Request("https://test.example/api/dexcom", {
      method: "DELETE",
      headers: { Origin: "https://test.example" },
    }),
  );

/** The parsed body, plus its raw text so a secret cannot hide in a field nobody asserted on. */
async function body(response) {
  const text = await response.text();
  for (const secret of [CONFIGURED_PASSWORD, TYPED_PASSWORD, SECRET_KEY])
    assert.equal(text.includes(secret), false, `a secret reached the browser in: ${text}`);
  return JSON.parse(text);
}

pgTest("the configured owner is offered the username and region, never the password", async () => {
  const db = await setup(OWNER);
  try {
    const status = await body(await get());
    assert.equal(status.connected, false);
    assert.deepEqual(status.defaults, { username: USERNAME, region: "ous", hasPassword: true });
    assert.equal(Object.keys(status.defaults).includes("password"), false);
  } finally {
    await teardown(db);
  }
});

pgTest(
  "another signed-in owner gets no defaults and cannot borrow the configured password",
  async () => {
    const db = await setup(OTHER_OWNER);
    const share = syntheticShare();
    try {
      const status = await body(await get());
      assert.equal(status.defaults, null);
      // Asking by name resolves to no password at all, so the route stops at its own validation.
      const response = await post({
        action: "connect",
        username: USERNAME,
        region: "ous",
        useConfiguredPassword: true,
      });
      assert.equal(response.status, 400);
      await body(response);
      assert.deepEqual(share.calls, [], "a denied request must not reach Dexcom");
      assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM dexcom_connections")).n, 0);
    } finally {
      await teardown(db, share);
    }
  },
);

pgTest(
  "the configured owner connects with the configured password and it is stored encrypted",
  async () => {
    const db = await setup(OWNER);
    const share = syntheticShare();
    try {
      const result = await body(
        await post({
          action: "connect",
          username: USERNAME,
          password: "",
          region: "ous",
          useConfiguredPassword: true,
        }),
      );
      assert.equal(result.connected, true);
      assert.equal(result.count, 2);
      assert.equal(result.rawCount, 2);
      assert.deepEqual(share.foreign, []);
      // The password the operator configured is the one Dexcom saw, and it never came from the body.
      assert.deepEqual(passwordsSent(share), [CONFIGURED_PASSWORD, CONFIGURED_PASSWORD]);

      const row = await db.get("SELECT * FROM dexcom_connections WHERE owner = $1", OWNER);
      assert.equal(row.owner, OWNER);
      assert.equal(
        row.credentials.includes(CONFIGURED_PASSWORD),
        false,
        "credentials are ciphertext",
      );
      const stored = await unseal(row.credentials, OWNER);
      assert.deepEqual(stored, {
        username: USERNAME,
        password: CONFIGURED_PASSWORD,
        region: "ous",
        sessionId: SESSION_ID,
      });
      // The ciphertext is bound to its owner, so another owner cannot open it.
      await assert.rejects(() => unseal(row.credentials, OTHER_OWNER));
      assert.equal(row.last_error, null);
      assert.equal(row.last_sync, row.last_attempt_at);
      assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM cgm_readings")).n, 2);
      const saved = await db.get(
        "SELECT owner, source, value FROM cgm_readings ORDER BY at DESC LIMIT 1",
      );
      assert.equal(saved.owner, OWNER);
      assert.equal(saved.source, "Dexcom Share");
      assert.equal(saved.value, "126");
    } finally {
      await teardown(db, share);
    }
  },
);

pgTest("a typed password overrides the configured one all the way to Dexcom", async () => {
  const db = await setup(OWNER);
  const share = syntheticShare();
  try {
    await body(
      await post({
        action: "connect",
        username: USERNAME,
        password: TYPED_PASSWORD,
        region: "ous",
        useConfiguredPassword: true,
      }),
    );
    assert.deepEqual(passwordsSent(share), [TYPED_PASSWORD, TYPED_PASSWORD]);
    const row = await db.get("SELECT credentials FROM dexcom_connections WHERE owner = $1", OWNER);
    assert.equal((await unseal(row.credentials, OWNER)).password, TYPED_PASSWORD);
  } finally {
    await teardown(db, share);
  }
});

pgTest(
  "an edited account drops back to the typed password instead of reusing the configured one",
  async () => {
    const db = await setup(OWNER);
    const share = syntheticShare({ base: US_BASE });
    try {
      // A different region than the configured pair, so the reuse rule must not match.
      const response = await post({
        action: "connect",
        username: USERNAME,
        region: "us",
        useConfiguredPassword: true,
      });
      assert.equal(response.status, 400);
      assert.deepEqual(share.calls, []);
      // With a password typed in, the same edited account connects normally.
      const connected = await body(
        await post({
          action: "connect",
          username: USERNAME,
          password: TYPED_PASSWORD,
          region: "us",
          useConfiguredPassword: true,
        }),
      );
      assert.equal(connected.connected, true);
      assert.deepEqual(passwordsSent(share), [TYPED_PASSWORD, TYPED_PASSWORD]);
      const row = await db.get(
        "SELECT credentials FROM dexcom_connections WHERE owner = $1",
        OWNER,
      );
      assert.equal((await unseal(row.credentials, OWNER)).region, "us");
    } finally {
      await teardown(db, share);
    }
  },
);

pgTest("sync, its failure path and disconnect all read and write the right owner", async () => {
  const db = await setup(OWNER);
  let share = syntheticShare();
  try {
    await body(
      await post({
        action: "connect",
        useConfiguredPassword: true,
        username: USERNAME,
        region: "ous",
      }),
    );
    const connectedAt = (await db.get("SELECT latest_reading_at AS at FROM dexcom_connections")).at;

    // A newer reading moves latest_reading_at forward through the CASE expression.
    share.restore();
    share = syntheticShare({ values: [shareValue(1, 131)] });
    const synced = await body(await post({ action: "sync", force: true }));
    assert.equal(synced.connected, true);
    assert.equal(synced.count, 1);
    assert.equal(synced.lastError, null);
    assert.equal(synced.latestShareAt > connectedAt, true);
    const afterSync = await db.get("SELECT * FROM dexcom_connections WHERE owner = $1", OWNER);
    assert.equal(afterSync.latest_reading_at, synced.latestShareAt);
    assert.equal(afterSync.last_error, null);
    assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM cgm_readings")).n, 3);

    // An older batch leaves the newest reading where it is.
    share.restore();
    share = syntheticShare({ values: [shareValue(120, 99)] });
    const stale = await body(await post({ action: "sync", force: true }));
    assert.equal(
      (await db.get("SELECT latest_reading_at AS at FROM dexcom_connections")).at,
      afterSync.latest_reading_at,
    );
    assert.equal(typeof stale.lastError, "string", "a stale newest reading is reported");

    // The credentials the failing sync must preserve, read as the route reads them. Comparing
    // ciphertext would only assert the AES-GCM nonce, which every reseal legitimately changes.
    const { username, password, region } = await unseal(
      (await db.get("SELECT credentials FROM dexcom_connections WHERE owner = $1", OWNER))
        .credentials,
      OWNER,
    );

    // A refused upstream records the failure against this owner and keeps the connection.
    share.restore();
    share = syntheticShare({ readFailure: "AccountPasswordInvalid" });
    const failed = await post({ action: "sync", force: true });
    assert.equal(failed.status, 503);
    const error = await body(failed);
    assert.equal(error.error, "Dexcom rejected the publisher account credentials.");
    const afterFailure = await db.get("SELECT * FROM dexcom_connections WHERE owner = $1", OWNER);
    assert.equal(afterFailure.last_error, error.error);
    const kept = await unseal(afterFailure.credentials, OWNER);
    assert.deepEqual(
      { username: kept.username, password: kept.password, region: kept.region },
      { username, password, region },
      "the connection is kept, still unsealable and still usable for the next sync",
    );

    const status = await body(await get());
    assert.equal(status.connected, true);
    assert.equal(status.lastError, error.error);

    assert.equal((await body(await remove())).connected, false);
    assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM dexcom_connections")).n, 0);
    // Disconnecting drops the connection, not the readings already recorded.
    assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM cgm_readings")).n, 4);
    assert.equal((await body(await get())).connected, false);
  } finally {
    await teardown(db, share);
  }
});

pgTest("one owner's connection and readings stay invisible to another owner", async () => {
  const db = await setup(OWNER);
  const share = syntheticShare();
  try {
    await body(
      await post({
        action: "connect",
        useConfiguredPassword: true,
        username: USERNAME,
        region: "ous",
      }),
    );
    globalThis.dexcomTestOwner = OTHER_OWNER;
    const status = await body(await get());
    assert.equal(status.connected, false);
    assert.equal(status.latestShareAt, null, "another owner's Share readings are not reported");
    assert.equal(status.defaults, null);
    // Disconnecting as the other owner must not remove the configured owner's connection.
    await body(await remove());
    assert.equal(
      (await db.get("SELECT COUNT(*)::int AS n FROM dexcom_connections WHERE owner = $1", OWNER)).n,
      1,
    );
  } finally {
    await teardown(db, share);
  }
});

pgTest("the local fallback needs both launcher variables, whatever the build mode", async () => {
  const launcherEnv = {
    DEXCOM_SECRET_KEY: SECRET_KEY,
    DEXCOM_USERNAME: USERNAME,
    DEXCOM_PASSWORD: CONFIGURED_PASSWORD,
    CARBY_AUTH_MODE: "local",
    CARBY_LOCAL_LAUNCHER: "1",
  };
  const db = await setup(LOCAL_OWNER, launcherEnv);
  const share = syntheticShare({ base: US_BASE });
  try {
    // `make start` serves a built preview as production; the launcher variables still decide.
    const status = await body(await get());
    assert.deepEqual(status.defaults, { username: USERNAME, region: "us", hasPassword: true });
    const connected = await body(
      await post({
        action: "connect",
        username: USERNAME,
        region: "us",
        useConfiguredPassword: true,
      }),
    );
    assert.equal(connected.connected, true);
    assert.deepEqual(passwordsSent(share), [CONFIGURED_PASSWORD, CONFIGURED_PASSWORD]);

    // Without the launcher marker the same owner and build are simply not a local session.
    setEnv({ ...launcherEnv, CARBY_LOCAL_LAUNCHER: undefined });
    assert.equal((await body(await get())).defaults, null);
    const refused = await post({
      action: "connect",
      username: USERNAME,
      region: "us",
      useConfiguredPassword: true,
    });
    assert.equal(refused.status, 400);
    assert.deepEqual(passwordsSent(share), [CONFIGURED_PASSWORD, CONFIGURED_PASSWORD]);
  } finally {
    await teardown(db, share);
  }
});
