CREATE TABLE IF NOT EXISTS `business_plans` (
	`user_id` text PRIMARY KEY NOT NULL,
	`plan_json` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
