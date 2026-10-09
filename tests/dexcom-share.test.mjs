import { afterEach, test } from "bun:test";
import assert from "node:assert/strict";
import { fetchShare, retryAfterMs, ShareRateLimited } from "../lib/dexcom-share.ts";

const credentials = {
  username: "publisher@example.com",
  password: "share-password",
  region: "us",
  sessionId: "11111111-2222-3333-4444-555555555555",
};
const originalFetch = globalThis.fetch;
const originalError = console.error;
afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalError;
});
/** Share's gateway answering with an HTML page instead of JSON. */
function htmlReply(status, headers = {}) {
  const logged = [];
  console.error = (...args) => logged.push(JSON.stringify(args));
  globalThis.fetch = async () =>
    new Response(`<html><title>Error</title>${credentials.sessionId}</html>`, {
      status,
      headers: { "Content-Type": "text/html", ...headers },
    });
  return logged;
}

test("an HTML outage page reads as Share being unavailable", async () => {
  htmlReply(503);
  await assert.rejects(fetchShare(credentials), {
    message: "Dexcom Share is unavailable. Try again later.",
  });
});

test("a 429 is a rate limit carrying Dexcom's Retry-After, whatever its body", async () => {
  htmlReply(429, { "Retry-After": "90" });
  const error = await fetchShare(credentials).catch((e) => e);
  assert.ok(error instanceof ShareRateLimited);
  assert.equal(error.message, "Dexcom is limiting requests, so Share sync is paused.");
  assert.equal(error.retryAfterMs, 90_000);
});

test("Retry-After is read in seconds or as an HTTP date, and anything else is ignored", () => {
  const now = Date.parse("2026-10-09T16:00:00Z");
  assert.equal(retryAfterMs("120", now), 120_000);
  assert.equal(retryAfterMs("Fri, 09 Oct 2026 16:05:00 GMT", now), 300_000);
  assert.equal(retryAfterMs("Fri, 09 Oct 2026 15:55:00 GMT", now), 0);
  assert.equal(retryAfterMs("soon", now), null);
  assert.equal(retryAfterMs(null, now), null);
});

test("a successful status with a non-JSON body is still unreadable, and the log omits the body", async () => {
  const logged = htmlReply(200);
  await assert.rejects(fetchShare(credentials), {
    message: "Dexcom Share returned an unreadable response.",
  });
  assert.equal(logged.length, 1);
  assert.equal(logged[0].includes(credentials.sessionId), false);
});
