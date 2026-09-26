import { Pool } from "pg";
import { makeDatabase, type Database } from "./postgres";
export type { Database, QueryResult, Statement } from "./postgres";

// Kept on globalThis so a dev-server module reload reuses the pool instead of opening another.
const shared = globalThis as typeof globalThis & { carbyDatabase?: Database };

/** The app's database. Throws synchronously when DATABASE_URL is missing or blank. */
export function database(): Database {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("storage unavailable: DATABASE_URL is not set");
  if (!shared.carbyDatabase) {
    // Connections open on first query, so creating the pool does not touch the network.
    const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 10000 });
    pool.on("error", (error) => console.error("idle database connection failed", error.message));
    shared.carbyDatabase = makeDatabase(pool);
  }
  return shared.carbyDatabase;
}
