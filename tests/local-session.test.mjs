import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  createLocalSessionToken,
  handleLocalSignIn,
  handleLocalSignOut,
  localSessionConfig,
  localSessionUser,
  safeReturnPath,
} from "../lib/local-session.ts";

const secret = "synthetic-test-secret-".padEnd(48, "x");
const localEnv = {
  CARBY_AUTH_MODE: "local",
  CARBY_LOCAL_LAUNCHER: "1",
  CARBY_LOCAL_SESSION_SECRET: secret,
};
const config = localSessionConfig(localEnv);
const now = Date.UTC(2026, 8, 25, 12);
const hour = 60 * 60 * 1000;
const origin = "http://localhost:5173";
const localUser = { userId: "local_dev", displayName: "Local Developer" };

function request(path, headers = {}, init = {}) {
  return new Request(`${origin}${path}`, {
    ...init,
    headers: { host: "localhost:5173", "sec-fetch-site": "none", ...headers },
  });
}

function sessionHeaders(cookie, headers = {}) {
  return new Headers({ host: "localhost:5173", cookie, ...headers });
}

async function sessionCookie(at = now) {
  const response = await handleLocalSignIn(request("/signin"), config, at);
  return response.headers.get("set-cookie").split(";")[0];
}

test("local sign-in sets a signed HttpOnly cookie for the existing local owner", async () => {
  const signIn = request("/signin?return_to=%2F%3Fview%3Dlog");
  const response = await handleLocalSignIn(signIn, config, now);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/?view=log");
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; SameSite=Lax/);
  const user = await localSessionUser(sessionHeaders(cookie.split(";")[0]), config, now);
  assert.deepEqual(user, localUser);
});

test("identity headers never sign anyone in", async () => {
  const headers = sessionHeaders("", {
    "x-authenticated-user-id": "local_dev",
    "x-authenticated-user-email": "dev@example.test",
    "remote-user": "local_dev",
    "x-forwarded-user": "local_dev",
  });
  assert.equal(await localSessionUser(headers, config, now), null);
});

test("forged, tampered, malformed, and duplicated session cookies are rejected", async () => {
  const valid = await sessionCookie();
  const [name, token] = valid.split("=");
  const [version, expires, signature] = token.split(".");
  const otherSecret = "another-synthetic-secret-".padEnd(48, "y");
  const otherToken = await createLocalSessionToken(otherSecret, now);
  const cookies = [
    `${name}=${otherToken}`,
    `${name}=${version}.${Number(expires) - 60}.${signature}`,
    `${name}=${version}.${expires}.${"A".repeat(43)}`,
    `${name}=v1.garbage`,
    `${name}=`,
    `${valid}; ${valid}`,
  ];
  for (const cookie of cookies) {
    assert.equal(await localSessionUser(sessionHeaders(cookie), config, now), null, cookie);
  }
});

test("expired sessions and sessions that outlive one sign-in are rejected", async () => {
  const cookie = await sessionCookie();
  const headers = sessionHeaders(cookie);
  assert.deepEqual(await localSessionUser(headers, config, now + 11 * hour), localUser);
  assert.equal(await localSessionUser(headers, config, now + 12 * hour), null);
  const future = await sessionCookie(now + hour);
  assert.equal(await localSessionUser(sessionHeaders(future), config, now), null);
});

test("local sign-in stays off unless local mode has a strong secret", async () => {
  for (const env of [
    {},
    { CARBY_AUTH_MODE: "local" },
    { CARBY_AUTH_MODE: "local", CARBY_LOCAL_SESSION_SECRET: "short" },
    { CARBY_AUTH_MODE: "production", CARBY_LOCAL_SESSION_SECRET: secret },
    { ...localEnv, CARBY_AUTH_MODE: "production" },
    { ...localEnv, CARBY_LOCAL_SESSION_SECRET: "short" },
  ]) {
    assert.equal(localSessionConfig(env), null);
  }
  const cookie = await sessionCookie();
  assert.equal(await localSessionUser(sessionHeaders(cookie), null, now), null);
  for (const response of [
    await handleLocalSignIn(request("/signin"), null, now),
    handleLocalSignOut(request("/signout"), null),
  ]) {
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("set-cookie"), null);
  }
});

