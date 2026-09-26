import { defineConfig } from "drizzle-kit";

// Generates reviewed SQL into postgres/; scripts/migrate.mjs applies it.
export default defineConfig({
  out: "./postgres",
  schema: "./db/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
