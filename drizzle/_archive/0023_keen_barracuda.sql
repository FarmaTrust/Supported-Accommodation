CREATE TABLE `temporaryLoginLinks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`targetUserId` int NOT NULL,
	`tokenHash` varchar(128) NOT NULL,
	`expiresAt` bigint NOT NULL,
	`redeemedAt` bigint,
	`revokedAt` bigint,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `temporaryLoginLinks_id` PRIMARY KEY(`id`),
	CONSTRAINT `temporary_login_link_token_uq` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
ALTER TABLE `temporaryLoginLinks` ADD CONSTRAINT `temporaryLoginLinks_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `temporaryLoginLinks` ADD CONSTRAINT `temporaryLoginLinks_targetUserId_users_id_fk` FOREIGN KEY (`targetUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `temporaryLoginLinks` ADD CONSTRAINT `temporaryLoginLinks_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `temporary_login_link_recipient_idx` ON `temporaryLoginLinks` (`entityId`,`targetUserId`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `temporary_login_link_expiry_idx` ON `temporaryLoginLinks` (`expiresAt`);