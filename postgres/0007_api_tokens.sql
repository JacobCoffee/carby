CREATE TABLE "api_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"person" text NOT NULL,
	"account" text NOT NULL,
	"label" text NOT NULL,
	"scopes" text NOT NULL,
	"token_hash" text NOT NULL,
	"secret_hash" text NOT NULL,
	"created" text NOT NULL,
	"last_used" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_api_tokens_token" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_api_tokens_secret" ON "api_tokens" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "idx_api_tokens_person_account" ON "api_tokens" USING btree ("person","account");