CREATE TABLE `localAuthCredentials` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`emailNormalized` varchar(320) NOT NULL,
	`passwordHash` text NOT NULL,
	`passwordVersion` int NOT NULL DEFAULT 1,
	`failedAttempts` int NOT NULL DEFAULT 0,
	`lockedUntil` bigint,
	`lastFailedAt` bigint,
	`lastPasswordChangedAt` bigint NOT NULL,
	`resetTokenHash` varchar(128),
	`resetExpiresAt` bigint,
	`resetUsedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `localAuthCredentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `local_auth_user_uq` UNIQUE(`userId`),
	CONSTRAINT `local_auth_email_uq` UNIQUE(`emailNormalized`)
);
--> statement-breakpoint
ALTER TABLE `localAuthCredentials` ADD CONSTRAINT `localAuthCredentials_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `local_auth_reset_idx` ON `localAuthCredentials` (`resetTokenHash`,`resetExpiresAt`);