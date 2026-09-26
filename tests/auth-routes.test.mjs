import { test } from "bun:test";
import assert from "node:assert/strict";
import { encode } from "@auth/core/jwt";

const origin = "https://carby.example.test";
const secret = "synthetic-auth-secret-".padEnd(48, "x");
const sessionName = "__Secure-authjs.session-token";
const oauthEnv = {
  APP_URL: origin,
  AUTH_SECRET: secret,
  AUTH_GITHUB_ID: "synthetic-github-id",
  AUTH_GITHUB_SECRET: "synthetic-github-secret",
  AUTH_DISCORD_ID: "synthetic-discord-id",
  AUTH_DISCORD_SECRET: "synthetic-discord-secret",
  CARBY_ALLOWED_USERS: "github:9019718",
};
const authKeys = [
  ...Object.keys(oauthEnv),
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "CARBY_ALLOWED_EMAILS",
  "CARBY_AUTH_MODE",
  "CARBY_LOCAL_SESSION_SECRET",
  "CARBY_LOCAL_LAUNCHER",
];

function setAuthEnv(values) {
  for (const key of authKeys) delete process.env[key];
  Object.assign(process.env, values);
}

setAuthEnv(oauthEnv);
const signin = await import("../app/signin/route.ts");
const signout = await import("../app/signout/route.ts");
const auth = await import("../app/api/auth/[...auth]/route.ts");

// The app sits behind a proxy, so requests arrive on an internal address.
function request(path, headers = {}, init = {}) {
  return new Request(`http://10.0.0.5:3000${path}`, {
    ...init,
    headers: { host: "10.0.0.5:3000", ...headers },
  });
}

async function sessionCookie(ownerId = "github:9019718") {
  const token = { ownerId, displayName: "Octo Owner", email: null, emailVerified: false };
  return `${sessionName}=${await encode({ token, secret, salt: sessionName })}`;
}

function clearedSession(response) {
  return response.headers.getSetCookie().find((value) => value.startsWith(`${sessionName}=;`));
}

function cookiePairs(response) {
  return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]);
}

function hidden(html, name) {
  return new RegExp(`name="${name}" value="([^"]*)"`).exec(html)?.[1].replace(/&amp;/g, "&");
}

test("the sign-in page offers only configured providers with a working CSRF pair", async () => {
  setAuthEnv(oauthEnv);
  const page = await signin.GET(request("/signin?return_to=%2F%3Fview%3Dlog"));
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("cache-control"), "no-store");
  const html = await page.text();
  assert.match(html, /action="\/api\/auth\/signin\/github"/);
  assert.match(html, /Continue with GitHub/);
  assert.match(html, /Continue with Discord/);
  assert.doesNotMatch(html, /Google/);
  assert.equal(hidden(html, "callbackUrl"), `${origin}/?view=log`);
  const cookie = cookiePairs(page).join("; ");
  assert.match(cookie, /__Host-authjs\.csrf-token=/);

  const post = (csrfToken) =>
    auth.POST(
      request(
        "/api/auth/signin/github",
        { cookie, "content-type": "application/x-www-form-urlencoded" },
        {
          method: "POST",
          body: new URLSearchParams({
            csrfToken,
            callbackUrl: hidden(html, "callbackUrl"),
          }).toString(),
        },
      ),
    );
  const started = await post(hidden(html, "csrfToken"));
  assert.equal(started.status, 302);
  const authorize = new URL(started.headers.get("location"));
  assert.equal(authorize.origin + authorize.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(authorize.searchParams.get("client_id"), "synthetic-github-id");
  assert.equal(authorize.searchParams.get("redirect_uri"), `${origin}/api/auth/callback/github`);
  assert.equal(authorize.searchParams.get("scope"), "read:user user:email");

  const forged = await post("forged-token");
  assert.equal(forged.status, 302);
  assert.equal(forged.headers.get("location"), `${origin}/signin?error=MissingCSRF`);
});

test("a sign-in error shows a short notice instead of failing", async () => {
  setAuthEnv(oauthEnv);
  const page = await signin.GET(request("/signin?error=AccessDenied"));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Sign-in was not completed\./);
});

test("a signed-in visitor goes straight to the safe return path", async () => {
  setAuthEnv(oauthEnv);
  const cookie = await sessionCookie();
  for (const [returnTo, expected] of [
    ["%2F%3Fview%3Dlog", `${origin}/?view=log`],
    ["%2F%2Fevil.example.com", `${origin}/`],
    ["%2Fapi%2Fauth%2Fsignout", `${origin}/`],
  ]) {
    const response = await signin.GET(request(`/signin?return_to=${returnTo}`, { cookie }));
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), expected);
  }
});

