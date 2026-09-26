CREATE TABLE "care_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"entry_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"action" text NOT NULL,
	"before" text,
	"after" text,
	"at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cgm_readings" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"at" text NOT NULL,
	"value" text NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dexcom_connections" (
	"owner" text PRIMARY KEY NOT NULL,
	"credentials" text NOT NULL,
	"last_sync" text,
	"updated" text NOT NULL,
	"latest_reading_at" text,
	"last_attempt_at" text,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "dexcom_events" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"at" text NOT NULL,
	"data" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"at" text NOT NULL,
	"data" text NOT NULL,
	"plan" text NOT NULL,
	"updated" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "illness_windows" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"start_date" text NOT NULL,
	"data" text NOT NULL,
	"updated" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"session" text NOT NULL,
	"tbl" text NOT NULL,
	"row_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "import_rows_session_tbl_row_id_pk" PRIMARY KEY("session","tbl","row_id")
);
--> statement-breakpoint
CREATE TABLE "import_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"state" text NOT NULL,
	"tables" text NOT NULL,
	"exported_at" text NOT NULL,
	"source_owner" text,
	"next_chunk" integer DEFAULT 0 NOT NULL,
	"last_chunk" text,
	"connection_rows" integer DEFAULT 0 NOT NULL,
	"staged_rows" integer DEFAULT 0 NOT NULL,
	"staged_bytes" integer DEFAULT 0 NOT NULL,
	"summary" text,
	"created" text NOT NULL,
	"updated" text NOT NULL,
	"replace_existing" integer DEFAULT 0 NOT NULL,
	"activation_claim" text
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"data" text NOT NULL,
	"created" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_foods" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"data" text NOT NULL,
	"updated" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_care_audit_owner_at" ON "care_audit" USING btree ("owner","at");--> statement-breakpoint
CREATE INDEX "idx_cgm_owner_at" ON "cgm_readings" USING btree ("owner","at");--> statement-breakpoint
CREATE INDEX "idx_dexcom_events_owner_at" ON "dexcom_events" USING btree ("owner","at");--> statement-breakpoint
CREATE INDEX "idx_entries_owner_at" ON "entries" USING btree ("owner","at");--> statement-breakpoint
CREATE INDEX "idx_illness_windows_owner_start" ON "illness_windows" USING btree ("owner","start_date");--> statement-breakpoint
CREATE INDEX "idx_import_sessions_owner_state" ON "import_sessions" USING btree ("owner","state");--> statement-breakpoint
CREATE INDEX "idx_plans_owner_created" ON "plans" USING btree ("owner","created");--> statement-breakpoint
CREATE INDEX "idx_saved_foods_owner" ON "saved_foods" USING btree ("owner");