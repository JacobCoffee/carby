import { test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";
import { makeDatabase } from "../db/postgres.ts";

// An isolated Postgres supplied by whoever runs the tests. There is deliberately no default.
const url = process.env.TEST_DATABASE_URL?.trim() ?? "";
if (!url)
  console.warn("TEST_DATABASE_URL is not set; skipping tests that need a Postgres database.");

/** `test` that is skipped unless TEST_DATABASE_URL names a Postgres database. */
export const pgTest = test.skipIf(!url);

const migrations = new URL("../postgres/", import.meta.url);

/**
 * A fresh schema holding every postgres/*.sql migration, and the app's Database over a pool whose
 * connections all use that schema. `close()` drops the schema.
 */
export async function createTestDatabase() {
  const schema = `test_${randomBytes(8).toString("hex")}`;
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}"`);
    for (const file of readdirSync(migrations)
      .filter((file) => file.endsWith(".sql"))
      .sort())
      await admin.query(readFileSync(new URL(file, migrations), "utf8"));
  } finally {
    await admin.end();
  }
  const pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` });
  const database = makeDatabase(pool);
  const query = (sql, args) => database.prepare(sql).bind(...args);
  return {
    schema,
    database,
    get: (sql, ...args) => query(sql, args).first(),
    all: async (sql, ...args) => (await query(sql, args).all()).results,
    run: (sql, ...args) => query(sql, args).run(),
    async close() {
      await pool.end();
      const cleanup = new pg.Client({ connectionString: url });
      await cleanup.connect();
      try {
        await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await cleanup.end();
      }
    },
  };
}
