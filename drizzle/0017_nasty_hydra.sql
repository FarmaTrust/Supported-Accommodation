CREATE TABLE `guestInvitations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`purpose` enum('property_summary') NOT NULL DEFAULT 'property_summary',
	`recipientLabel` varchar(180),
	`tokenHash` varchar(128) NOT NULL,
	`expiresAt` bigint NOT NULL,
	`maxUses` int NOT NULL DEFAULT 1,
	`useCount` int NOT NULL DEFAULT 0,
	`revokedAt` bigint,
	`lastAccessedAt` bigint,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `guestInvitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `guest_invitation_token_uq` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
ALTER TABLE `guestInvitations` ADD CONSTRAINT `guestInvitations_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `guestInvitations` ADD CONSTRAINT `guestInvitations_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `guestInvitations` ADD CONSTRAINT `guestInvitations_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `guest_invitation_entity_idx` ON `guestInvitations` (`entityId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `guest_invitation_expiry_idx` ON `guestInvitations` (`expiresAt`);