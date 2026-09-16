CREATE TABLE `dailyNotes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`placementId` int NOT NULL,
	`shiftId` int,
	`noteType` enum('observation','contact','appointment','achievement','concern','activity','education','health','other') NOT NULL,
	`observedAt` bigint NOT NULL,
	`contentCiphertext` text NOT NULL,
	`youngPersonViewCiphertext` text,
	`tags` json,
	`status` enum('draft','submitted','reviewed','returned') NOT NULL DEFAULT 'draft',
	`reviewedBy` int,
	`reviewedAt` bigint,
	`version` int NOT NULL DEFAULT 1,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dailyNotes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `emergencyRollCallEntries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`rollCallId` int NOT NULL,
	`personType` enum('young_person','visitor','staff','professional','contractor','other') NOT NULL,
	`placementId` int,
	`visitorId` int,
	`userId` int,
	`nameSnapshotCiphertext` text,
	`expectedState` enum('expected','not_expected','unknown') NOT NULL DEFAULT 'unknown',
	`accountedState` enum('present','absent','left','unknown') NOT NULL DEFAULT 'unknown',
	`accountedAt` bigint,
	`noteCiphertext` text,
	`verifiedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `emergencyRollCallEntries_id` PRIMARY KEY(`id`),
	CONSTRAINT `roll_call_person_uq` UNIQUE(`rollCallId`,`personType`,`placementId`,`visitorId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `emergencyRollCalls` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`shiftId` int,
	`reason` enum('fire','evacuation','missing','security','drill','other') NOT NULL,
	`initiatedAt` bigint NOT NULL,
	`completedAt` bigint,
	`status` enum('open','completed','cancelled') NOT NULL DEFAULT 'open',
	`notesCiphertext` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emergencyRollCalls_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `investigationActions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`investigationId` int NOT NULL,
	`workPlanActionId` int,
	`title` varchar(220) NOT NULL,
	`ownerUserId` int,
	`dueAt` bigint,
	`status` enum('open','in_progress','complete','cancelled') NOT NULL DEFAULT 'open',
	`completionNotesCiphertext` text,
	`completedAt` bigint,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `investigationActions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `investigations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int,
	`placementId` int,
	`concernId` int,
	`incidentId` int,
	`complaintId` int,
	`allegationId` int,
	`investigationType` enum('safeguarding','complaint','incident','staff_conduct','finance','medication','property','other') NOT NULL,
	`termsCiphertext` text NOT NULL,
	`leadUserId` int NOT NULL,
	`independentReviewerUserId` int,
	`openedAt` bigint NOT NULL,
	`dueAt` bigint,
	`outcomeCiphertext` text,
	`learningCiphertext` text,
	`status` enum('open','evidence_gathering','awaiting_response','review','action_plan','closed','cancelled') NOT NULL DEFAULT 'open',
	`closedAt` bigint,
	`version` int NOT NULL DEFAULT 1,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `investigations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `keyworkSessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`placementId` int NOT NULL,
	`shiftId` int,
	`goalId` int,
	`topic` varchar(220) NOT NULL,
	`occurredAt` bigint NOT NULL,
	`durationMinutes` int,
	`objectivesCiphertext` text,
	`discussionCiphertext` text NOT NULL,
	`youngPersonViewCiphertext` text,
	`outcomeCiphertext` text,
	`actions` json,
	`status` enum('draft','submitted','reviewed','returned','approved') NOT NULL DEFAULT 'draft',
	`reviewedBy` int,
	`reviewedAt` bigint,
	`reviewNotesCiphertext` text,
	`version` int NOT NULL DEFAULT 1,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `keyworkSessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `medicationDiscrepancies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`placementId` int NOT NULL,
	`medicationId` int NOT NULL,
	`administrationId` int,
	`stockTransactionId` int,
	`discrepancyType` enum('missing_stock','excess_stock','wrong_dose','wrong_time','wrong_person','recording_error','storage','expiry','other') NOT NULL,
	`expectedQuantity` decimal(10,3),
	`actualQuantity` decimal(10,3),
	`detailsCiphertext` text NOT NULL,
	`immediateActionsCiphertext` text NOT NULL,
	`status` enum('open','under_review','action_required','resolved','closed') NOT NULL DEFAULT 'open',
	`reviewedBy` int,
	`reviewedAt` bigint,
	`resolutionCiphertext` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `medicationDiscrepancies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `propertyPresenceEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`shiftId` int,
	`placementId` int,
	`visitorId` int,
	`userId` int,
	`personType` enum('young_person','visitor','staff','professional','contractor','other') NOT NULL,
	`eventType` enum('arrived','departed','expected','absent','located','verified') NOT NULL,
	`presenceState` enum('present','off_site','unknown') NOT NULL,
	`source` enum('manual','visitor_log','curfew','shift','incident','emergency_roll_call') NOT NULL DEFAULT 'manual',
	`occurredAt` bigint NOT NULL,
	`noteCiphertext` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `propertyPresenceEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recordLinks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`fromResourceType` varchar(80) NOT NULL,
	`fromResourceId` varchar(80) NOT NULL,
	`toResourceType` varchar(80) NOT NULL,
	`toResourceId` varchar(80) NOT NULL,
	`linkType` enum('source','supports','resulted_in','supersedes','related','follow_up') NOT NULL DEFAULT 'related',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `recordLinks_id` PRIMARY KEY(`id`),
	CONSTRAINT `record_link_uq` UNIQUE(`fromResourceType`,`fromResourceId`,`toResourceType`,`toResourceId`,`linkType`)
);
--> statement-breakpoint
CREATE TABLE `residentFinanceDiscrepancies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`placementId` int NOT NULL,
	`accountId` int NOT NULL,
	`transactionId` int,
	`reconciliationId` int,
	`discrepancyType` enum('cash_short','cash_over','missing_receipt','duplicate','unauthorised','calculation','other') NOT NULL,
	`amount` decimal(12,2),
	`detailsCiphertext` text NOT NULL,
	`immediateActionsCiphertext` text,
	`status` enum('open','under_review','action_required','resolved','closed') NOT NULL DEFAULT 'open',
	`reviewedBy` int,
	`reviewedAt` bigint,
	`resolutionCiphertext` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `residentFinanceDiscrepancies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `residentFinanceReconciliations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`placementId` int NOT NULL,
	`accountId` int NOT NULL,
	`periodStart` bigint NOT NULL,
	`periodEnd` bigint NOT NULL,
	`openingBalance` decimal(12,2) NOT NULL,
	`expectedClosingBalance` decimal(12,2) NOT NULL,
	`actualClosingBalance` decimal(12,2) NOT NULL,
	`difference` decimal(12,2) NOT NULL,
	`notesCiphertext` text,
	`status` enum('draft','submitted','balanced','discrepancy','approved','returned') NOT NULL DEFAULT 'draft',
	`reviewedBy` int,
	`reviewedAt` bigint,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `residentFinanceReconciliations_id` PRIMARY KEY(`id`),
	CONSTRAINT `resident_reconciliation_period_uq` UNIQUE(`accountId`,`periodStart`,`periodEnd`)
);
--> statement-breakpoint
CREATE TABLE `safeguardingConcerns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`placementId` int NOT NULL,
	`incidentId` int,
	`complaintId` int,
	`allegationId` int,
	`concernType` enum('disclosure','observation','exploitation','abuse','neglect','self_harm','online_safety','criminality','other') NOT NULL,
	`riskLevel` enum('low','medium','high','critical') NOT NULL,
	`summaryCiphertext` text NOT NULL,
	`immediateProtectionCiphertext` text NOT NULL,
	`youngPersonViewCiphertext` text,
	`status` enum('submitted','triage','referred','investigating','action_plan','closed') NOT NULL DEFAULT 'submitted',
	`restrictedOwnerUserId` int,
	`reviewDueAt` bigint,
	`closedAt` bigint,
	`version` int NOT NULL DEFAULT 1,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `safeguardingConcerns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shiftBreaks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`shiftId` int NOT NULL,
	`userId` int NOT NULL,
	`startedAt` bigint NOT NULL,
	`endedAt` bigint,
	`plannedMinutes` int,
	`actualMinutes` int,
	`status` enum('active','completed','missed','adjusted') NOT NULL DEFAULT 'active',
	`exceptionReasonCiphertext` text,
	`approvedBy` int,
	`approvedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `shiftBreaks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `supportGoals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`placementId` int NOT NULL,
	`carePlanId` int,
	`title` varchar(220) NOT NULL,
	`descriptionCiphertext` text,
	`outcomeArea` varchar(160),
	`targetAt` bigint,
	`progress` int NOT NULL DEFAULT 0,
	`status` enum('planned','active','achieved','paused','not_achieved','cancelled') NOT NULL DEFAULT 'planned',
	`youngPersonViewCiphertext` text,
	`reviewDueAt` bigint,
	`version` int NOT NULL DEFAULT 1,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `supportGoals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `medications` ADD `supportModel` enum('staff_administered','supported_self_administration','self_administration') DEFAULT 'staff_administered' NOT NULL;--> statement-breakpoint
ALTER TABLE `medications` ADD `selfAdministrationAssessmentCiphertext` text;--> statement-breakpoint
ALTER TABLE `medications` ADD `selfAdministrationReviewDueAt` bigint;--> statement-breakpoint
ALTER TABLE `medications` ADD `storageLocationCiphertext` text;--> statement-breakpoint
ALTER TABLE `dailyNotes` ADD CONSTRAINT `dailyNotes_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dailyNotes` ADD CONSTRAINT `dailyNotes_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dailyNotes` ADD CONSTRAINT `dailyNotes_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dailyNotes` ADD CONSTRAINT `dailyNotes_shiftId_shifts_id_fk` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dailyNotes` ADD CONSTRAINT `dailyNotes_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dailyNotes` ADD CONSTRAINT `dailyNotes_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `emergencyRollCallEntries` ADD CONSTRAINT `emergencyRollCallEntries_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `emergencyRollCallEntries` ADD CONSTRAINT `emergencyRollCallEntries_rollCallId_emergencyRollCalls_id_fk` FOREIGN KEY (`rollCallId`) REFERENCES `emergencyRollCalls`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `emergencyRollCallEntries` ADD CONSTRAINT `emergencyRollCallEntries_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `emergencyRollCallEntries` ADD CONSTRAINT `emergencyRollCallEntries_visitorId_propertyVisitors_id_fk` FOREIGN KEY (`visitorId`) REFERENCES `propertyVisitors`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `emergencyRollCallEntries` ADD CONSTRAINT `emergencyRollCallEntries_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `emergencyRollCallEntries` ADD CONSTRAINT `emergencyRollCallEntries_verifiedBy_users_id_fk` FOREIGN KEY (`verifiedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `emergencyRollCalls` ADD CONSTRAINT `emergencyRollCalls_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `emergencyRollCalls` ADD CONSTRAINT `emergencyRollCalls_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `emergencyRollCalls` ADD CONSTRAINT `emergencyRollCalls_shiftId_shifts_id_fk` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `emergencyRollCalls` ADD CONSTRAINT `emergencyRollCalls_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `investigationActions` ADD CONSTRAINT `investigationActions_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `investigationActions` ADD CONSTRAINT `investigationActions_investigationId_investigations_id_fk` FOREIGN KEY (`investigationId`) REFERENCES `investigations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `investigationActions` ADD CONSTRAINT `investigationActions_workPlanActionId_workPlanActions_id_fk` FOREIGN KEY (`workPlanActionId`) REFERENCES `workPlanActions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `investigationActions` ADD CONSTRAINT `investigationActions_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `investigationActions` ADD CONSTRAINT `investigationActions_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `investigations` ADD CONSTRAINT `investigations_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `investigations` ADD CONSTRAINT `investigations_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `investigations` ADD CONSTRAINT `investigations_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `investigations` ADD CONSTRAINT `investigations_concernId_safeguardingConcerns_id_fk` FOREIGN KEY (`concernId`) REFERENCES `safeguardingConcerns`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `investigations` ADD CONSTRAINT `investigations_incidentId_incidents_id_fk` FOREIGN KEY (`incidentId`) REFERENCES `incidents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `investigations` ADD CONSTRAINT `investigations_complaintId_complaints_id_fk` FOREIGN KEY (`complaintId`) REFERENCES `complaints`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `investigations` ADD CONSTRAINT `investigations_allegationId_allegations_id_fk` FOREIGN KEY (`allegationId`) REFERENCES `allegations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `investigations` ADD CONSTRAINT `investigations_leadUserId_users_id_fk` FOREIGN KEY (`leadUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `investigations` ADD CONSTRAINT `investigations_independentReviewerUserId_users_id_fk` FOREIGN KEY (`independentReviewerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `investigations` ADD CONSTRAINT `investigations_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyworkSessions` ADD CONSTRAINT `keyworkSessions_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyworkSessions` ADD CONSTRAINT `keyworkSessions_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyworkSessions` ADD CONSTRAINT `keyworkSessions_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyworkSessions` ADD CONSTRAINT `keyworkSessions_shiftId_shifts_id_fk` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyworkSessions` ADD CONSTRAINT `keyworkSessions_goalId_supportGoals_id_fk` FOREIGN KEY (`goalId`) REFERENCES `supportGoals`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyworkSessions` ADD CONSTRAINT `keyworkSessions_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyworkSessions` ADD CONSTRAINT `keyworkSessions_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationDiscrepancies` ADD CONSTRAINT `medicationDiscrepancies_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationDiscrepancies` ADD CONSTRAINT `medicationDiscrepancies_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationDiscrepancies` ADD CONSTRAINT `medicationDiscrepancies_medicationId_medications_id_fk` FOREIGN KEY (`medicationId`) REFERENCES `medications`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationDiscrepancies` ADD CONSTRAINT `medicationDiscrepancies_administrationId_medicationAdministrations_id_fk` FOREIGN KEY (`administrationId`) REFERENCES `medicationAdministrations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationDiscrepancies` ADD CONSTRAINT `medicationDiscrepancies_stockTransactionId_medicationStockTransactions_id_fk` FOREIGN KEY (`stockTransactionId`) REFERENCES `medicationStockTransactions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationDiscrepancies` ADD CONSTRAINT `medicationDiscrepancies_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationDiscrepancies` ADD CONSTRAINT `medicationDiscrepancies_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyPresenceEvents` ADD CONSTRAINT `propertyPresenceEvents_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyPresenceEvents` ADD CONSTRAINT `propertyPresenceEvents_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyPresenceEvents` ADD CONSTRAINT `propertyPresenceEvents_shiftId_shifts_id_fk` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyPresenceEvents` ADD CONSTRAINT `propertyPresenceEvents_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyPresenceEvents` ADD CONSTRAINT `propertyPresenceEvents_visitorId_propertyVisitors_id_fk` FOREIGN KEY (`visitorId`) REFERENCES `propertyVisitors`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyPresenceEvents` ADD CONSTRAINT `propertyPresenceEvents_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyPresenceEvents` ADD CONSTRAINT `propertyPresenceEvents_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recordLinks` ADD CONSTRAINT `recordLinks_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recordLinks` ADD CONSTRAINT `recordLinks_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceDiscrepancies` ADD CONSTRAINT `residentFinanceDiscrepancies_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceDiscrepancies` ADD CONSTRAINT `residentFinanceDiscrepancies_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceDiscrepancies` ADD CONSTRAINT `residentFinanceDiscrepancies_accountId_residentFinanceAccounts_id_fk` FOREIGN KEY (`accountId`) REFERENCES `residentFinanceAccounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceDiscrepancies` ADD CONSTRAINT `residentFinanceDiscrepancies_transactionId_residentFinanceTransactions_id_fk` FOREIGN KEY (`transactionId`) REFERENCES `residentFinanceTransactions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceDiscrepancies` ADD CONSTRAINT `residentFinanceDiscrepancies_reconciliationId_residentFinanceReconciliations_id_fk` FOREIGN KEY (`reconciliationId`) REFERENCES `residentFinanceReconciliations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceDiscrepancies` ADD CONSTRAINT `residentFinanceDiscrepancies_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceDiscrepancies` ADD CONSTRAINT `residentFinanceDiscrepancies_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceReconciliations` ADD CONSTRAINT `residentFinanceReconciliations_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceReconciliations` ADD CONSTRAINT `residentFinanceReconciliations_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceReconciliations` ADD CONSTRAINT `residentFinanceReconciliations_accountId_residentFinanceAccounts_id_fk` FOREIGN KEY (`accountId`) REFERENCES `residentFinanceAccounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceReconciliations` ADD CONSTRAINT `residentFinanceReconciliations_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceReconciliations` ADD CONSTRAINT `residentFinanceReconciliations_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `safeguardingConcerns` ADD CONSTRAINT `safeguardingConcerns_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `safeguardingConcerns` ADD CONSTRAINT `safeguardingConcerns_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `safeguardingConcerns` ADD CONSTRAINT `safeguardingConcerns_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `safeguardingConcerns` ADD CONSTRAINT `safeguardingConcerns_incidentId_incidents_id_fk` FOREIGN KEY (`incidentId`) REFERENCES `incidents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `safeguardingConcerns` ADD CONSTRAINT `safeguardingConcerns_complaintId_complaints_id_fk` FOREIGN KEY (`complaintId`) REFERENCES `complaints`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `safeguardingConcerns` ADD CONSTRAINT `safeguardingConcerns_allegationId_allegations_id_fk` FOREIGN KEY (`allegationId`) REFERENCES `allegations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `safeguardingConcerns` ADD CONSTRAINT `safeguardingConcerns_restrictedOwnerUserId_users_id_fk` FOREIGN KEY (`restrictedOwnerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `safeguardingConcerns` ADD CONSTRAINT `safeguardingConcerns_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftBreaks` ADD CONSTRAINT `shiftBreaks_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftBreaks` ADD CONSTRAINT `shiftBreaks_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftBreaks` ADD CONSTRAINT `shiftBreaks_shiftId_shifts_id_fk` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftBreaks` ADD CONSTRAINT `shiftBreaks_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftBreaks` ADD CONSTRAINT `shiftBreaks_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supportGoals` ADD CONSTRAINT `supportGoals_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supportGoals` ADD CONSTRAINT `supportGoals_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supportGoals` ADD CONSTRAINT `supportGoals_carePlanId_carePlans_id_fk` FOREIGN KEY (`carePlanId`) REFERENCES `carePlans`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supportGoals` ADD CONSTRAINT `supportGoals_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `daily_note_placement_idx` ON `dailyNotes` (`placementId`,`observedAt`,`status`);--> statement-breakpoint
CREATE INDEX `roll_call_entry_idx` ON `emergencyRollCallEntries` (`rollCallId`,`accountedState`);--> statement-breakpoint
CREATE INDEX `emergency_roll_call_idx` ON `emergencyRollCalls` (`propertyId`,`status`,`initiatedAt`);--> statement-breakpoint
CREATE INDEX `investigation_action_idx` ON `investigationActions` (`investigationId`,`status`,`dueAt`);--> statement-breakpoint
CREATE INDEX `investigation_queue_idx` ON `investigations` (`entityId`,`status`,`dueAt`);--> statement-breakpoint
CREATE INDEX `keywork_session_placement_idx` ON `keyworkSessions` (`placementId`,`occurredAt`,`status`);--> statement-breakpoint
CREATE INDEX `medication_discrepancy_idx` ON `medicationDiscrepancies` (`entityId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `property_presence_idx` ON `propertyPresenceEvents` (`propertyId`,`occurredAt`,`personType`);--> statement-breakpoint
CREATE INDEX `record_link_target_idx` ON `recordLinks` (`toResourceType`,`toResourceId`);--> statement-breakpoint
CREATE INDEX `resident_finance_discrepancy_idx` ON `residentFinanceDiscrepancies` (`entityId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `resident_reconciliation_idx` ON `residentFinanceReconciliations` (`entityId`,`status`,`periodEnd`);--> statement-breakpoint
CREATE INDEX `safeguarding_concern_queue_idx` ON `safeguardingConcerns` (`entityId`,`status`,`riskLevel`,`reviewDueAt`);--> statement-breakpoint
CREATE INDEX `shift_break_user_idx` ON `shiftBreaks` (`shiftId`,`userId`,`startedAt`);--> statement-breakpoint
CREATE INDEX `support_goal_placement_idx` ON `supportGoals` (`placementId`,`status`,`reviewDueAt`);