import { mock, test } from "bun:test";
import assert from "node:assert/strict";
import { createTestDatabase, pgTest } from "./pg-test-helper.mjs";

const accounts = {
  mom: { userId: "github:1", displayName: "Mom" },
  dad: { userId: "github:2", displayName: "Dad" },
  grandma: { userId: "google:3", displayName: "Grandma" },
};
let signedIn = accounts.mom;
mock.module("@/app/auth", () => ({ getCurrentUser: async () => signedIn }));
mock.module("@/db/raw", () => ({ database: () => globalThis.tokenTestDb }));
const people = await import("../app/api/people/route.ts");
const care = await import("../app/api/care/route.ts");
const { tokenAccess } = await import("../app/access.ts");
const {
  allowedScopes,
  JWT_SECONDS,
  requestCredential,
  signJwt,
  tokenHash,
  tokenSecret,
  verifyJwt,
} = await import("../lib/api-tokens.ts");

const origin = "https://test.example";
const bare = (path, headers = {}) => new Request(`${origin}${path}`, { headers });

test("reads a token from every form Nightscout clients send", async () => {
  const token = "carby-0123456789abcdef0123456789abcdef";
  const sha1 = await tokenSecret(token);
  assert.deepEqual(
    requestCredential(bare("/api/v1/entries", { "api-secret": sha1.toUpperCase() })),
    {
      kind: "secret",
      sha1,
    },
  );
  assert.deepEqual(requestCredential(bare("/api/v1/entries", { "api-secret": token })), {
    kind: "token",
    token,
  });
  assert.deepEqual(
    requestCredential(bare("/api/v1/entries", { Authorization: `Bearer ${token}` })),
    {
      kind: "token",
      token,
    },
  );
  assert.deepEqual(requestCredential(bare("/api/v1/entries", { Authorization: "Bearer a.b.c" })), {
    kind: "jwt",
    jwt: "a.b.c",
  });
  // https://TOKEN@host arrives as Basic with the token as the user name.
  assert.deepEqual(
    requestCredential(bare("/api/v1/entries", { Authorization: `Basic ${btoa(`${token}:`)}` })),
    { kind: "token", token },
  );
  assert.deepEqual(requestCredential(bare(`/api/v1/entries?token=${token}`)), {
    kind: "token",
    token,
  });
  assert.equal(requestCredential(bare("/api/v1/entries")), null);
});

test("a JWT works only for its own token and only until it expires", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const stored = await tokenHash("carby-0123456789abcdef0123456789abcdef");
  const { jwt, iat, exp } = await signJwt(id, stored, "xDrip+", 1_800_000_000);
  assert.equal(exp - iat, JWT_SECONDS);
  assert.equal(await verifyJwt(jwt, stored, iat + 60), true);
  assert.equal(await verifyJwt(jwt, stored, exp + 1), false);
  assert.equal(await verifyJwt(jwt, await tokenHash("carby-other"), iat + 60), false);
  const [header, , signature] = jwt.split(".");
  const forged = btoa(JSON.stringify({ tid: id, iat, exp: exp + 86400 })).replace(/=+$/, "");
  assert.equal(await verifyJwt(`${header}.${forged}.${signature}`, stored, iat + 60), false);
});

test("viewers may give their tokens read access only", () => {
  assert.deepEqual(allowedScopes("owner"), ["read", "upload"]);
  assert.deepEqual(allowedScopes("caregiver"), ["read", "upload"]);
  assert.deepEqual(allowedScopes("viewer"), ["read"]);
});

