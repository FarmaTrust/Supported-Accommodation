CREATE TABLE `colleagueInvitationPropertyGrants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invitationId` int NOT NULL,
	`propertyId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `colleagueInvitationPropertyGrants_id` PRIMARY KEY(`id`),
	CONSTRAINT `colleague_invitation_property_uq` UNIQUE(`invitationId`,`propertyId`)
);
--> statement-breakpoint
CREATE TABLE `colleagueInvitations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`email` varchar(320) NOT NULL,
	`emailNormalized` varchar(320) NOT NULL,
	`operationalRole` enum('registered_manager','support_worker','hr_compliance','finance','read_only') NOT NULL,
	`allProperties` int NOT NULL DEFAULT 0,
	`extraCapabilities` json,
	`status` enum('pending','accepted','revoked','expired') NOT NULL DEFAULT 'pending',
	`expiresAt` bigint NOT NULL,
	`acceptedAt` bigint,
	`acceptedByUserId` int,
	`revokedAt` bigint,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `colleagueInvitations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `colleagueInvitationPropertyGrants` ADD CONSTRAINT `col_inv_prop_inv_fk` FOREIGN KEY (`invitationId`) REFERENCES `colleagueInvitations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `colleagueInvitationPropertyGrants` ADD CONSTRAINT `col_inv_prop_property_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `colleagueInvitations` ADD CONSTRAINT `col_inv_entity_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `colleagueInvitations` ADD CONSTRAINT `col_inv_accept_user_fk` FOREIGN KEY (`acceptedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `colleagueInvitations` ADD CONSTRAINT `col_inv_creator_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `colleague_invitation_property_idx` ON `colleagueInvitationPropertyGrants` (`propertyId`);--> statement-breakpoint
CREATE INDEX `colleague_invitation_entity_status_idx` ON `colleagueInvitations` (`entityId`,`status`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `colleague_invitation_email_idx` ON `colleagueInvitations` (`emailNormalized`,`status`);
