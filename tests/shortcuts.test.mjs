import { test } from "bun:test";
import assert from "node:assert/strict";
import { SHORTCUTS, createShortcutMatcher } from "../lib/shortcuts.ts";

const id = (result) => (result && result !== "pending" ? result.id : result);

test("a two-key sequence runs once both keys arrive", () => {
  const keys = createShortcutMatcher();
  assert.equal(keys.press("l", 0), "pending");
  assert.equal(id(keys.press("g", 300)), "log-glucose");
  assert.deepEqual(keys.pending, []);
});

test("a single key runs at once", () => {
  const keys = createShortcutMatcher();
  assert.equal(id(keys.press("c", 0)), "calc-open");
});

test("letters match regardless of case", () => {
  const keys = createShortcutMatcher();
  keys.press("G", 0);
  assert.equal(id(keys.press("I", 10)), "view-insights");
});

test("the same second key means different things after different first keys", () => {
  const keys = createShortcutMatcher();
  keys.press("l", 0);
  assert.equal(id(keys.press("i", 10)), "log-insulin");
  keys.press("g", 20);
  assert.equal(id(keys.press("i", 30)), "view-insights");
});

test("a second key after the timeout starts over instead of finishing the sequence", () => {
  const keys = createShortcutMatcher(SHORTCUTS, 1200);
  keys.press("l", 0);
  // Alone, "g" only starts a sequence: nothing is logged.
  assert.equal(keys.press("g", 1500), "pending");
});

test("a key that fits no sequence is tried on its own", () => {
  const keys = createShortcutMatcher();
  keys.press("g", 0);
  assert.equal(id(keys.press("c", 10)), "calc-open");
  keys.press("l", 20);
  assert.equal(keys.press("x", 30), null);
  assert.deepEqual(keys.pending, []);
});

test("no shortcut is a prefix of another, so every single key runs without waiting", () => {
  for (const a of SHORTCUTS) {
    for (const b of SHORTCUTS) {
      if (a === b) continue;
      const prefix = a.keys.length < b.keys.length && a.keys.every((k, i) => k === b.keys[i]);
      assert.equal(prefix, false, `${a.keys.join(" ")} shadows ${b.keys.join(" ")}`);
    }
  }
  assert.equal(new Set(SHORTCUTS.map((s) => s.keys.join(" "))).size, SHORTCUTS.length);
});
