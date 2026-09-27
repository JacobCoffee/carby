import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  acceptConfig,
  pushConfig,
  syncDecision,
  syncQueues,
  syncRequestHeaders,
} from "../lib/sync.ts";

const record = (revision, note = "") => JSON.stringify({ id: "r", revision, note });
const token = "t".repeat(32);

test("a tracked record applies only while the receiver still holds what the sender last had", () => {
  // Never seen here, or the same copy again: nothing to protect.
  assert.equal(syncDecision("entries", null, null, record("r1")), "apply");
  assert.equal(syncDecision("entries", record("r1"), "r0", record("r1")), "same");
  assert.equal(syncDecision("entries", null, "r1", null), "same");
  // An edit or delete of the copy the receiver got last time.
  assert.equal(syncDecision("entries", record("r1"), "r1", record("r2")), "apply");
  assert.equal(syncDecision("illness_windows", record("r1"), "r1", null), "apply");
  // The receiver edited it since (a revision the sender never had): held back.
  assert.equal(syncDecision("entries", record("p1"), "r1", record("r2")), "conflict");
  assert.equal(syncDecision("appointments", record("p1"), "r1", null), "conflict");
  assert.equal(syncDecision("entries", record("p1"), null, record("r2")), "conflict");
});

test("records without revisions are last write wins", () => {
  assert.equal(
    syncDecision("saved_foods", record(undefined, "a"), null, record(undefined, "b")),
    "apply",
  );
  assert.equal(
    syncDecision("profiles", record(undefined, "a"), null, record(undefined, "b")),
    "apply",
  );
});

test("sync needs every setting and a long token, and only sends over https off this machine", () => {
  const push = {
    CARBY_SYNC_PUSH_URL: "https://carby.example/app",
    CARBY_SYNC_PUSH_TOKEN: token,
    CARBY_SYNC_PUSH_PERSON: "local_dev",
  };
  assert.deepEqual(pushConfig(push), { url: "https://carby.example", token, person: "local_dev" });
  assert.equal(pushConfig({ ...push, CARBY_SYNC_PUSH_TOKEN: "short" }), null);
  assert.equal(pushConfig({ ...push, CARBY_SYNC_PUSH_PERSON: " " }), null);
  assert.equal(pushConfig({ ...push, CARBY_SYNC_PUSH_URL: "http://carby.example" }), null);
  assert.equal(
    pushConfig({ ...push, CARBY_SYNC_PUSH_URL: "http://localhost:8787" })?.url,
    "http://localhost:8787",
  );
  assert.equal(pushConfig({}), null);
  assert.deepEqual(
    acceptConfig({ CARBY_SYNC_ACCEPT_TOKEN: token, CARBY_SYNC_ACCEPT_PERSON: "github:1" }),
    { token, person: "github:1", sendBack: false },
  );
  assert.equal(
    acceptConfig({ CARBY_SYNC_ACCEPT_TOKEN: "short", CARBY_SYNC_ACCEPT_PERSON: "github:1" }),
    null,
  );
});

test("a Sites access token is sent in its own header, beside the sync token", () => {
  const push = {
    CARBY_SYNC_PUSH_URL: "https://carby.example",
    CARBY_SYNC_PUSH_TOKEN: token,
    CARBY_SYNC_PUSH_PERSON: "local_dev",
  };
  const plain = syncRequestHeaders(pushConfig(push));
  assert.equal(plain.Authorization, `Bearer ${token}`);
  assert.equal("OAI-Sites-Authorization" in plain, false);
  const gated = syncRequestHeaders(pushConfig({ ...push, CARBY_SYNC_PUSH_SITES_TOKEN: " site " }));
  assert.equal(gated.Authorization, `Bearer ${token}`);
  assert.equal(gated["OAI-Sites-Authorization"], "Bearer site");
  // Blank means no gate.
  const blank = syncRequestHeaders(pushConfig({ ...push, CARBY_SYNC_PUSH_SITES_TOKEN: " " }));
  assert.equal("OAI-Sites-Authorization" in blank, false);
});

test("changes are queued only for the person sent, or the one sent back when that's on", () => {
  const push = pushConfig({
    CARBY_SYNC_PUSH_URL: "https://carby.example",
    CARBY_SYNC_PUSH_TOKEN: token,
    CARBY_SYNC_PUSH_PERSON: "local_dev",
  });
  const accept = { CARBY_SYNC_ACCEPT_TOKEN: token, CARBY_SYNC_ACCEPT_PERSON: "github:1" };
  assert.equal(syncQueues("local_dev", push, null), true);
  assert.equal(syncQueues("someone", push, null), false);
  // A receiver keeps no queue unless it sends back, and then only for its own person.
  assert.equal(syncQueues("github:1", null, acceptConfig(accept)), false);
  const sendBack = acceptConfig({ ...accept, CARBY_SYNC_ACCEPT_SEND_BACK: "1" });
  assert.equal(syncQueues("github:1", null, sendBack), true);
  assert.equal(syncQueues("github:2", null, sendBack), false);
  assert.equal(syncQueues("github:1", null, null), false);
});
