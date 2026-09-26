CREATE TABLE `care_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`entry_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`action` text NOT NULL,
	`before` text,
	`after` text,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_care_audit_owner_at` ON `care_audit` (`owner`,`at`);
