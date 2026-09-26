import { test } from "bun:test";
import assert from "node:assert/strict";
import { canonicalOrigin, safeAuthRedirectPath, withCanonicalOrigin } from "../lib/auth-origin.ts";

test("APP_URL must be an absolute http(s) URL, and only its origin is kept", () => {
  for (const APP_URL of [
    undefined,
    "",
    "   ",
    "carby.example.test",
    "/relative",
    "ftp://carby.example.test",
    "javascript:alert(1)",
    "https://user:pass@carby.example.test",
    "https://",
  ]) {
    assert.equal(canonicalOrigin({ APP_URL }), null, JSON.stringify(APP_URL));
  }
  for (const [APP_URL, expected] of [
    ["https://carby.example.test", "https://carby.example.test/"],
    [" https://carby.example.test/ ", "https://carby.example.test/"],
    ["https://carby.example.test/app/?x=1#y", "https://carby.example.test/"],
    ["http://localhost:8080", "http://localhost:8080/"],
  ]) {
    const origin = canonicalOrigin({ APP_URL });
    assert.equal(origin.href, expected);
    assert.equal(origin.pathname, "/");
  }
});

test("requests are rewritten onto the canonical origin with path, query, and headers intact", async () => {
  const origin = canonicalOrigin({ APP_URL: "https://carby.example.test" });
  const get = new Request("http://10.0.0.5:3000/api/auth/callback/github?code=abc&state=xyz", {
    headers: { host: "evil.example", cookie: "a=b", "x-forwarded-host": "evil.example" },
  });
  const rewrittenGet = withCanonicalOrigin(get, origin);
  assert.equal(
    rewrittenGet.url,
    "https://carby.example.test/api/auth/callback/github?code=abc&state=xyz",
  );
  assert.equal(rewrittenGet.method, "GET");
  assert.equal(rewrittenGet.headers.get("cookie"), "a=b");
  assert.equal(rewrittenGet.body, null);

  const post = new Request("http://10.0.0.5:3000/api/auth/signin/github", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "csrfToken=t&callbackUrl=%2F",
  });
  const rewrittenPost = withCanonicalOrigin(post, origin);
  assert.equal(rewrittenPost.url, "https://carby.example.test/api/auth/signin/github");
  assert.equal(rewrittenPost.method, "POST");
  assert.equal(rewrittenPost.headers.get("content-type"), "application/x-www-form-urlencoded");
  assert.equal(await rewrittenPost.text(), "csrfToken=t&callbackUrl=%2F");
});

test("auth redirects stay on this origin and never return to sign-in or OAuth routes", () => {
  for (const unsafe of [
    null,
    undefined,
    "",
    "/signin",
    "/signin?return_to=%2F",
    "/signout",
    "//evil.example.com",
    "/\\evil.example.com",
    "https://evil.example.com/",
    "https://carby.example.test/",
    "/api/auth",
    "/api/auth/signout",
    "/API/Auth/signin/github",
    "/api/auth%2Fsignout",
    "/x/../api/auth/csrf",
  ]) {
    assert.equal(safeAuthRedirectPath(unsafe), "/", JSON.stringify(unsafe));
  }
  assert.equal(safeAuthRedirectPath("/?view=log#today"), "/?view=log#today");
  assert.equal(safeAuthRedirectPath("/api/authority"), "/api/authority");
});
