import { test } from "bun:test";
import assert from "node:assert/strict";
import { createRefreshGate } from "../lib/live-refresh.ts";
import { conditionalJson } from "../lib/conditional-json.ts";
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

test("concurrent refresh triggers share one request", async () => {
  const gate = createRefreshGate(),
    pending = deferred();
  let reads = 0;
  const applied = [];
  const read = () => {
    reads++;
    return pending.promise;
  };
  const first = gate.run(read, (value) => applied.push(value), assert.fail);
  const second = gate.run(read, (value) => applied.push(value), assert.fail);
  assert.equal(reads, 1);
  pending.resolve("current");
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.deepEqual(applied, ["current"]);
});

test("a response from before a save cannot resurrect deleted or superseded rows", async () => {
  const gate = createRefreshGate(),
    old = deferred(),
    current = deferred(),
    applied = [];
  let oldSignal;
  const first = gate.run(
    (signal) => {
      oldSignal = signal;
      return old.promise;
    },
    (value) => applied.push(value),
    assert.fail,
  );
  gate.invalidate();
  assert.equal(oldSignal.aborted, true);
  const second = gate.run(
    () => current.promise,
    (value) => applied.push(value),
    assert.fail,
  );
  current.resolve(["saved"]);
  assert.equal(await second, true);
  old.resolve(["deleted", "old"]);
  assert.equal(await first, false);
  assert.deepEqual(applied, [["saved"]]);
});

test("an obsolete error cannot overwrite a successful refresh", async () => {
  const gate = createRefreshGate(),
    old = deferred(),
    errors = [];
  const first = gate.run(
    () => old.promise,
    assert.fail,
    (error) => errors.push(error),
  );
  gate.invalidate();
  await gate.run(
    async () => 42,
    () => {},
    assert.fail,
  );
  old.reject(new Error("old network failure"));
  assert.equal(await first, false);
  assert.deepEqual(errors, []);
});

test("a failed refresh can retry without losing the last applied snapshot", async () => {
  const gate = createRefreshGate();
  let snapshot = "stored";
  const errors = [];
  assert.equal(
    await gate.run(
      async () => {
        throw new Error("offline");
      },
      (value) => (snapshot = value),
      (error) => errors.push(error),
    ),
    false,
  );
  assert.equal(snapshot, "stored");
  assert.equal(errors.length, 1);
  assert.equal(
    await gate.run(
      async () => "new",
      (value) => (snapshot = value),
      assert.fail,
    ),
    true,
  );
  assert.equal(snapshot, "new");
});

test("unchanged private snapshots return 304; an edit returns the full new data", async () => {
  const first = await conditionalJson(new Request("https://example.test/api/care"), {
    entries: [{ id: "a", units: 0.5 }],
  });
  const etag = first.headers.get("ETag");
  assert.ok(etag);
  assert.equal(first.headers.get("Cache-Control"), "private, no-store");
  const request = new Request("https://example.test/api/care", {
    headers: { "If-None-Match": etag },
  });
  const unchanged = await conditionalJson(request, { entries: [{ id: "a", units: 0.5 }] });
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), "");
  const changed = await conditionalJson(request, { entries: [] });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.get("ETag"), etag);
  assert.deepEqual(await changed.json(), { entries: [] });
});
