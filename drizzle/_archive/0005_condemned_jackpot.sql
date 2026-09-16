CREATE TABLE `documentFolders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`parentFolderId` int,
	`name` varchar(180) NOT NULL,
	`classification` enum('general','hr','finance','safeguarding','bank','restricted') NOT NULL DEFAULT 'general',
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `documentFolders_id` PRIMARY KEY(`id`),
	CONSTRAINT `document_folder_name_uq` UNIQUE(`entityId`,`parentFolderId`,`name`)
);
--> statement-breakpoint
CREATE TABLE `documentTemplates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int,
	`templateKey` varchar(100) NOT NULL,
	`title` varchar(220) NOT NULL,
	`category` enum('provider_pack','support_plan','pathway_plan','risk_assessment','incident_notification','supervision','placement_commencement','inspection_export','other') NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`fieldSchema` json,
	`bodyTemplate` text NOT NULL,
	`status` enum('draft','active','superseded','archived') NOT NULL DEFAULT 'active',
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `documentTemplates_id` PRIMARY KEY(`id`),
	CONSTRAINT `document_template_version_uq` UNIQUE(`entityId`,`templateKey`,`version`)
);
--> statement-breakpoint
CREATE TABLE `exportJobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int,
	`exportType` enum('inspection','subject_access','record_transfer','finance','audit','custom') NOT NULL,
	`scope` json NOT NULL,
	`redaction` json,
	`manifest` json,
	`status` enum('queued','generating','ready','failed','expired') NOT NULL DEFAULT 'queued',
	`documentId` int,
	`requestedBy` int NOT NULL,
	`completedAt` bigint,
	`expiresAt` bigint,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `exportJobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `propertyEvidence` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`recordType` enum('certificate','insurance','lease','licence','contractor','maintenance','inventory','location_assessment','fire_risk','gas_safety','electrical_safety','water_safety','other') NOT NULL,
	`title` varchar(240) NOT NULL,
	`providerName` varchar(180),
	`reference` varchar(160),
	`issuedAt` bigint,
	`dueAt` bigint,
	`ownerUserId` int,
	`status` enum('draft','valid','due_soon','expired','action_required','closed') NOT NULL DEFAULT 'draft',
	`details` json,
	`documentId` int,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `propertyEvidence_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `retentionReviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`resourceType` varchar(80) NOT NULL,
	`resourceId` int NOT NULL,
	`classification` enum('general','hr','finance','safeguarding','bank','restricted') NOT NULL,
	`retentionBasis` varchar(240) NOT NULL,
	`retentionUntil` bigint NOT NULL,
	`reviewDueAt` bigint NOT NULL,
	`legalHold` int NOT NULL DEFAULT 0,
	`status` enum('pending','hold','approved_delete','approved_transfer','completed','cancelled') NOT NULL DEFAULT 'pending',
	`requestedBy` int,
	`approvedBy` int,
	`decisionAt` bigint,
	`decisionNotes` text,
	`completedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `retentionReviews_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `documentVersions` ADD `scanStatus` enum('pending','not_available','clean','quarantined') DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `folderId` int;--> statement-breakpoint
ALTER TABLE `documentFolders` ADD CONSTRAINT `documentFolders_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documentFolders` ADD CONSTRAINT `documentFolders_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documentTemplates` ADD CONSTRAINT `documentTemplates_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documentTemplates` ADD CONSTRAINT `documentTemplates_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `exportJobs` ADD CONSTRAINT `exportJobs_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `exportJobs` ADD CONSTRAINT `exportJobs_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `exportJobs` ADD CONSTRAINT `exportJobs_documentId_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `exportJobs` ADD CONSTRAINT `exportJobs_requestedBy_users_id_fk` FOREIGN KEY (`requestedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyEvidence` ADD CONSTRAINT `propertyEvidence_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyEvidence` ADD CONSTRAINT `propertyEvidence_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyEvidence` ADD CONSTRAINT `propertyEvidence_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyEvidence` ADD CONSTRAINT `propertyEvidence_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `retentionReviews` ADD CONSTRAINT `retentionReviews_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `retentionReviews` ADD CONSTRAINT `retentionReviews_requestedBy_users_id_fk` FOREIGN KEY (`requestedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `retentionReviews` ADD CONSTRAINT `retentionReviews_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `export_jobs_status_idx` ON `exportJobs` (`entityId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `property_evidence_due_idx` ON `propertyEvidence` (`entityId`,`propertyId`,`dueAt`,`status`);--> statement-breakpoint
CREATE INDEX `retention_review_due_idx` ON `retentionReviews` (`entityId`,`reviewDueAt`,`status`);--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_folderId_documentFolders_id_fk` FOREIGN KEY (`folderId`) REFERENCES `documentFolders`(`id`) ON DELETE no action ON UPDATE no action;