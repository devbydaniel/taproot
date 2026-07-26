CREATE TABLE `pin_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`order_key` text NOT NULL,
	`collapsed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `pages` ADD `pinned_folder_id` text REFERENCES pin_folders(id);