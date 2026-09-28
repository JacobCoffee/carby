CREATE TABLE "nightscout_records" (
	"owner" text NOT NULL,
	"collection" text NOT NULL,
	"id" text NOT NULL,
	"identifier" text,
	"dedupe_key" text NOT NULL,
	"at" text NOT NULL,
	"data" text NOT NULL,
	"carby" text NOT NULL,
	"token" text NOT NULL,
	"created" text NOT NULL,
	"modified" text NOT NULL,
	"deleted" text,
	"deleted_by" text,
	CONSTRAINT "nightscout_records_owner_collection_id_pk" PRIMARY KEY("owner","collection","id")
);
--> statement-breakpoint
CREATE INDEX "idx_nightscout_records_identifier" ON "nightscout_records" USING btree ("owner","collection","identifier");--> statement-breakpoint
CREATE INDEX "idx_nightscout_records_dedupe" ON "nightscout_records" USING btree ("owner","collection","dedupe_key");--> statement-breakpoint
CREATE INDEX "idx_nightscout_records_at" ON "nightscout_records" USING btree ("owner","collection","at");--> statement-breakpoint
CREATE INDEX "idx_nightscout_records_modified" ON "nightscout_records" USING btree ("owner","collection","modified");