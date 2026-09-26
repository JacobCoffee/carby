CREATE TABLE "clarity_connections" (
	"owner" text PRIMARY KEY NOT NULL,
	"credentials" text NOT NULL,
	"subject_id" text NOT NULL,
	"subject_name" text NOT NULL,
	"expires_at" text NOT NULL,
	"auto_sync" boolean NOT NULL,
	"monthly_reports" text NOT NULL,
	"synced_through" text,
	"last_sync" text,
	"last_attempt_at" text,
	"last_error" text,
	"updated" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clarity_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"reports" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"scheduled" boolean NOT NULL,
	"created" text NOT NULL,
	"size" integer NOT NULL,
	"pdf" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_clarity_reports_owner_created" ON "clarity_reports" USING btree ("owner","created");