test("local sign-in stays off unless the local launcher marked the process", async () => {
  assert.deepEqual(localSessionConfig(localEnv), { secret });
  for (const CARBY_LOCAL_LAUNCHER of [undefined, "", "0", "true", "yes", " 1", "1 "]) {
    const env = { ...localEnv, CARBY_LOCAL_LAUNCHER };
    assert.equal(localSessionConfig(env), null, JSON.stringify(CARBY_LOCAL_LAUNCHER));
  }
  const unmarked = localSessionConfig({
    CARBY_AUTH_MODE: "local",
    CARBY_LOCAL_SESSION_SECRET: secret,
  });
  const cookie = await sessionCookie();
  assert.equal(await localSessionUser(sessionHeaders(cookie), unmarked, now), null);
  const response = await handleLocalSignIn(request("/signin"), unmarked, now);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("only direct loopback requests can sign in or use a session", async () => {
  const refused = [
    new Request("http://192.168.1.20:5173/signin", { headers: { host: "192.168.1.20:5173" } }),
    new Request("http://carby.example/signin", { headers: { host: "carby.example" } }),
    new Request("http://carby.example/signin", { headers: { host: "localhost:5173" } }),
    request("/signin", { "cf-connecting-ip": "203.0.113.9" }),
    request("/signin", { "x-forwarded-for": "203.0.113.9" }),
    request("/signin", { forwarded: "for=203.0.113.9" }),
    request("/signin", { "x-forwarded-host": "carby.example" }),
  ];
  for (const signIn of refused) {
    const response = await handleLocalSignIn(signIn, config, now);
    assert.equal(response.status, 403, signIn.url);
    assert.equal(response.headers.get("set-cookie"), null);
  }

  const cookie = await sessionCookie();
  for (const headers of [
    new Headers({ host: "carby.example", cookie }),
    new Headers({ host: "192.168.1.20:5173", cookie }),
    sessionHeaders(cookie, { "cf-connecting-ip": "203.0.113.9" }),
    sessionHeaders(cookie, { "x-forwarded-for": "203.0.113.9" }),
  ]) {
    assert.equal(await localSessionUser(headers, config, now), null);
  }
  for (const headers of [
    sessionHeaders(cookie, { "cf-connecting-ip": "127.0.0.1" }),
    sessionHeaders(cookie, { "x-forwarded-host": "localhost:5173" }),
  ]) {
    assert.deepEqual(await localSessionUser(headers, config, now), localUser);
  }
});

test("cross-site and prefetch sign-in requests never set a cookie", async () => {
  for (const headers of [
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" },
    { origin: "http://evil.example" },
    { origin: "null" },
  ]) {
    const response = await handleLocalSignIn(request("/signin", headers), config, now);
    assert.equal(response.status, 403, JSON.stringify(headers));
    assert.equal(response.headers.get("set-cookie"), null);
  }
  for (const headers of [
    { "sec-purpose": "prefetch" },
    { purpose: "prefetch" },
    { "next-router-prefetch": "1" },
  ]) {
    const response = await handleLocalSignIn(request("/signin", headers), config, now);
    assert.equal(response.status, 204, JSON.stringify(headers));
    assert.equal(response.headers.get("set-cookie"), null);
  }
});

test("sign-in redirects only to paths on this origin", async () => {
  for (const unsafe of [
    null,
    "",
    "evil.example",
    "https://evil.example/",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "/.//evil.example",
    "/signin?return_to=%2F",
    "/signout",
  ]) {
    assert.equal(safeReturnPath(unsafe), "/", JSON.stringify(unsafe));
  }
  assert.equal(safeReturnPath("/?view=log#today"), "/?view=log#today");
  const signIn = request("/signin?return_to=%2F%2Fevil.example");
  const response = await handleLocalSignIn(signIn, config, now);
  assert.equal(response.headers.get("location"), "/");
});

test("sign-out clears the session and refuses cross-site requests", async () => {
  const path = "/signout?return_to=%2F%2Fevil.example";
  const post = (headers) => request(path, headers, { method: "POST" });
  const signedOut = handleLocalSignOut(post({ origin, "sec-fetch-site": "same-origin" }), config);
  assert.equal(signedOut.status, 200);
  assert.equal(signedOut.headers.get("location"), null);
  assert.match(signedOut.headers.get("set-cookie"), /^carby_local_session=; Max-Age=0;/);
  assert.match(await signedOut.text(), /href="\/signin\?return_to=%2F"/);

  const refused = handleLocalSignOut(post({ origin: "http://evil.example" }), config);
  assert.equal(refused.status, 403);
  assert.equal(refused.headers.get("set-cookie"), null);
});
