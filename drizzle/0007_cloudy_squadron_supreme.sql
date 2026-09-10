CREATE TABLE `creditNotes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`invoiceId` int NOT NULL,
	`creditNumber` varchar(64) NOT NULL,
	`creditDate` bigint NOT NULL,
	`reason` text NOT NULL,
	`netAmount` decimal(12,2) NOT NULL,
	`vatAmount` decimal(12,2) NOT NULL,
	`total` decimal(12,2) NOT NULL,
	`status` enum('draft','issued','void') NOT NULL DEFAULT 'draft',
	`issuedAt` bigint,
	`issuedBy` int,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `creditNotes_id` PRIMARY KEY(`id`),
	CONSTRAINT `credit_number_uq` UNIQUE(`entityId`,`creditNumber`)
);
--> statement-breakpoint
CREATE TABLE `invoiceEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`invoiceId` int NOT NULL,
	`eventType` enum('created','approved','issued','delivered','reminded','disputed','dispute_resolved','payment','credit','reconciled','voided') NOT NULL,
	`occurredAt` bigint NOT NULL,
	`actorUserId` int,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invoiceEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recordShortcuts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`entityId` int NOT NULL,
	`resourceType` varchar(80) NOT NULL,
	`resourceId` varchar(80) NOT NULL,
	`title` varchar(220) NOT NULL,
	`path` varchar(500) NOT NULL,
	`isFavorite` int NOT NULL DEFAULT 0,
	`lastViewedAt` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `recordShortcuts_id` PRIMARY KEY(`id`),
	CONSTRAINT `record_shortcut_uq` UNIQUE(`userId`,`entityId`,`resourceType`,`resourceId`)
);
--> statement-breakpoint
CREATE TABLE `workPlanDependencies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`actionId` int NOT NULL,
	`dependsOnActionId` int NOT NULL,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workPlanDependencies_id` PRIMARY KEY(`id`),
	CONSTRAINT `work_plan_dependency_uq` UNIQUE(`actionId`,`dependsOnActionId`)
);
--> statement-breakpoint
ALTER TABLE `invoices` ADD `sentAt` bigint;--> statement-breakpoint
ALTER TABLE `invoices` ADD `deliveryMethod` enum('secure_link','email','portal','manual');--> statement-breakpoint
ALTER TABLE `invoices` ADD `deliveryReference` varchar(220);--> statement-breakpoint
ALTER TABLE `invoices` ADD `disputeOpenedAt` bigint;--> statement-breakpoint
ALTER TABLE `invoices` ADD `disputeResolvedAt` bigint;--> statement-breakpoint
ALTER TABLE `invoices` ADD `reconciliationStatus` enum('unreconciled','part_reconciled','reconciled','exception') DEFAULT 'unreconciled' NOT NULL;--> statement-breakpoint
ALTER TABLE `timesheetEntries` ADD `originalMinutes` int;--> statement-breakpoint
ALTER TABLE `timesheetEntries` ADD `adjustedBy` int;--> statement-breakpoint
ALTER TABLE `timesheetEntries` ADD `adjustedAt` bigint;--> statement-breakpoint
ALTER TABLE `timesheetEntries` ADD `adjustmentReason` text;--> statement-breakpoint
ALTER TABLE `workPlanActions` ADD `evidenceDocumentId` int;--> statement-breakpoint
ALTER TABLE `workPlanActions` ADD `reviewedAt` bigint;--> statement-breakpoint
ALTER TABLE `workPlanActions` ADD `reviewedBy` int;--> statement-breakpoint
ALTER TABLE `workPlanActions` ADD `reviewOutcome` enum('approved','returned');--> statement-breakpoint
ALTER TABLE `workPlanActions` ADD `reviewNotes` text;--> statement-breakpoint
ALTER TABLE `creditNotes` ADD CONSTRAINT `creditNotes_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `creditNotes` ADD CONSTRAINT `creditNotes_invoiceId_invoices_id_fk` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `creditNotes` ADD CONSTRAINT `creditNotes_issuedBy_users_id_fk` FOREIGN KEY (`issuedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `creditNotes` ADD CONSTRAINT `creditNotes_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoiceEvents` ADD CONSTRAINT `invoiceEvents_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoiceEvents` ADD CONSTRAINT `invoiceEvents_invoiceId_invoices_id_fk` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoiceEvents` ADD CONSTRAINT `invoiceEvents_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recordShortcuts` ADD CONSTRAINT `recordShortcuts_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recordShortcuts` ADD CONSTRAINT `recordShortcuts_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workPlanDependencies` ADD CONSTRAINT `workPlanDependencies_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workPlanDependencies` ADD CONSTRAINT `workPlanDependencies_actionId_workPlanActions_id_fk` FOREIGN KEY (`actionId`) REFERENCES `workPlanActions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workPlanDependencies` ADD CONSTRAINT `workPlanDependencies_dependsOnActionId_workPlanActions_id_fk` FOREIGN KEY (`dependsOnActionId`) REFERENCES `workPlanActions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workPlanDependencies` ADD CONSTRAINT `workPlanDependencies_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `credit_invoice_idx` ON `creditNotes` (`invoiceId`);--> statement-breakpoint
CREATE INDEX `invoice_event_idx` ON `invoiceEvents` (`invoiceId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `record_shortcut_recent_idx` ON `recordShortcuts` (`userId`,`entityId`,`lastViewedAt`);--> statement-breakpoint
ALTER TABLE `timesheetEntries` ADD CONSTRAINT `timesheetEntries_adjustedBy_users_id_fk` FOREIGN KEY (`adjustedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workPlanActions` ADD CONSTRAINT `workPlanActions_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;