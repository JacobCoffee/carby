#!/usr/bin/env node
// Apply pending postgres/*.sql migrations to DATABASE_URL, each in its own transaction.
// Usage: node scripts/migrate.mjs
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";

// A fixed key shared by every release, so concurrent deploys apply migrations one at a time.
const LOCK_KEY = 7_302_551_900_421_337n;
const directory = new URL("../postgres/", import.meta.url);

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is not set.");
  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const client = new pg.Client({ connectionString: url });
  // An idle client error would otherwise crash the process without a message.
  client.on("error", (error) => console.error(`Database connection failed: ${error.message}`));
  await client.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY.toString()]);
    locked = true;
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const { rows } = await client.query("SELECT filename FROM schema_migrations");
    const applied = new Set(rows.map((row) => row.filename));
    const pending = files.filter((file) => !applied.has(file));
    for (const file of pending) {
      const sql = readFileSync(new URL(file, directory), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw new Error(
          `${file} failed: ${error instanceof Error ? error.message : String(error)}`,
          {
            cause: error,
          },
        );
      }
      console.log(`Applied ${file}`);
    }
    if (!pending.length) console.log("No pending migrations.");
  } finally {
    try {
      if (locked) await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY.toString()]);
    } finally {
      await client.end();
    }
  }
}

main().catch((error) => {
  console.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
