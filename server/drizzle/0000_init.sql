-- Baseline. IF NOT EXISTS (added by hand) lets databases created by the
-- pre-migration bootstrap DDL adopt this migration without conflict.
CREATE TABLE IF NOT EXISTS `blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`parent_id` text,
	`order_key` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_blocks_page` ON `blocks` (`page_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_blocks_parent` ON `blocks` (`parent_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `pages_title_unique` ON `pages` (`title`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `refs` (
	`block_id` text NOT NULL,
	`page_id` text NOT NULL,
	PRIMARY KEY(`block_id`, `page_id`),
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_refs_page` ON `refs` (`page_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tasks` (
	`block_id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tasks_state` ON `tasks` (`state`);