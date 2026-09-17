CREATE TABLE `roles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int,
	`name` varchar(120) NOT NULL,
	`slug` varchar(120) NOT NULL,
	`description` varchar(600),
	`baseRole` enum('platform_admin','owner','registered_manager','support_worker','hr_compliance','finance','read_only') NOT NULL,
	`isBuiltIn` int NOT NULL DEFAULT 0,
	`isAdminAccount` int NOT NULL DEFAULT 0,
	`grantedCapabilities` json,
	`deniedCapabilities` json,
	`visiblePaths` json,
	`status` enum('active','archived') NOT NULL DEFAULT 'active',
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `role_slug_uq` UNIQUE(`entityId`,`slug`)
);
--> statement-breakpoint
CREATE INDEX `role_entity_idx` ON `roles` (`entityId`,`status`);--> statement-breakpoint
ALTER TABLE `roles` ADD CONSTRAINT `roles_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO `roles` (`entityId`, `name`, `slug`, `baseRole`, `isBuiltIn`, `isAdminAccount`, `description`) VALUES
	(NULL, 'Platform administrator', 'platform_admin', 'platform_admin', 1, 1, 'Platform operator account with the Superadmin view.'),
	(NULL, 'Company administrator', 'owner', 'owner', 1, 1, 'Full access to everything in the companies they belong to.'),
	(NULL, 'Registered manager', 'registered_manager', 'registered_manager', 1, 0, 'Runs the service day to day, without company configuration.'),
	(NULL, 'Key Worker / support worker', 'support_worker', 'support_worker', 1, 0, 'Frontline record keeping for assigned young people only.'),
	(NULL, 'HR & compliance', 'hr_compliance', 'hr_compliance', 1, 0, 'Workforce records, compliance registers and document control.'),
	(NULL, 'Finance', 'finance', 'finance', 1, 0, 'Invoicing, packs and finance reporting.'),
	(NULL, 'Read only', 'read_only', 'read_only', 1, 0, 'View-only access across the company.');--> statement-breakpoint
INSERT INTO `roles` (`entityId`, `name`, `slug`, `description`, `baseRole`, `isBuiltIn`, `isAdminAccount`, `grantedCapabilities`, `deniedCapabilities`, `visiblePaths`, `status`, `createdBy`, `createdAt`)
SELECT `entityId`, `name`, `slug`, `description`, `baseRole`, 0, 0, `grantedCapabilities`, `deniedCapabilities`, `visiblePaths`, `status`, `createdBy`, `createdAt` FROM `customRoles`;--> statement-breakpoint
ALTER TABLE `entityMemberships` ADD `roleId` int;--> statement-breakpoint
UPDATE `entityMemberships` m JOIN `customRoles` c ON c.`id` = m.`customRoleId` JOIN `roles` r ON r.`entityId` = c.`entityId` AND r.`slug` = c.`slug` AND r.`isBuiltIn` = 0 SET m.`roleId` = r.`id`;--> statement-breakpoint
ALTER TABLE `entityMemberships` DROP FOREIGN KEY `entityMemberships_customRoleId_customRoles_id_fk`;--> statement-breakpoint
ALTER TABLE `entityMemberships` DROP COLUMN `customRoleId`;--> statement-breakpoint
ALTER TABLE `entityMemberships` ADD CONSTRAINT `entityMemberships_roleId_roles_id_fk` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD `roleId` int;--> statement-breakpoint
UPDATE `users` u JOIN `roles` r ON r.`isBuiltIn` = 1 AND r.`slug` = u.`operationalRole` SET u.`roleId` = r.`id`;--> statement-breakpoint
UPDATE `users` u JOIN `roles` r ON r.`isBuiltIn` = 1 AND r.`slug` = 'support_worker' SET u.`roleId` = r.`id` WHERE u.`roleId` IS NULL;--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `roleId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_roleId_roles_id_fk` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `role`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `operationalRole`;--> statement-breakpoint
ALTER TABLE `customRoles` DROP FOREIGN KEY `customRoles_entityId_entities_id_fk`;--> statement-breakpoint
ALTER TABLE `customRoles` DROP FOREIGN KEY `customRoles_createdBy_users_id_fk`;--> statement-breakpoint
DROP TABLE `customRoles`;
