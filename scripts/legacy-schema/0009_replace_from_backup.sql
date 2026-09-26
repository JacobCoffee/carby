ALTER TABLE `import_sessions` ADD `replace_existing` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `import_sessions` ADD `activation_claim` text;
