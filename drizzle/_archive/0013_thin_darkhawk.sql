CREATE TABLE `keyWorkerReportSources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`reportId` int NOT NULL,
	`sourceType` enum('keywork_session','daily_note','support_goal','appointment','incident','curfew_check','medication','finance') NOT NULL,
	`sourceId` varchar(80) NOT NULL,
	`linkReason` enum('included','summarised','follow_up','evidence') NOT NULL DEFAULT 'included',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `keyWorkerReportSources_id` PRIMARY KEY(`id`),
	CONSTRAINT `report_source_uq` UNIQUE(`reportId`,`sourceType`,`sourceId`)
);
--> statement-breakpoint
CREATE TABLE `medicationSelfAdministrationEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`placementId` int NOT NULL,
	`medicationId` int NOT NULL,
	`administrationId` int,
	`stockTransactionId` int,
	`discrepancyId` int,
	`eventType` enum('assessment','authorised','supported','self_administered','observed','withheld','reviewed','revoked') NOT NULL,
	`outcome` enum('safe','support_required','not_safe','completed','refused','omitted','not_applicable') NOT NULL,
	`occurredAt` bigint NOT NULL,
	`detailsCiphertext` text NOT NULL,
	`competencySnapshot` json,
	`nextReviewAt` bigint,
	`reviewedBy` int,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `medicationSelfAdministrationEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `residentFinanceDiscrepancies` ADD `workPlanActionId` int;--> statement-breakpoint
ALTER TABLE `residentFinanceReconciliations` ADD `workPlanActionId` int;--> statement-breakpoint
ALTER TABLE `shiftBreaks` ADD `startClockEventId` int;--> statement-breakpoint
ALTER TABLE `shiftBreaks` ADD `endClockEventId` int;--> statement-breakpoint
ALTER TABLE `keyWorkerReportSources` ADD CONSTRAINT `keyWorkerReportSources_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyWorkerReportSources` ADD CONSTRAINT `keyWorkerReportSources_reportId_keyWorkerReports_id_fk` FOREIGN KEY (`reportId`) REFERENCES `keyWorkerReports`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyWorkerReportSources` ADD CONSTRAINT `keyWorkerReportSources_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationSelfAdministrationEvents` ADD CONSTRAINT `medicationSelfAdministrationEvents_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationSelfAdministrationEvents` ADD CONSTRAINT `medicationSelfAdministrationEvents_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationSelfAdministrationEvents` ADD CONSTRAINT `medicationSelfAdministrationEvents_medicationId_medications_id_fk` FOREIGN KEY (`medicationId`) REFERENCES `medications`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationSelfAdministrationEvents` ADD CONSTRAINT `medicationSelfAdministrationEvents_administrationId_medicationAdministrations_id_fk` FOREIGN KEY (`administrationId`) REFERENCES `medicationAdministrations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationSelfAdministrationEvents` ADD CONSTRAINT `medicationSelfAdministrationEvents_stockTransactionId_medicationStockTransactions_id_fk` FOREIGN KEY (`stockTransactionId`) REFERENCES `medicationStockTransactions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationSelfAdministrationEvents` ADD CONSTRAINT `medicationSelfAdministrationEvents_discrepancyId_medicationDiscrepancies_id_fk` FOREIGN KEY (`discrepancyId`) REFERENCES `medicationDiscrepancies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationSelfAdministrationEvents` ADD CONSTRAINT `medicationSelfAdministrationEvents_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationSelfAdministrationEvents` ADD CONSTRAINT `medicationSelfAdministrationEvents_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `report_source_lookup_idx` ON `keyWorkerReportSources` (`sourceType`,`sourceId`);--> statement-breakpoint
CREATE INDEX `med_self_admin_idx` ON `medicationSelfAdministrationEvents` (`medicationId`,`occurredAt`,`eventType`);--> statement-breakpoint
ALTER TABLE `residentFinanceDiscrepancies` ADD CONSTRAINT `residentFinanceDiscrepancies_workPlanActionId_workPlanActions_id_fk` FOREIGN KEY (`workPlanActionId`) REFERENCES `workPlanActions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceReconciliations` ADD CONSTRAINT `residentFinanceReconciliations_workPlanActionId_workPlanActions_id_fk` FOREIGN KEY (`workPlanActionId`) REFERENCES `workPlanActions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftBreaks` ADD CONSTRAINT `shiftBreaks_startClockEventId_clockEvents_id_fk` FOREIGN KEY (`startClockEventId`) REFERENCES `clockEvents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftBreaks` ADD CONSTRAINT `shiftBreaks_endClockEventId_clockEvents_id_fk` FOREIGN KEY (`endClockEventId`) REFERENCES `clockEvents`(`id`) ON DELETE no action ON UPDATE no action;