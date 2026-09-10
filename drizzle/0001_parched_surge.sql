CREATE TABLE `auditLogs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`occurredAt` bigint NOT NULL,
	`actorUserId` int,
	`actorType` enum('user','scheduled_job','system','secure_link') NOT NULL DEFAULT 'user',
	`entityId` int,
	`propertyId` int,
	`action` varchar(100) NOT NULL,
	`resourceType` varchar(80) NOT NULL,
	`resourceId` varchar(80),
	`sensitivity` enum('general','hr','finance','safeguarding','bank','restricted') NOT NULL DEFAULT 'general',
	`result` enum('allowed','denied','success','failure') NOT NULL,
	`reasonCode` varchar(120),
	`correlationId` varchar(80),
	`metadata` json,
	`previousHash` varchar(128),
	`eventHash` varchar(128),
	CONSTRAINT `auditLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `automationRules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int,
	`name` varchar(180) NOT NULL,
	`ruleType` enum('compliance','review','work_plan','policy','placement','invoice') NOT NULL,
	`configuration` json NOT NULL,
	`scheduleCronTaskUid` varchar(65),
	`enabled` int NOT NULL DEFAULT 1,
	`lastRunAt` bigint,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `automationRules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `carePlans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`placementId` int NOT NULL,
	`planType` enum('support','pathway','risk','safety','placement','transition') NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`status` enum('draft','in_review','approved','superseded') NOT NULL DEFAULT 'draft',
	`summary` text,
	`content` json,
	`reviewDueAt` bigint,
	`approvedAt` bigint,
	`approvedBy` int,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `carePlans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `clockEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`shiftId` int,
	`userId` int NOT NULL,
	`eventType` enum('clock_in','clock_out','adjustment') NOT NULL,
	`occurredAt` bigint NOT NULL,
	`latitude` decimal(10,7),
	`longitude` decimal(10,7),
	`accuracyMetres` decimal(10,2),
	`distanceMetres` decimal(10,2),
	`locationState` enum('on_site','off_site','unavailable','manual') NOT NULL,
	`overrideReason` text,
	`approvedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `clockEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `complianceObligations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int,
	`staffProfileId` int,
	`placementId` int,
	`category` enum('property','workforce','placement','policy','quality','finance','data_protection') NOT NULL,
	`requirementKey` varchar(120) NOT NULL,
	`title` varchar(220) NOT NULL,
	`basis` varchar(220),
	`ownerUserId` int,
	`ownerRole` varchar(80),
	`dueAt` bigint NOT NULL,
	`leadDays` int NOT NULL DEFAULT 30,
	`recurrence` varchar(80),
	`status` enum('not_due','due_soon','overdue','complete','not_applicable','exception') NOT NULL DEFAULT 'not_due',
	`ragStatus` enum('green','amber','red','grey') NOT NULL DEFAULT 'grey',
	`completedAt` bigint,
	`evidenceDocumentId` int,
	`exceptionReason` text,
	`sourceType` varchar(80),
	`sourceId` int,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `complianceObligations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `documentVersions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`documentId` int NOT NULL,
	`version` int NOT NULL,
	`fileKey` varchar(500),
	`fileUrl` text,
	`fileName` varchar(300),
	`mimeType` varchar(160),
	`sizeBytes` bigint,
	`contentHash` varchar(128),
	`changeSummary` text,
	`approvedAt` bigint,
	`approvedBy` int,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `documentVersions_id` PRIMARY KEY(`id`),
	CONSTRAINT `document_version_uq` UNIQUE(`documentId`,`version`)
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int,
	`title` varchar(240) NOT NULL,
	`documentType` enum('policy','template','certificate','contract','plan','evidence','generated','other') NOT NULL,
	`classification` enum('general','hr','finance','safeguarding','bank','restricted') NOT NULL DEFAULT 'general',
	`status` enum('draft','in_review','approved','superseded','archived') NOT NULL DEFAULT 'draft',
	`currentVersion` int NOT NULL DEFAULT 1,
	`reviewDueAt` bigint,
	`retentionUntil` bigint,
	`retentionBasis` varchar(220),
	`legalHold` int NOT NULL DEFAULT 0,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `entities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(160) NOT NULL,
	`legalName` varchar(220) NOT NULL,
	`companyNumber` varchar(32),
	`ofstedUrn` varchar(64),
	`vatNumber` varchar(32),
	`phone` varchar(40),
	`email` varchar(320),
	`addressLine1` varchar(180),
	`addressLine2` varchar(180),
	`city` varchar(120),
	`postcode` varchar(16),
	`invoicePrefix` varchar(12) NOT NULL DEFAULT 'INV',
	`nextInvoiceNumber` int NOT NULL DEFAULT 1,
	`defaultVatRate` decimal(5,2) NOT NULL DEFAULT '0.00',
	`bankAccountName` varchar(180),
	`bankSortCodeCiphertext` text,
	`bankAccountNumberCiphertext` text,
	`bankDetailsUpdatedAt` bigint,
	`bankDetailsUpdatedBy` int,
	`status` enum('draft','active','inactive') NOT NULL DEFAULT 'draft',
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `entities_id` PRIMARY KEY(`id`),
	CONSTRAINT `entities_legal_name_uq` UNIQUE(`legalName`)
);
--> statement-breakpoint
CREATE TABLE `entityMemberships` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`userId` int NOT NULL,
	`operationalRole` enum('owner','registered_manager','support_worker','hr_compliance','finance','read_only') NOT NULL,
	`allProperties` int NOT NULL DEFAULT 0,
	`extraCapabilities` json,
	`status` enum('active','suspended','ended') NOT NULL DEFAULT 'active',
	`startsAt` bigint,
	`endsAt` bigint,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `entityMemberships_id` PRIMARY KEY(`id`),
	CONSTRAINT `entity_membership_uq` UNIQUE(`entityId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `feeSchedules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`localAuthorityId` int,
	`propertyId` int,
	`name` varchar(180) NOT NULL,
	`billingUnit` enum('daily','weekly','four_week','monthly','fixed') NOT NULL DEFAULT 'four_week',
	`rate` decimal(12,2) NOT NULL,
	`vatRate` decimal(5,2) NOT NULL DEFAULT '0.00',
	`vatTreatment` enum('standard','reduced','zero','exempt','outside_scope') NOT NULL DEFAULT 'exempt',
	`effectiveFrom` bigint NOT NULL,
	`effectiveTo` bigint,
	`status` enum('draft','active','expired') NOT NULL DEFAULT 'draft',
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `feeSchedules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `handovers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`shiftId` int,
	`summary` text NOT NULL,
	`risks` text,
	`outstandingActions` text,
	`sensitivity` enum('operational','safeguarding','restricted') NOT NULL DEFAULT 'operational',
	`acknowledgedAt` bigint,
	`acknowledgedBy` int,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `handovers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`placementId` int,
	`category` enum('safeguarding','missing','exploitation','police','abuse_allegation','child_protection_enquiry','restraint','health_safety','complaint','other') NOT NULL,
	`severity` enum('low','medium','high','critical') NOT NULL DEFAULT 'medium',
	`occurredAt` bigint NOT NULL,
	`summary` varchar(240) NOT NULL,
	`details` text NOT NULL,
	`immediateActions` text,
	`notifiability` enum('unreviewed','not_notifiable','regulation_27','other_notification') NOT NULL DEFAULT 'unreviewed',
	`notificationDueAt` bigint,
	`notificationSubmittedAt` bigint,
	`notificationRecipients` json,
	`learning` text,
	`status` enum('open','under_review','notified','follow_up','closed') NOT NULL DEFAULT 'open',
	`managerUserId` int,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `incidents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoiceLines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoiceId` int NOT NULL,
	`feeScheduleId` int,
	`description` varchar(300) NOT NULL,
	`quantity` decimal(10,3) NOT NULL DEFAULT '1.000',
	`unitPrice` decimal(12,2) NOT NULL,
	`vatRate` decimal(5,2) NOT NULL DEFAULT '0.00',
	`netAmount` decimal(12,2) NOT NULL,
	`vatAmount` decimal(12,2) NOT NULL,
	`grossAmount` decimal(12,2) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invoiceLines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`localAuthorityId` int NOT NULL,
	`placementId` int,
	`invoiceNumber` varchar(64),
	`invoiceDate` bigint NOT NULL,
	`supplyDate` bigint,
	`periodStart` bigint NOT NULL,
	`periodEnd` bigint NOT NULL,
	`dueAt` bigint,
	`purchaseOrderNumber` varchar(100),
	`youngPersonReferenceSnapshot` varchar(64),
	`customerNameSnapshot` varchar(220),
	`customerAddressSnapshot` text,
	`supplierSnapshot` json,
	`bankDetailsSnapshotCiphertext` text,
	`subtotal` decimal(12,2) NOT NULL DEFAULT '0.00',
	`vatTotal` decimal(12,2) NOT NULL DEFAULT '0.00',
	`total` decimal(12,2) NOT NULL DEFAULT '0.00',
	`amountPaid` decimal(12,2) NOT NULL DEFAULT '0.00',
	`status` enum('draft','pending_approval','issued','sent','part_paid','paid','overdue','disputed','void','credited') NOT NULL DEFAULT 'draft',
	`issuedAt` bigint,
	`issuedBy` int,
	`notes` text,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoice_number_uq` UNIQUE(`entityId`,`invoiceNumber`)
);
--> statement-breakpoint
CREATE TABLE `keyWorkerReports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`placementId` int NOT NULL,
	`authorUserId` int NOT NULL,
	`reportType` enum('daily','weekly','monthly_review') NOT NULL,
	`reportDate` bigint NOT NULL,
	`mood` varchar(80),
	`attitude` varchar(120),
	`discussions` text,
	`pointsToNote` text,
	`plan` text,
	`nextReviewAt` bigint,
	`suggestions` text,
	`status` enum('draft','submitted','reviewed','returned') NOT NULL DEFAULT 'draft',
	`reviewedBy` int,
	`reviewedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `keyWorkerReports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `localAuthorities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`name` varchar(220) NOT NULL,
	`addressLine1` varchar(180),
	`addressLine2` varchar(180),
	`city` varchar(120),
	`postcode` varchar(16),
	`financeEmail` varchar(320),
	`placementEmail` varchar(320),
	`paymentTermsDays` int NOT NULL DEFAULT 30,
	`defaultPurchaseOrderRequired` int NOT NULL DEFAULT 0,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `localAuthorities_id` PRIMARY KEY(`id`),
	CONSTRAINT `authority_entity_name_uq` UNIQUE(`entityId`,`name`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int,
	`userId` int NOT NULL,
	`type` varchar(100) NOT NULL,
	`title` varchar(220) NOT NULL,
	`message` text NOT NULL,
	`severity` enum('info','warning','urgent') NOT NULL DEFAULT 'info',
	`resourceType` varchar(80),
	`resourceId` int,
	`dueAt` bigint,
	`readAt` bigint,
	`resolvedAt` bigint,
	`dedupeKey` varchar(240),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `notification_dedupe_uq` UNIQUE(`userId`,`dedupeKey`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`invoiceId` int NOT NULL,
	`receivedAt` bigint NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`reference` varchar(160),
	`notes` text,
	`recordedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `placements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`youngPersonId` int NOT NULL,
	`propertyId` int,
	`localAuthorityId` int,
	`status` enum('referred','assessment','matched','accepted','active','notice','ended','declined') NOT NULL DEFAULT 'referred',
	`placementBasis` enum('section_22c_6_d','section_23b_8_b','other'),
	`careOrderStatus` enum('none','care_order','supervision_order','interim_care_order','unknown') NOT NULL DEFAULT 'unknown',
	`referralReceivedAt` bigint,
	`startAt` bigint,
	`expectedEndAt` bigint,
	`endedAt` bigint,
	`reviewDueAt` bigint,
	`purchaseOrderNumber` varchar(100),
	`hasEhcPlan` int NOT NULL DEFAULT 0,
	`iroName` varchar(180),
	`iroEmail` varchar(320),
	`personalAdviserName` varchar(180),
	`personalAdviserEmail` varchar(320),
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `placements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `policyAcknowledgements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`documentId` int NOT NULL,
	`documentVersion` int NOT NULL,
	`userId` int NOT NULL,
	`dueAt` bigint,
	`acknowledgedAt` bigint,
	`status` enum('pending','acknowledged','overdue','exempt') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `policyAcknowledgements_id` PRIMARY KEY(`id`),
	CONSTRAINT `policy_ack_uq` UNIQUE(`documentId`,`documentVersion`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `properties` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`addressLine1` varchar(180) NOT NULL,
	`addressLine2` varchar(180),
	`city` varchar(120) NOT NULL,
	`postcode` varchar(16) NOT NULL,
	`accommodationType` enum('single_occupancy','ring_fenced_shared','non_ring_fenced_shared','supported_lodgings','other') NOT NULL DEFAULT 'single_occupancy',
	`ofstedSettingReference` varchar(80),
	`capacity` int NOT NULL DEFAULT 1,
	`occupiedBeds` int NOT NULL DEFAULT 0,
	`minimumStaffing` int NOT NULL DEFAULT 1,
	`latitude` decimal(10,7),
	`longitude` decimal(10,7),
	`geofenceRadiusMetres` int NOT NULL DEFAULT 150,
	`managerUserId` int,
	`status` enum('onboarding','active','paused','closed') NOT NULL DEFAULT 'onboarding',
	`lastLocationAssessmentAt` bigint,
	`nextLocationAssessmentDueAt` bigint,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `properties_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `propertyAssignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`userId` int NOT NULL,
	`assignmentType` enum('manager','worker','finance','compliance','viewer') NOT NULL,
	`startsAt` bigint,
	`endsAt` bigint,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `propertyAssignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `property_assignment_uq` UNIQUE(`propertyId`,`userId`,`assignmentType`)
);
--> statement-breakpoint
CREATE TABLE `providerPacks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int,
	`localAuthorityId` int,
	`title` varchar(240) NOT NULL,
	`status` enum('draft','ready','shared','expired','archived') NOT NULL DEFAULT 'draft',
	`includeBankDetails` int NOT NULL DEFAULT 0,
	`snapshot` json,
	`documentId` int,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `providerPacks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `savedViews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`entityId` int,
	`name` varchar(140) NOT NULL,
	`viewType` varchar(80) NOT NULL,
	`filters` json NOT NULL,
	`isDefault` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `savedViews_id` PRIMARY KEY(`id`),
	CONSTRAINT `saved_view_name_uq` UNIQUE(`userId`,`viewType`,`name`)
);
--> statement-breakpoint
CREATE TABLE `secureLinks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`providerPackId` int,
	`documentId` int,
	`tokenHash` varchar(128) NOT NULL,
	`recipientEmail` varchar(320),
	`expiresAt` bigint NOT NULL,
	`maxViews` int,
	`viewCount` int NOT NULL DEFAULT 0,
	`revokedAt` bigint,
	`lastViewedAt` bigint,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `secureLinks_id` PRIMARY KEY(`id`),
	CONSTRAINT `secure_link_token_uq` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`assignedUserId` int,
	`title` varchar(140) NOT NULL DEFAULT 'Support shift',
	`startsAt` bigint NOT NULL,
	`endsAt` bigint NOT NULL,
	`requiredRole` varchar(120),
	`status` enum('draft','open','assigned','confirmed','in_progress','completed','cancelled') NOT NULL DEFAULT 'draft',
	`coverageState` enum('covered','at_risk','uncovered') NOT NULL DEFAULT 'uncovered',
	`notes` text,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `shifts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `staffProfiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`userId` int,
	`employeeNumber` varchar(40),
	`fullName` varchar(180) NOT NULL,
	`email` varchar(320),
	`phone` varchar(40),
	`jobTitle` varchar(160) NOT NULL,
	`employmentType` enum('permanent','fixed_term','casual','agency','volunteer') NOT NULL DEFAULT 'permanent',
	`startDate` bigint,
	`endDate` bigint,
	`managerUserId` int,
	`status` enum('onboarding','active','leave','ended') NOT NULL DEFAULT 'onboarding',
	`emergencyContactName` varchar(180),
	`emergencyContactPhone` varchar(40),
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `staffProfiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `staff_entity_number_uq` UNIQUE(`entityId`,`employeeNumber`)
);
--> statement-breakpoint
CREATE TABLE `workPlanActions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int,
	`placementId` int,
	`title` varchar(220) NOT NULL,
	`description` text,
	`sourceType` varchar(80),
	`sourceId` int,
	`ownerUserId` int,
	`priority` enum('low','normal','high','critical') NOT NULL DEFAULT 'normal',
	`dueAt` bigint NOT NULL,
	`status` enum('open','in_progress','blocked','ready_for_review','complete','cancelled') NOT NULL DEFAULT 'open',
	`progressPercent` int NOT NULL DEFAULT 0,
	`completionNotes` text,
	`completedAt` bigint,
	`completedBy` int,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workPlanActions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `workerAssignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`placementId` int NOT NULL,
	`userId` int NOT NULL,
	`assignmentRole` enum('key_worker','co_worker','manager','oversight') NOT NULL,
	`startsAt` bigint,
	`endsAt` bigint,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workerAssignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `worker_assignment_uq` UNIQUE(`placementId`,`userId`,`assignmentRole`)
);
--> statement-breakpoint
CREATE TABLE `workforceChecks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`staffProfileId` int NOT NULL,
	`checkType` enum('identity','dbs','right_to_work','reference','employment_gap','qualification','training','induction','probation','supervision','appraisal','policy_acknowledgement') NOT NULL,
	`title` varchar(200) NOT NULL,
	`reference` varchar(160),
	`level` varchar(120),
	`issuedAt` bigint,
	`expiresAt` bigint,
	`verifiedAt` bigint,
	`verifiedBy` int,
	`status` enum('missing','pending','valid','expiring','expired','rejected','not_applicable') NOT NULL DEFAULT 'pending',
	`evidenceDocumentId` int,
	`notes` text,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workforceChecks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `youngPeople` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`reference` varchar(64) NOT NULL,
	`preferredName` varchar(120),
	`dateOfBirth` bigint,
	`pronouns` varchar(80),
	`status` enum('referral','matching','placed','transitioning','closed') NOT NULL DEFAULT 'referral',
	`privacyNoticeVersion` varchar(40),
	`privacyNoticeAcknowledgedAt` bigint,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `youngPeople_id` PRIMARY KEY(`id`),
	CONSTRAINT `young_person_reference_uq` UNIQUE(`entityId`,`reference`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `operationalRole` enum('platform_admin','owner','registered_manager','support_worker','hr_compliance','finance','read_only') DEFAULT 'support_worker' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `accountStatus` enum('invited','active','suspended') DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `auditLogs` ADD CONSTRAINT `auditLogs_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `auditLogs` ADD CONSTRAINT `auditLogs_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `auditLogs` ADD CONSTRAINT `auditLogs_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `automationRules` ADD CONSTRAINT `automationRules_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `automationRules` ADD CONSTRAINT `automationRules_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `carePlans` ADD CONSTRAINT `carePlans_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `carePlans` ADD CONSTRAINT `carePlans_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `carePlans` ADD CONSTRAINT `carePlans_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `carePlans` ADD CONSTRAINT `carePlans_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `clockEvents` ADD CONSTRAINT `clockEvents_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `clockEvents` ADD CONSTRAINT `clockEvents_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `clockEvents` ADD CONSTRAINT `clockEvents_shiftId_shifts_id_fk` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `clockEvents` ADD CONSTRAINT `clockEvents_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `clockEvents` ADD CONSTRAINT `clockEvents_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `complianceObligations` ADD CONSTRAINT `complianceObligations_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `complianceObligations` ADD CONSTRAINT `complianceObligations_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `complianceObligations` ADD CONSTRAINT `complianceObligations_staffProfileId_staffProfiles_id_fk` FOREIGN KEY (`staffProfileId`) REFERENCES `staffProfiles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `complianceObligations` ADD CONSTRAINT `complianceObligations_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `complianceObligations` ADD CONSTRAINT `complianceObligations_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `complianceObligations` ADD CONSTRAINT `complianceObligations_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documentVersions` ADD CONSTRAINT `documentVersions_documentId_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documentVersions` ADD CONSTRAINT `documentVersions_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documentVersions` ADD CONSTRAINT `documentVersions_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entities` ADD CONSTRAINT `entities_bankDetailsUpdatedBy_users_id_fk` FOREIGN KEY (`bankDetailsUpdatedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entities` ADD CONSTRAINT `entities_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entityMemberships` ADD CONSTRAINT `entityMemberships_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entityMemberships` ADD CONSTRAINT `entityMemberships_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entityMemberships` ADD CONSTRAINT `entityMemberships_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `feeSchedules` ADD CONSTRAINT `feeSchedules_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `feeSchedules` ADD CONSTRAINT `feeSchedules_localAuthorityId_localAuthorities_id_fk` FOREIGN KEY (`localAuthorityId`) REFERENCES `localAuthorities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `feeSchedules` ADD CONSTRAINT `feeSchedules_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `feeSchedules` ADD CONSTRAINT `feeSchedules_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `handovers` ADD CONSTRAINT `handovers_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `handovers` ADD CONSTRAINT `handovers_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `handovers` ADD CONSTRAINT `handovers_shiftId_shifts_id_fk` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `handovers` ADD CONSTRAINT `handovers_acknowledgedBy_users_id_fk` FOREIGN KEY (`acknowledgedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `handovers` ADD CONSTRAINT `handovers_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_managerUserId_users_id_fk` FOREIGN KEY (`managerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoiceLines` ADD CONSTRAINT `invoiceLines_invoiceId_invoices_id_fk` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoiceLines` ADD CONSTRAINT `invoiceLines_feeScheduleId_feeSchedules_id_fk` FOREIGN KEY (`feeScheduleId`) REFERENCES `feeSchedules`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_localAuthorityId_localAuthorities_id_fk` FOREIGN KEY (`localAuthorityId`) REFERENCES `localAuthorities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_issuedBy_users_id_fk` FOREIGN KEY (`issuedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyWorkerReports` ADD CONSTRAINT `keyWorkerReports_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyWorkerReports` ADD CONSTRAINT `keyWorkerReports_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyWorkerReports` ADD CONSTRAINT `keyWorkerReports_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyWorkerReports` ADD CONSTRAINT `keyWorkerReports_authorUserId_users_id_fk` FOREIGN KEY (`authorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyWorkerReports` ADD CONSTRAINT `keyWorkerReports_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `localAuthorities` ADD CONSTRAINT `localAuthorities_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `localAuthorities` ADD CONSTRAINT `localAuthorities_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_invoiceId_invoices_id_fk` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_recordedBy_users_id_fk` FOREIGN KEY (`recordedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placements` ADD CONSTRAINT `placements_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placements` ADD CONSTRAINT `placements_youngPersonId_youngPeople_id_fk` FOREIGN KEY (`youngPersonId`) REFERENCES `youngPeople`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placements` ADD CONSTRAINT `placements_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placements` ADD CONSTRAINT `placements_localAuthorityId_localAuthorities_id_fk` FOREIGN KEY (`localAuthorityId`) REFERENCES `localAuthorities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placements` ADD CONSTRAINT `placements_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `policyAcknowledgements` ADD CONSTRAINT `policyAcknowledgements_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `policyAcknowledgements` ADD CONSTRAINT `policyAcknowledgements_documentId_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `policyAcknowledgements` ADD CONSTRAINT `policyAcknowledgements_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `properties` ADD CONSTRAINT `properties_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `properties` ADD CONSTRAINT `properties_managerUserId_users_id_fk` FOREIGN KEY (`managerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `properties` ADD CONSTRAINT `properties_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyAssignments` ADD CONSTRAINT `propertyAssignments_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyAssignments` ADD CONSTRAINT `propertyAssignments_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyAssignments` ADD CONSTRAINT `propertyAssignments_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyAssignments` ADD CONSTRAINT `propertyAssignments_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `providerPacks` ADD CONSTRAINT `providerPacks_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `providerPacks` ADD CONSTRAINT `providerPacks_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `providerPacks` ADD CONSTRAINT `providerPacks_localAuthorityId_localAuthorities_id_fk` FOREIGN KEY (`localAuthorityId`) REFERENCES `localAuthorities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `providerPacks` ADD CONSTRAINT `providerPacks_documentId_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `providerPacks` ADD CONSTRAINT `providerPacks_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `savedViews` ADD CONSTRAINT `savedViews_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `savedViews` ADD CONSTRAINT `savedViews_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `secureLinks` ADD CONSTRAINT `secureLinks_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `secureLinks` ADD CONSTRAINT `secureLinks_providerPackId_providerPacks_id_fk` FOREIGN KEY (`providerPackId`) REFERENCES `providerPacks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `secureLinks` ADD CONSTRAINT `secureLinks_documentId_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `secureLinks` ADD CONSTRAINT `secureLinks_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_assignedUserId_users_id_fk` FOREIGN KEY (`assignedUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staffProfiles` ADD CONSTRAINT `staffProfiles_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staffProfiles` ADD CONSTRAINT `staffProfiles_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staffProfiles` ADD CONSTRAINT `staffProfiles_managerUserId_users_id_fk` FOREIGN KEY (`managerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staffProfiles` ADD CONSTRAINT `staffProfiles_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workPlanActions` ADD CONSTRAINT `workPlanActions_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workPlanActions` ADD CONSTRAINT `workPlanActions_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workPlanActions` ADD CONSTRAINT `workPlanActions_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workPlanActions` ADD CONSTRAINT `workPlanActions_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workPlanActions` ADD CONSTRAINT `workPlanActions_completedBy_users_id_fk` FOREIGN KEY (`completedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workPlanActions` ADD CONSTRAINT `workPlanActions_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workerAssignments` ADD CONSTRAINT `workerAssignments_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workerAssignments` ADD CONSTRAINT `workerAssignments_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workerAssignments` ADD CONSTRAINT `workerAssignments_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workerAssignments` ADD CONSTRAINT `workerAssignments_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workforceChecks` ADD CONSTRAINT `workforceChecks_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workforceChecks` ADD CONSTRAINT `workforceChecks_staffProfileId_staffProfiles_id_fk` FOREIGN KEY (`staffProfileId`) REFERENCES `staffProfiles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workforceChecks` ADD CONSTRAINT `workforceChecks_verifiedBy_users_id_fk` FOREIGN KEY (`verifiedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workforceChecks` ADD CONSTRAINT `workforceChecks_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `youngPeople` ADD CONSTRAINT `youngPeople_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `youngPeople` ADD CONSTRAINT `youngPeople_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_resource_idx` ON `auditLogs` (`resourceType`,`resourceId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `audit_actor_idx` ON `auditLogs` (`actorUserId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `automation_task_uid_idx` ON `automationRules` (`scheduleCronTaskUid`);--> statement-breakpoint
CREATE INDEX `care_plan_review_idx` ON `carePlans` (`entityId`,`reviewDueAt`,`status`);--> statement-breakpoint
CREATE INDEX `clock_user_time_idx` ON `clockEvents` (`userId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `compliance_due_idx` ON `complianceObligations` (`entityId`,`dueAt`,`status`);--> statement-breakpoint
CREATE INDEX `documents_entity_status_idx` ON `documents` (`entityId`,`status`,`documentType`);--> statement-breakpoint
CREATE INDEX `entities_status_idx` ON `entities` (`status`);--> statement-breakpoint
CREATE INDEX `entity_membership_user_idx` ON `entityMemberships` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `fee_schedule_effective_idx` ON `feeSchedules` (`entityId`,`effectiveFrom`,`status`);--> statement-breakpoint
CREATE INDEX `handover_property_idx` ON `handovers` (`propertyId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `incident_entity_status_idx` ON `incidents` (`entityId`,`status`,`severity`);--> statement-breakpoint
CREATE INDEX `invoice_lines_invoice_idx` ON `invoiceLines` (`invoiceId`);--> statement-breakpoint
CREATE INDEX `invoice_due_status_idx` ON `invoices` (`entityId`,`dueAt`,`status`);--> statement-breakpoint
CREATE INDEX `key_report_placement_date_idx` ON `keyWorkerReports` (`placementId`,`reportDate`);--> statement-breakpoint
CREATE INDEX `notification_user_idx` ON `notifications` (`userId`,`readAt`);--> statement-breakpoint
CREATE INDEX `payments_invoice_idx` ON `payments` (`invoiceId`,`receivedAt`);--> statement-breakpoint
CREATE INDEX `placement_property_status_idx` ON `placements` (`entityId`,`propertyId`,`status`);--> statement-breakpoint
CREATE INDEX `properties_entity_status_idx` ON `properties` (`entityId`,`status`);--> statement-breakpoint
CREATE INDEX `provider_pack_entity_status_idx` ON `providerPacks` (`entityId`,`status`);--> statement-breakpoint
CREATE INDEX `secure_link_expiry_idx` ON `secureLinks` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `shift_property_time_idx` ON `shifts` (`propertyId`,`startsAt`,`status`);--> statement-breakpoint
CREATE INDEX `staff_entity_status_idx` ON `staffProfiles` (`entityId`,`status`);--> statement-breakpoint
CREATE INDEX `work_plan_due_idx` ON `workPlanActions` (`entityId`,`dueAt`,`status`);--> statement-breakpoint
CREATE INDEX `workforce_check_due_idx` ON `workforceChecks` (`entityId`,`expiresAt`,`status`);