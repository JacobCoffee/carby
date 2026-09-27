import { test } from "bun:test";
import assert from "node:assert/strict";
import { HINT_KEYS, hintLabels, matchHint, opensHints, savesDialog } from "../lib/hints.ts";

test("a few controls get one letter each, home row first", () => {
  assert.deepEqual(hintLabels(4), ["a", "s", "d", "f"]);
  assert.deepEqual(hintLabels(0), []);
});

test("past one per letter, every label is two letters and none starts another", () => {
  const labels = hintLabels(HINT_KEYS.length + 5);
  assert.equal(labels.length, HINT_KEYS.length + 5);
  assert.equal(new Set(labels).size, labels.length);
  assert.ok(labels.every((label) => label.length === 2));
  for (const a of labels)
    for (const b of labels) if (a !== b) assert.ok(!b.startsWith(a), `${a} starts ${b}`);
});

test("typing narrows the labels, and the last letter picks one", () => {
  const labels = hintLabels(30);
  assert.deepEqual(matchHint(labels, ""), { match: null, reachable: labels.map((_, i) => i) });
  const partial = matchHint(labels, "a");
  assert.equal(partial.match, null);
  assert.ok(partial.reachable.length > 1);
  assert.ok(partial.reachable.every((i) => labels[i].startsWith("a")));
  assert.equal(matchHint(labels, "AS").match, labels.indexOf("as"));
  // A letter no label starts with is a miss.
  assert.deepEqual(matchHint(hintLabels(3), "z"), { match: null, reachable: [] });
});

const press = (key, extra = {}) => ({
  key,
  code: `Key${key.toUpperCase()}`,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  repeat: false,
  ...extra,
});

test("F opens hints in a dialog, ⌥F anywhere, and never while typing a plain f", () => {
  const dialog = { inTextField: false, inDialog: true };
  const typing = { inTextField: true, inDialog: true };
  const page = { inTextField: false, inDialog: false };
  assert.equal(opensHints(press("f"), dialog), true);
  assert.equal(opensHints(press("f"), typing), false);
  // The bare page leaves F to the shortcut list (L then F logs food).
  assert.equal(opensHints(press("f"), page), false);
  // ⌥F types ƒ on a Mac, so it is read from the physical key.
  assert.equal(opensHints(press("ƒ", { altKey: true, code: "KeyF" }), typing), true);
  assert.equal(opensHints(press("f", { altKey: true, code: "KeyF" }), page), true);
  assert.equal(opensHints(press("f", { metaKey: true }), dialog), false);
  assert.equal(opensHints(press("f", { repeat: true }), dialog), false);
});

test("⌘Enter and Ctrl+Enter save a dialog; a plain Enter doesn't", () => {
  assert.equal(savesDialog(press("Enter", { metaKey: true })), true);
  assert.equal(savesDialog(press("Enter", { ctrlKey: true })), true);
  assert.equal(savesDialog(press("Enter")), false);
  assert.equal(savesDialog(press("Enter", { metaKey: true, altKey: true })), false);
});
