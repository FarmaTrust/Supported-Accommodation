CREATE TABLE `shiftRequests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`shiftId` int NOT NULL,
	`requestType` enum('claim','swap','release','cancel') NOT NULL,
	`requestedBy` int NOT NULL,
	`proposedUserId` int,
	`reason` text,
	`status` enum('pending','approved','declined','withdrawn') NOT NULL DEFAULT 'pending',
	`reviewedBy` int,
	`reviewedAt` bigint,
	`reviewNotes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `shiftRequests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `timesheetEntries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`timesheetId` int NOT NULL,
	`shiftId` int,
	`clockInEventId` int,
	`clockOutEventId` int,
	`minutes` int NOT NULL,
	`exceptionType` enum('none','missing_clock','off_site','manual_adjustment','overlap') NOT NULL DEFAULT 'none',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `timesheetEntries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `timesheets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`userId` int NOT NULL,
	`periodStart` bigint NOT NULL,
	`periodEnd` bigint NOT NULL,
	`totalMinutes` int NOT NULL DEFAULT 0,
	`status` enum('draft','submitted','approved','returned','exported') NOT NULL DEFAULT 'draft',
	`submittedAt` bigint,
	`approvedAt` bigint,
	`approvedBy` int,
	`exportReference` varchar(120),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `timesheets_id` PRIMARY KEY(`id`),
	CONSTRAINT `timesheet_period_uq` UNIQUE(`entityId`,`userId`,`periodStart`,`periodEnd`)
);
--> statement-breakpoint
ALTER TABLE `shiftRequests` ADD CONSTRAINT `shiftRequests_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftRequests` ADD CONSTRAINT `shiftRequests_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftRequests` ADD CONSTRAINT `shiftRequests_shiftId_shifts_id_fk` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftRequests` ADD CONSTRAINT `shiftRequests_requestedBy_users_id_fk` FOREIGN KEY (`requestedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftRequests` ADD CONSTRAINT `shiftRequests_proposedUserId_users_id_fk` FOREIGN KEY (`proposedUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftRequests` ADD CONSTRAINT `shiftRequests_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timesheetEntries` ADD CONSTRAINT `timesheetEntries_timesheetId_timesheets_id_fk` FOREIGN KEY (`timesheetId`) REFERENCES `timesheets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timesheetEntries` ADD CONSTRAINT `timesheetEntries_shiftId_shifts_id_fk` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timesheets` ADD CONSTRAINT `timesheets_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timesheets` ADD CONSTRAINT `timesheets_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timesheets` ADD CONSTRAINT `timesheets_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `shift_request_status_idx` ON `shiftRequests` (`entityId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `timesheet_entry_sheet_idx` ON `timesheetEntries` (`timesheetId`);