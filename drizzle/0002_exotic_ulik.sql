CREATE TABLE `customRoles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`slug` varchar(120) NOT NULL,
	`description` varchar(600),
	`baseRole` enum('owner','registered_manager','support_worker','hr_compliance','finance','read_only') NOT NULL,
	`grantedCapabilities` json,
	`deniedCapabilities` json,
	`visiblePaths` json,
	`status` enum('active','archived') NOT NULL DEFAULT 'active',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customRoles_id` PRIMARY KEY(`id`),
	CONSTRAINT `custom_role_slug_uq` UNIQUE(`entityId`,`slug`)
);
--> statement-breakpoint
ALTER TABLE `entityMemberships` ADD `customRoleId` int;--> statement-breakpoint
ALTER TABLE `customRoles` ADD CONSTRAINT `customRoles_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `customRoles` ADD CONSTRAINT `customRoles_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `custom_role_entity_idx` ON `customRoles` (`entityId`,`status`);--> statement-breakpoint
ALTER TABLE `entityMemberships` ADD CONSTRAINT `entityMemberships_customRoleId_customRoles_id_fk` FOREIGN KEY (`customRoleId`) REFERENCES `customRoles`(`id`) ON DELETE no action ON UPDATE no action;