test("with no OAuth configured, sign-in and the auth routes are not found", async () => {
  for (const env of [{}, { ...oauthEnv, AUTH_SECRET: "" }, { ...oauthEnv, APP_URL: " " }]) {
    setAuthEnv(env);
    for (const response of [
      await signin.GET(request("/signin")),
      await auth.GET(request("/api/auth/csrf")),
      await auth.POST(request("/api/auth/signin/github", {}, { method: "POST", body: "" })),
    ]) {
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("set-cookie"), null);
    }
  }
});

test("local sign-in still wins on loopback when the launcher enabled it", async () => {
  setAuthEnv({
    ...oauthEnv,
    CARBY_AUTH_MODE: "local",
    CARBY_LOCAL_LAUNCHER: "1",
    CARBY_LOCAL_SESSION_SECRET: "synthetic-test-secret-".padEnd(48, "x"),
  });
  const local = new Request("http://localhost:5173/signin", {
    headers: { host: "localhost:5173", "sec-fetch-site": "none" },
  });
  const response = await signin.GET(local);
  assert.equal(response.status, 302);
  assert.match(response.headers.get("set-cookie"), /^carby_local_session=v1\./);
  const remote = await signin.GET(request("/signin"));
  assert.equal(remote.status, 200);
  assert.equal(remote.headers.get("set-cookie").includes("carby_local_session"), false);
});

test("OAuth sign-out clears the session server-side and never leaks the CSRF cookie", async () => {
  setAuthEnv(oauthEnv);
  const cookie = await sessionCookie();
  for (const method of ["POST", "GET"]) {
    const headers = { cookie, origin, "sec-fetch-site": "same-origin" };
    const response = await signout[method](request("/signout", headers, { method }));
    assert.equal(response.status, 302, method);
    assert.equal(response.headers.get("location"), `${origin}/signin`);
    assert.match(clearedSession(response), /Max-Age=0/i);
    assert.equal(
      cookiePairs(response).some((pair) => pair.includes("csrf-token")),
      false,
    );
  }
});

test("OAuth sign-out refuses cross-site and prefetch requests", async () => {
  setAuthEnv(oauthEnv);
  const cookie = await sessionCookie();
  for (const headers of [
    { origin: "https://evil.example.com" },
    { origin: "http://10.0.0.5:3000" },
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" },
  ]) {
    const response = await signout.POST(
      request("/signout", { cookie, ...headers }, { method: "POST" }),
    );
    assert.equal(response.status, 403, JSON.stringify(headers));
    assert.equal(response.headers.get("set-cookie"), null);
  }
  const prefetch = await signout.GET(request("/signout", { cookie, "sec-purpose": "prefetch" }));
  assert.equal(prefetch.status, 204);
  assert.equal(prefetch.headers.get("set-cookie"), null);
});

test("signing out with no session just returns to sign-in", async () => {
  setAuthEnv(oauthEnv);
  const response = await signout.POST(
    request("/signout", { origin, "sec-fetch-site": "same-origin" }, { method: "POST" }),
  );
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/signin");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
});

test("sign-out also clears a revoked or unreadable session cookie", async () => {
  setAuthEnv(oauthEnv);
  for (const cookie of [
    await sessionCookie("github:revoked"),
    `${sessionName}=garbage`,
    `${sessionName}.0=chunk`,
  ]) {
    const headers = { cookie, origin, "sec-fetch-site": "same-origin" };
    const response = await signout.POST(request("/signout", headers, { method: "POST" }));
    assert.equal(response.status, 302, cookie.slice(0, 40));
    assert.equal(response.headers.get("location"), `${origin}/signin`);
    assert.ok(
      response.headers
        .getSetCookie()
        .some((value) => /authjs\.session-token(\.0)?=;.*Max-Age=0/i.test(value)),
    );
  }
});

test("the Auth.js session endpoint renews allowed sessions and clears revoked ones", async () => {
  setAuthEnv(oauthEnv);
  const allowed = await auth.GET(request("/api/auth/session", { cookie: await sessionCookie() }));
  assert.equal(allowed.status, 200);
  const renewed = allowed.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${sessionName}=`));
  assert.doesNotMatch(renewed, /Max-Age=0/i);

  setAuthEnv({ ...oauthEnv, CARBY_ALLOWED_USERS: "github:1" });
  const revoked = await auth.GET(request("/api/auth/session", { cookie: await sessionCookie() }));
  assert.equal(revoked.status, 200);
  assert.equal(await revoked.json(), null);
  assert.match(clearedSession(revoked), /Max-Age=0/i);
});