async function setup() {
  const db = await createTestDatabase();
  globalThis.tokenTestDb = db.database;
  signedIn = accounts.mom;
  return db;
}
async function teardown(db) {
  delete globalThis.tokenTestDb;
  await db.close();
}
function request(path, { method = "GET", person, body } = {}) {
  const headers = { Origin: origin };
  if (person) headers["x-carby-person"] = person;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return new Request(`${origin}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const json = async (pending) => {
  const response = await pending;
  return { status: response.status, body: await response.json() };
};
const peoplePost = (body, person) =>
  json(people.POST(request("/api/people", { method: "POST", person, body })));
const peopleGet = (person) => json(people.GET(request("/api/people", { person })));
async function makeToken(label, scopes, person) {
  const made = await peoplePost({ action: "createToken", label, scopes }, person);
  assert.equal(made.status, 200, JSON.stringify(made.body));
  return made.body.token;
}
/** Mom's person (her account id), shared with `account` as `role`. */
async function share(account, role) {
  signedIn = accounts.mom;
  const invite = await peoplePost({ action: "invite", role });
  const token = new URL(invite.body.url).pathname.split("/").at(-1);
  signedIn = account;
  const joined = await peoplePost({ action: "accept", token });
  assert.equal(joined.status, 200);
  return joined.body.person;
}
const resolved = async (headers, path = "/api/v1/entries", scope = "upload") => {
  const access = await tokenAccess(bare(path, headers), scope);
  return access instanceof Response
    ? { status: access.status }
    : { person: access.person, actor: access.user.userId, name: access.user.displayName };
};

pgTest("a token reaches only its own person, in every form a client sends", async () => {
  const db = await setup();
  try {
    const mom = accounts.mom.userId;
    const token = await makeToken("xDrip+", ["read", "upload"]);
    assert.match(token, /^carby-[0-9a-f]{32}$/);
    const row = await db.get("SELECT id, token_hash, secret_hash FROM api_tokens");
    assert.notEqual(row.token_hash, token);
    // Dad's own person exists too, and naming it doesn't move the token.
    signedIn = accounts.dad;
    const dad = (await peopleGet()).body.person;
    assert.notEqual(dad, mom);
    const { jwt } = await signJwt(row.id, row.token_hash, "xDrip+", Date.now() / 1000);
    const forms = [
      { "api-secret": await tokenSecret(token) },
      { "api-secret": token },
      { Authorization: `Bearer ${token}` },
      { Authorization: `Bearer ${jwt}` },
      { Authorization: `Basic ${btoa(`${token}:`)}` },
      { "x-carby-person": dad, "api-secret": await tokenSecret(token) },
    ];
    for (const headers of forms)
      assert.deepEqual(await resolved(headers), {
        person: mom,
        actor: mom,
        name: "Mom via xDrip+",
      });
    assert.deepEqual(await resolved({}, `/api/v1/entries?token=${token}`), {
      person: mom,
      actor: mom,
      name: "Mom via xDrip+",
    });
    assert.equal((await resolved({ "api-secret": await tokenSecret("carby-guess") })).status, 401);
    assert.equal((await resolved({})).status, 401);
    assert.ok((await db.get("SELECT last_used FROM api_tokens")).last_used);
    // The owner sees the token by name and scope, never its hash.
    signedIn = accounts.mom;
    const listed = (await peopleGet()).body.tokens;
    assert.deepEqual(
      listed.map((t) => [t.label, t.scopes, t.yours]),
      [["xDrip+", ["read", "upload"], true]],
    );
    assert.doesNotMatch(JSON.stringify(listed), new RegExp(row.token_hash));
  } finally {
    await teardown(db);
  }
});

pgTest("a token's scope limits it, and a token alone can't open the care log", async () => {
  const db = await setup();
  try {
    const upload = await makeToken("Loop", ["upload"]);
    assert.equal(
      (await resolved({ Authorization: `Bearer ${upload}` }, "/x", "upload")).actor,
      "github:1",
    );
    assert.equal((await resolved({ Authorization: `Bearer ${upload}` }, "/x", "read")).status, 403);
    // The care plan and log need a signed-in account; tokens aren't one.
    signedIn = null;
    const careLoad = await care.GET(
      new Request(`${origin}/api/care`, { headers: { Authorization: `Bearer ${upload}` } }),
    );
    assert.equal(careLoad.status, 401);
    // Viewers can make read tokens only.
    await share(accounts.grandma, "viewer");
    const refused = await peoplePost({ action: "createToken", label: "Watch", scopes: ["upload"] });
    assert.equal(refused.status, 403);
    const read = await makeToken("Watch", ["read"]);
    assert.equal(
      (await resolved({ Authorization: `Bearer ${read}` }, "/x", "read")).actor,
      "google:3",
    );
  } finally {
    await teardown(db);
  }
});

pgTest("tokens stop when their account loses the access they need", async () => {
  const db = await setup();
  try {
    const person = await share(accounts.dad, "caregiver");
    const upload = await makeToken("xDrip+", ["read", "upload"], person);
    const read = await makeToken("Watch", ["read"], person);
    const uses = async (token, scope) =>
      (await resolved({ Authorization: `Bearer ${token}` }, "/x", scope)).status ?? 200;
    assert.equal(await uses(upload, "upload"), 200);

    // Only its maker or an owner can revoke a token.
    await share(accounts.grandma, "caregiver");
    const other = await peoplePost(
      {
        action: "revokeToken",
        id: (await db.get("SELECT id FROM api_tokens WHERE label = 'Watch'")).id,
      },
      person,
    );
    assert.equal(other.status, 404);
    signedIn = accounts.grandma;
    assert.deepEqual((await peopleGet(person)).body.tokens, []);

    // Dropping to viewer deletes upload tokens; read tokens keep working.
    signedIn = accounts.mom;
    const role = await peoplePost({
      action: "setRole",
      account: accounts.dad.userId,
      role: "viewer",
    });
    assert.equal(role.status, 200);
    assert.equal(await uses(upload, "read"), 401);
    assert.equal(await uses(read, "read"), 200);

    // Removing the member deletes the rest.
    const removed = await peoplePost({ action: "removeMember", account: accounts.dad.userId });
    assert.equal(removed.status, 200);
    assert.equal(await uses(read, "read"), 401);
    assert.equal((await db.get("SELECT COUNT(*)::int AS n FROM api_tokens")).n, 0);

    // An owner revokes anyone's token, and the change is in the history.
    signedIn = accounts.grandma;
    const hers = await makeToken("Juggluco", ["upload"], person);
    signedIn = accounts.mom;
    const id = (await db.get("SELECT id FROM api_tokens")).id;
    assert.equal((await peoplePost({ action: "revokeToken", id })).status, 200);
    assert.equal(await uses(hers, "upload"), 401);
    const history = await db.all(
      "SELECT action, actor_name FROM care_audit WHERE action LIKE 'token%' ORDER BY at",
    );
    assert.deepEqual(
      history.map((h) => [h.action, h.actor_name]),
      [
        ["token created", "Dad"],
        ["token created", "Dad"],
        ["token created", "Grandma"],
        ["token revoked", "Mom"],
      ],
    );
  } finally {
    await teardown(db);
  }
});
