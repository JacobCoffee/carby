import { afterEach, test } from "bun:test";
import assert from "node:assert/strict";
import { fetchShare } from "../lib/dexcom-share.ts";

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
function htmlReply(status) {
  const logged = [];
  console.error = (...args) => logged.push(JSON.stringify(args));
  globalThis.fetch = async () =>
    new Response(`<html><title>Error</title>${credentials.sessionId}</html>`, {
      status,
      headers: { "Content-Type": "text/html" },
    });
  return logged;
}

test("an HTML outage page reads as Share being unavailable", async () => {
  htmlReply(503);
  await assert.rejects(fetchShare(credentials), {
    message: "Dexcom Share is unavailable. Try again later.",
  });
});

test("an HTML rate-limit page asks the user to wait", async () => {
  htmlReply(429);
  await assert.rejects(fetchShare(credentials), {
    message: "Dexcom is limiting requests. Wait a few minutes before syncing again.",
  });
});

test("a successful status with a non-JSON body is still unreadable, and the log omits the body", async () => {
  const logged = htmlReply(200);
  await assert.rejects(fetchShare(credentials), {
    message: "Dexcom Share returned an unreadable response.",
  });
  assert.equal(logged.length, 1);
  assert.equal(logged[0].includes(credentials.sessionId), false);
});
