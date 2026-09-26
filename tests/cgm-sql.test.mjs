import { test } from "bun:test";
import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { saveCgmSql, cleanupLegacyClaritySql, legacyRoundedAt } from "../lib/cgm-sql.ts";

test("CSV value replaces Share status, while a later Share status cannot erase it", () => {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE cgm_readings(id TEXT PRIMARY KEY, owner TEXT NOT NULL, at TEXT NOT NULL, value TEXT NOT NULL, source TEXT NOT NULL)",
  );
  const save = db.prepare(saveCgmSql),
    at = "2026-09-24T15:14:47.000Z";
  save.run("same", "patient", at, "High", "Dexcom Share");
  assert.equal(save.run("same", "patient", at, "315", "Dexcom Clarity").changes, 1);
  assert.equal(save.run("same", "patient", at, "High", "Dexcom Share").changes, 0);
  assert.equal(save.run("same", "patient", at, "315", "Dexcom Clarity").changes, 0);
  assert.deepEqual(
    { ...db.prepare("SELECT value,source FROM cgm_readings WHERE id=?").get("same") },
    { value: "315", source: "Dexcom Clarity" },
  );
  db.close();
});

test("reimport removes only a matching legacy minute-rounded Clarity row", () => {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE cgm_readings(id TEXT PRIMARY KEY, owner TEXT NOT NULL, at TEXT NOT NULL, value TEXT NOT NULL, source TEXT NOT NULL)",
  );
  const at = "2026-09-24T15:14:47.000Z",
    old = legacyRoundedAt(at);
  assert.equal(old, "2026-09-24T15:14:00.000Z");
  assert.equal(legacyRoundedAt(old), null);
  db.prepare(saveCgmSql).run("old", "patient", old, "315", "Dexcom Clarity");
  db.prepare(saveCgmSql).run("precise", "patient", at, "315", "Dexcom Clarity");
  db.prepare(saveCgmSql).run("other", "other-patient", old, "315", "Dexcom Clarity");
  db.prepare(saveCgmSql).run("different", "patient", old, "320", "Dexcom Clarity");
  const cleanup = db.prepare(`${cleanupLegacyClaritySql} ((at = ? AND value = ?))`);
  assert.equal(cleanup.run("patient", old, "315").changes, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM cgm_readings").get().count, 3);
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS count FROM cgm_readings WHERE owner=? AND at=?")
      .get("patient", at).count,
    1,
  );
  db.close();
});
