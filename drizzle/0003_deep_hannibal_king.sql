CREATE TABLE `auth_action_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`purpose` text NOT NULL CHECK (`purpose` IN ('verify_email', 'password_reset')),
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_action_tokens_user_purpose_idx` ON `auth_action_tokens` (`user_id`,`purpose`);--> statement-breakpoint
CREATE INDEX `auth_action_tokens_expires_at_idx` ON `auth_action_tokens` (`expires_at`);--> statement-breakpoint
ALTER TABLE `auth_credentials` ADD `email_address` text;--> statement-breakpoint
ALTER TABLE `auth_credentials` ADD `email_verified_at` text;
