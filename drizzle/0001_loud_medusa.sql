CREATE TABLE `printableRecordExports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int,
	`placementId` int,
	`timesheetId` int,
	`exportType` enum('young_person_compilation','shift_register','timesheet','document_register') NOT NULL,
	`rangeStart` bigint NOT NULL,
	`rangeEnd` bigint NOT NULL,
	`status` enum('awaiting_approval','returned','declined','generating','ready','failed') NOT NULL DEFAULT 'awaiting_approval',
	`snapshotHash` varchar(128) NOT NULL,
	`manifest` json NOT NULL,
	`requestedBy` int NOT NULL,
	`reviewedBy` int,
	`reviewerRole` varchar(80),
	`reviewedAt` bigint,
	`reviewNotesCiphertext` text,
	`documentId` int,
	`releasedAt` bigint,
	`errorCode` varchar(80),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `printableRecordExports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `automationRules` MODIFY COLUMN `ruleType` enum('compliance','review','work_plan','policy','placement','invoice','evidence') NOT NULL;--> statement-breakpoint
ALTER TABLE `curfewPlans` ADD `templateId` int;--> statement-breakpoint
ALTER TABLE `curfewPlans` ADD `templateVersion` int;--> statement-breakpoint
ALTER TABLE `healthMonitoringPlans` ADD `templateId` int;--> statement-breakpoint
ALTER TABLE `healthMonitoringPlans` ADD `templateVersion` int;--> statement-breakpoint
ALTER TABLE `medications` ADD `templateId` int;--> statement-breakpoint
ALTER TABLE `medications` ADD `templateVersion` int;--> statement-breakpoint
ALTER TABLE `propertyVisitors` ADD `departureNotesCiphertext` text;--> statement-breakpoint
ALTER TABLE `shifts` ADD `coverageGapKey` varchar(180);--> statement-breakpoint
ALTER TABLE `shifts` ADD `coverageGapSlot` int;--> statement-breakpoint
ALTER TABLE `users` ADD `phone` varchar(40);--> statement-breakpoint
ALTER TABLE `users` ADD `phoneCapturedAt` bigint;--> statement-breakpoint
ALTER TABLE `shifts` ADD CONSTRAINT `shift_coverage_gap_slot_uq` UNIQUE(`propertyId`,`coverageGapKey`,`coverageGapSlot`);--> statement-breakpoint
ALTER TABLE `printableRecordExports` ADD CONSTRAINT `printableRecordExports_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `printableRecordExports` ADD CONSTRAINT `printableRecordExports_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `printableRecordExports` ADD CONSTRAINT `printableRecordExports_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `printableRecordExports` ADD CONSTRAINT `printableRecordExports_timesheetId_timesheets_id_fk` FOREIGN KEY (`timesheetId`) REFERENCES `timesheets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `printableRecordExports` ADD CONSTRAINT `printableRecordExports_requestedBy_users_id_fk` FOREIGN KEY (`requestedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `printableRecordExports` ADD CONSTRAINT `printableRecordExports_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `printableRecordExports` ADD CONSTRAINT `printableRecordExports_documentId_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `printable_export_status_idx` ON `printableRecordExports` (`entityId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `printable_export_placement_idx` ON `printableRecordExports` (`placementId`,`rangeStart`);--> statement-breakpoint
CREATE INDEX `printable_export_property_idx` ON `printableRecordExports` (`propertyId`,`rangeStart`);--> statement-breakpoint
CREATE INDEX `printable_export_timesheet_idx` ON `printableRecordExports` (`timesheetId`);--> statement-breakpoint
ALTER TABLE `curfewPlans` ADD CONSTRAINT `curfewPlans_templateId_documentTemplates_id_fk` FOREIGN KEY (`templateId`) REFERENCES `documentTemplates`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `healthMonitoringPlans` ADD CONSTRAINT `healthMonitoringPlans_templateId_documentTemplates_id_fk` FOREIGN KEY (`templateId`) REFERENCES `documentTemplates`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medications` ADD CONSTRAINT `medications_templateId_documentTemplates_id_fk` FOREIGN KEY (`templateId`) REFERENCES `documentTemplates`(`id`) ON DELETE no action ON UPDATE no action;