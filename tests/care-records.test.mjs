import { test } from "bun:test";
import assert from "node:assert/strict";
import { loggedRecordKinds } from "../lib/care-records.ts";

test("a profile and its change history alone are not records waiting on a care plan", () => {
  assert.deepEqual(loggedRecordKinds(["profiles", "care_audit"]), []);
  assert.deepEqual(loggedRecordKinds(["profiles", "entries", "care_audit", "saved_foods"]), [
    "entries",
    "saved_foods",
  ]);
});
