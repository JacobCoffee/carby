CREATE TABLE "sync_outbox" (
	"owner" text NOT NULL,
	"tbl" text NOT NULL,
	"record_id" text NOT NULL,
	"previous" text,
	"theirs" text,
	"queued" text NOT NULL,
	"state" text NOT NULL,
	"error" text,
	CONSTRAINT "sync_outbox_owner_tbl_record_id_pk" PRIMARY KEY("owner","tbl","record_id")
);
