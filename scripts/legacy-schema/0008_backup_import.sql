CREATE TABLE `import_rows` (
	`session` text NOT NULL,
	`tbl` text NOT NULL,
	`row_id` text NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`session`, `tbl`, `row_id`)
);
--> statement-breakpoint
CREATE TABLE `import_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`state` text NOT NULL,
	`tables` text NOT NULL,
	`exported_at` text NOT NULL,
	`source_owner` text,
	`next_chunk` integer DEFAULT 0 NOT NULL,
	`last_chunk` text,
	`connection_rows` integer DEFAULT 0 NOT NULL,
	`staged_rows` integer DEFAULT 0 NOT NULL,
	`staged_bytes` integer DEFAULT 0 NOT NULL,
	`summary` text,
	`created` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_import_sessions_owner_state` ON `import_sessions` (`owner`,`state`);
