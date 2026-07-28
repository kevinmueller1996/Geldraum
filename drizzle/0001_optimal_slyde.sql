CREATE TABLE `user_activity` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email_mask` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`access_count` integer DEFAULT 1 NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
