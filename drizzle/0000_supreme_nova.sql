CREATE TABLE `allegationEvidence` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`allegationId` int NOT NULL,
	`documentId` int NOT NULL,
	`evidenceType` enum('chronology','statement','correspondence','agency_decision','meeting_record','outcome','other') NOT NULL,
	`description` varchar(500),
	`addedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `allegationEvidence_id` PRIMARY KEY(`id`),
	CONSTRAINT `allegation_evidence_uq` UNIQUE(`allegationId`,`documentId`)
);
--> statement-breakpoint
CREATE TABLE `allegations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int,
	`placementId` int,
	`incidentId` int,
	`personConcernType` enum('staff','agency','volunteer','professional','other') NOT NULL,
	`staffProfileId` int,
	`personConcernCiphertext` text,
	`allegationType` enum('harm','possible_offence','suitability','position_of_trust','policy_breach','other') NOT NULL,
	`neutralSummaryCiphertext` text NOT NULL,
	`immediateProtectionCiphertext` text NOT NULL,
	`ladoDecision` enum('not_contacted','pending','strategy_discussion','employer_action','police_investigation','no_further_action','other') NOT NULL DEFAULT 'pending',
	`ladoReference` varchar(120),
	`policeDecision` enum('not_contacted','pending','investigating','no_further_action','charged','other') NOT NULL DEFAULT 'not_contacted',
	`policeReference` varchar(120),
	`ofstedDecision` enum('unreviewed','not_notifiable','notify','submitted') NOT NULL DEFAULT 'unreviewed',
	`outcome` enum('pending','substantiated','unsubstantiated','unfounded','malicious','false','no_further_action','other') NOT NULL DEFAULT 'pending',
	`outcomeCiphertext` text,
	`status` enum('open','referred','investigating','employer_action','closed') NOT NULL DEFAULT 'open',
	`restrictedOwnerUserId` int,
	`reviewDueAt` bigint,
	`closedAt` bigint,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `allegations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `analyticsMeasures` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`key` varchar(100) NOT NULL,
	`name` varchar(220) NOT NULL,
	`domain` enum('incident','complaint','missing','restraint','placement','staffing','compliance','finance','improvement','outcome','feedback') NOT NULL,
	`measureType` enum('count','percentage','average','duration','currency','score','custom') NOT NULL,
	`unit` varchar(60),
	`direction` enum('higher_is_better','lower_is_better','neutral') NOT NULL DEFAULT 'neutral',
	`sourceType` enum('system','manual_observation','young_person_feedback') NOT NULL DEFAULT 'system',
	`numeratorDefinition` text,
	`denominatorDefinition` text,
	`exclusionNotes` text,
	`configuration` json,
	`status` enum('draft','active','paused','archived') NOT NULL DEFAULT 'draft',
	`approvedBy` int,
	`approvedAt` bigint,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `analyticsMeasures_id` PRIMARY KEY(`id`),
	CONSTRAINT `analytics_measure_key_uq` UNIQUE(`entityId`,`key`)
);
--> statement-breakpoint
CREATE TABLE `assuranceSchedules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int,
	`name` varchar(180) NOT NULL,
	`jobType` enum('scan_retry','audit_verify','resilience_due','access_review_due') NOT NULL,
	`configuration` json NOT NULL,
	`scheduleCronTaskUid` varchar(65),
	`enabled` int NOT NULL DEFAULT 1,
	`lastRunAt` bigint,
	`lastResult` json,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `assuranceSchedules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
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
CREATE TABLE `auditReceiptMirrors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`auditEventId` bigint NOT NULL,
	`entityId` int,
	`storageKey` varchar(700) NOT NULL,
	`eventHash` varchar(128) NOT NULL,
	`status` enum('stored','verified','missing','mismatch') NOT NULL DEFAULT 'stored',
	`lastVerifiedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auditReceiptMirrors_id` PRIMARY KEY(`id`),
	CONSTRAINT `audit_receipt_event_uq` UNIQUE(`auditEventId`)
);
--> statement-breakpoint
CREATE TABLE `auditVerificationRuns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int,
	`rangeStartId` bigint,
	`rangeEndId` bigint,
	`checkedEvents` int NOT NULL DEFAULT 0,
	`chainMismatches` int NOT NULL DEFAULT 0,
	`missingReceipts` int NOT NULL DEFAULT 0,
	`status` enum('running','passed','warning','failed') NOT NULL DEFAULT 'running',
	`summary` text,
	`manifest` json,
	`startedAt` bigint NOT NULL,
	`completedAt` bigint,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auditVerificationRuns_id` PRIMARY KEY(`id`)
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
CREATE TABLE `behaviourSupportEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`placementId` int NOT NULL,
	`incidentId` int,
	`supportPlanId` int,
	`occurredAt` bigint NOT NULL,
	`antecedentCiphertext` text NOT NULL,
	`behaviourCiphertext` text NOT NULL,
	`consequenceCiphertext` text NOT NULL,
	`positiveSupportCiphertext` text NOT NULL,
	`effectiveness` enum('effective','partly_effective','not_effective','unclear') NOT NULL,
	`youngPersonFeedbackCiphertext` text,
	`reviewRequired` int NOT NULL DEFAULT 0,
	`reviewDueAt` bigint,
	`reviewedAt` bigint,
	`reviewedBy` int,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `behaviourSupportEvents_id` PRIMARY KEY(`id`)
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
	`operationalRole` enum('owner','registered_manager','support_worker','hr_compliance','finance','read_only') NOT NULL,
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
CREATE TABLE `complaintEscalations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`complaintId` int NOT NULL,
	`fromUserId` int,
	`toUserId` int,
	`targetType` enum('owner','registered_manager','responsible_individual','local_authority','ofsted','ombudsman','other') NOT NULL,
	`targetName` varchar(220),
	`reasonCiphertext` text NOT NULL,
	`dueAt` bigint,
	`status` enum('sent','acknowledged','resolved','cancelled') NOT NULL DEFAULT 'sent',
	`acknowledgedAt` bigint,
	`acknowledgedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `complaintEscalations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `complaints` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int,
	`placementId` int,
	`incidentId` int,
	`complainantType` enum('young_person','family_advocate','professional','staff','neighbour','anonymous','other') NOT NULL,
	`complainantCiphertext` text,
	`consentState` enum('given','not_given','not_required','unable','unknown') NOT NULL DEFAULT 'unknown',
	`accessibilityNeedsCiphertext` text,
	`stage` enum('informal','stage_1','stage_2','external','closed') NOT NULL DEFAULT 'stage_1',
	`category` enum('quality','staff_conduct','safeguarding','property','privacy','finance','discrimination','other') NOT NULL,
	`summaryCiphertext` text NOT NULL,
	`receivedAt` bigint NOT NULL,
	`responseDueAt` bigint NOT NULL,
	`acknowledgedAt` bigint,
	`outcome` enum('upheld','partially_upheld','not_upheld','withdrawn','unresolved','pending') NOT NULL DEFAULT 'pending',
	`responseCiphertext` text,
	`learningCiphertext` text,
	`escalationTarget` varchar(220),
	`status` enum('received','acknowledged','investigating','response_due','escalated','closed') NOT NULL DEFAULT 'received',
	`ownerUserId` int,
	`closedAt` bigint,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `complaints_id` PRIMARY KEY(`id`)
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
CREATE TABLE `curfewChecks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`placementId` int NOT NULL,
	`curfewPlanId` int NOT NULL,
	`expectedAt` bigint NOT NULL,
	`actualAt` bigint,
	`status` enum('met','late','absent','authorised_away','not_applicable','pending') NOT NULL DEFAULT 'pending',
	`contactAttemptsCiphertext` text,
	`reasonCiphertext` text,
	`escalationRequired` int NOT NULL DEFAULT 0,
	`actionTakenCiphertext` text,
	`acknowledgedBy` int,
	`acknowledgedAt` bigint,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `curfewChecks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `curfewPlans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`placementId` int NOT NULL,
	`weekdays` json NOT NULL,
	`expectedLeaveTime` varchar(8),
	`expectedReturnTime` varchar(8) NOT NULL,
	`graceMinutes` int NOT NULL DEFAULT 15,
	`instructionsCiphertext` text,
	`escalationAfterMinutes` int NOT NULL DEFAULT 30,
	`startsAt` bigint NOT NULL,
	`endsAt` bigint,
	`reviewDueAt` bigint,
	`status` enum('draft','active','paused','ended') NOT NULL DEFAULT 'draft',
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `curfewPlans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
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
CREATE TABLE `dataRightsCases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`placementId` int,
	`caseReference` varchar(64) NOT NULL,
	`requestType` enum('access','rectification','restriction','objection','erasure','portability','sharing_review','complaint') NOT NULL,
	`requesterType` enum('young_person','parent','representative','professional','staff','other') NOT NULL,
	`requesterNameCiphertext` text NOT NULL,
	`requesterContactCiphertext` text,
	`representativeNameCiphertext` text,
	`representativeAuthority` text,
	`communicationNeedsCiphertext` text,
	`identityStatus` enum('not_started','pending','verified','failed','not_required') NOT NULL DEFAULT 'not_started',
	`identityMethod` varchar(160),
	`identityEvidenceDocumentId` int,
	`scope` json NOT NULL,
	`receivedAt` bigint NOT NULL,
	`dueAt` bigint NOT NULL,
	`extensionUntil` bigint,
	`extensionReason` text,
	`exemptionBasis` text,
	`status` enum('received','identity_check','scoping','collecting','redacting','awaiting_approval','ready','delivered','restricted','refused','withdrawn','closed','overdue') NOT NULL DEFAULT 'received',
	`ownerUserId` int,
	`approvedBy` int,
	`approvedAt` bigint,
	`exportJobId` int,
	`deliveryDocumentId` int,
	`deliveredAt` bigint,
	`closedAt` bigint,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`identityReferenceCiphertext` text,
	`identityVerifiedBy` int,
	`identityVerifiedAt` bigint,
	`identityFailureReason` text,
	CONSTRAINT `dataRightsCases_id` PRIMARY KEY(`id`),
	CONSTRAINT `data_rights_case_ref_uq` UNIQUE(`entityId`,`caseReference`)
);
--> statement-breakpoint
CREATE TABLE `dataRightsEvents` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`caseId` int NOT NULL,
	`eventType` varchar(100) NOT NULL,
	`occurredAt` bigint NOT NULL,
	`actorUserId` int,
	`metadata` json,
	CONSTRAINT `dataRightsEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
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
CREATE TABLE `documentScanJobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`documentId` int NOT NULL,
	`documentVersionId` int NOT NULL,
	`providerType` enum('built_in','webhook','manual_review') NOT NULL DEFAULT 'manual_review',
	`providerName` varchar(160),
	`providerReference` varchar(220),
	`status` enum('queued','submitted','clean','quarantined','failed','overridden','cancelled') NOT NULL DEFAULT 'queued',
	`verdict` varchar(160),
	`threatName` varchar(220),
	`attempts` int NOT NULL DEFAULT 0,
	`lastAttemptAt` bigint,
	`nextRetryAt` bigint,
	`completedAt` bigint,
	`overrideReason` text,
	`overriddenBy` int,
	`metadata` json,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `documentScanJobs_id` PRIMARY KEY(`id`)
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
	`scanStatus` enum('pending','not_available','clean','quarantined') NOT NULL DEFAULT 'pending',
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
	`folderId` int,
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
CREATE TABLE `eSignatureEnvelopes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`connectionId` int,
	`documentId` int NOT NULL,
	`documentVersionId` int NOT NULL,
	`title` varchar(240) NOT NULL,
	`status` enum('draft','pending_approval','sent','viewed','part_signed','completed','declined','expired','voided','failed') NOT NULL DEFAULT 'draft',
	`providerReference` varchar(200),
	`expiresAt` bigint,
	`sentAt` bigint,
	`completedAt` bigint,
	`completionEvidenceDocumentId` int,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `eSignatureEnvelopes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `eSignatureSigners` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`envelopeId` int NOT NULL,
	`signerRole` varchar(120) NOT NULL,
	`nameCiphertext` text NOT NULL,
	`emailCiphertext` text NOT NULL,
	`signingOrder` int NOT NULL DEFAULT 1,
	`status` enum('pending','sent','viewed','signed','declined','expired') NOT NULL DEFAULT 'pending',
	`viewedAt` bigint,
	`signedAt` bigint,
	`providerReference` varchar(200),
	CONSTRAINT `eSignatureSigners_id` PRIMARY KEY(`id`)
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
CREATE TABLE `entities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(160) NOT NULL,
	`legalName` varchar(220) NOT NULL,
	`companyNumber` varchar(32),
	`ofstedUrn` varchar(64),
	`vatNumber` varchar(32),
	`phone` varchar(40),
	`email` varchar(320),
	`supportContactName` varchar(180),
	`supportEmail` varchar(320),
	`supportPhone` varchar(40),
	`supportGuidance` text,
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
CREATE TABLE `evidenceFrameworks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int,
	`regimeId` int NOT NULL,
	`name` varchar(220) NOT NULL,
	`description` text,
	`version` int NOT NULL DEFAULT 1,
	`status` enum('draft','in_review','approved','active','superseded','rolled_back') NOT NULL DEFAULT 'draft',
	`effectiveFrom` bigint,
	`effectiveTo` bigint,
	`previousFrameworkId` int,
	`approvedBy` int,
	`approvedAt` bigint,
	`activatedBy` int,
	`activatedAt` bigint,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `evidenceFrameworks_id` PRIMARY KEY(`id`)
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
CREATE TABLE `feeSchedules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`localAuthorityId` int,
	`propertyId` int,
	`placementType` varchar(120),
	`contractReference` varchar(160),
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
CREATE TABLE `frameworkPublications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int,
	`frameworkId` int NOT NULL,
	`publicationType` enum('validation','impact_preview','approval','activation','rollback') NOT NULL,
	`status` enum('pending','passed','failed','approved','completed','rolled_back') NOT NULL DEFAULT 'pending',
	`validationErrors` json,
	`validationWarnings` json,
	`impactSnapshot` json,
	`obligationCount` int NOT NULL DEFAULT 0,
	`affectedRecordCount` int NOT NULL DEFAULT 0,
	`previousFrameworkId` int,
	`approvedBy` int,
	`approvedAt` bigint,
	`completedAt` bigint,
	`notes` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `frameworkPublications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `frameworkRequirements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int,
	`frameworkId` int NOT NULL,
	`parentRequirementId` int,
	`code` varchar(100) NOT NULL,
	`title` varchar(240) NOT NULL,
	`description` text,
	`outcomeArea` varchar(180) NOT NULL,
	`standardName` varchar(220),
	`category` enum('property','workforce','placement','policy','quality','finance','data_protection') NOT NULL,
	`applicability` json NOT NULL,
	`recurrence` enum('once','monthly','quarterly','six_monthly','annual','event_driven','custom') NOT NULL DEFAULT 'annual',
	`customIntervalDays` int,
	`leadDays` int NOT NULL DEFAULT 30,
	`ownerRole` varchar(80) NOT NULL,
	`evidenceRules` json NOT NULL,
	`escalationRules` json NOT NULL,
	`mappings` json,
	`required` int NOT NULL DEFAULT 1,
	`status` enum('draft','active','retired') NOT NULL DEFAULT 'draft',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `frameworkRequirements_id` PRIMARY KEY(`id`),
	CONSTRAINT `framework_requirement_code_uq` UNIQUE(`frameworkId`,`code`)
);
--> statement-breakpoint
CREATE TABLE `guestInvitations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`purpose` enum('property_summary') NOT NULL DEFAULT 'property_summary',
	`recipientLabel` varchar(180),
	`tokenHash` varchar(128) NOT NULL,
	`expiresAt` bigint NOT NULL,
	`maxUses` int NOT NULL DEFAULT 1,
	`useCount` int NOT NULL DEFAULT 0,
	`revokedAt` bigint,
	`lastAccessedAt` bigint,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `guestInvitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `guest_invitation_token_uq` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `handoverAcknowledgements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`handoverId` int NOT NULL,
	`shiftId` int NOT NULL,
	`userId` int NOT NULL,
	`acknowledgedAt` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `handoverAcknowledgements_id` PRIMARY KEY(`id`),
	CONSTRAINT `handover_acknowledgement_uq` UNIQUE(`handoverId`,`shiftId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `handoverReviewEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`handoverId` int NOT NULL,
	`decision` enum('reviewed','approved','returned') NOT NULL,
	`notesCiphertext` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `handoverReviewEvents_id` PRIMARY KEY(`id`)
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
	`templateCode` varchar(80),
	`structuredBriefCiphertext` text,
	`dictatedTextCiphertext` text,
	`dictatedReviewState` enum('not_required','pending_review','reviewed','approved','returned') NOT NULL DEFAULT 'not_required',
	`reviewedBy` int,
	`reviewedAt` bigint,
	`approvedBy` int,
	`approvedAt` bigint,
	`reviewNotesCiphertext` text,
	`acknowledgedAt` bigint,
	`acknowledgedBy` int,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `handovers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `healthMonitoringEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`placementId` int NOT NULL,
	`planId` int NOT NULL,
	`occurredAt` bigint NOT NULL,
	`value` varchar(180),
	`unit` varchar(80),
	`outcome` enum('within_expected','outside_expected','unable','declined','not_required','other') NOT NULL,
	`notesCiphertext` text,
	`escalationRequired` int NOT NULL DEFAULT 0,
	`escalationActionCiphertext` text,
	`acknowledgedBy` int,
	`acknowledgedAt` bigint,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `healthMonitoringEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `healthMonitoringPlans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`placementId` int NOT NULL,
	`monitoringType` enum('blood_pressure','blood_glucose','weight','temperature','seizure','sleep','nutrition','hydration','mental_wellbeing','pain','wound','other') NOT NULL,
	`title` varchar(220) NOT NULL,
	`frequency` enum('as_required','once_daily','twice_daily','weekly','monthly','event_based','other') NOT NULL,
	`instructionsCiphertext` text NOT NULL,
	`expectedRange` varchar(180),
	`escalationThreshold` varchar(220),
	`escalationActionCiphertext` text,
	`responsibleRole` enum('key_worker','support_worker','manager','health_professional','other') NOT NULL DEFAULT 'key_worker',
	`consentBasis` enum('young_person_consent','care_plan','clinical_instruction','best_interests','other') NOT NULL,
	`startsAt` bigint NOT NULL,
	`endsAt` bigint,
	`nextDueAt` bigint,
	`reviewDueAt` bigint NOT NULL,
	`status` enum('draft','active','paused','ended') NOT NULL DEFAULT 'draft',
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `healthMonitoringPlans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `identityAssuranceReviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`userId` int,
	`assuranceType` enum('mfa','sso','account_recovery','role_sign_off','access_review','break_glass','joiner_mover_leaver') NOT NULL,
	`provider` varchar(160),
	`assuranceMethod` varchar(220),
	`status` enum('planned','in_review','passed','conditional','failed','revoked','expired') NOT NULL DEFAULT 'planned',
	`reviewedAt` bigint,
	`nextReviewAt` bigint,
	`evidenceDocumentId` int,
	`riskNotes` text,
	`decisionNotes` text,
	`reviewedBy` int,
	`approvedBy` int,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `identityAssuranceReviews_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `incidentChronology` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`incidentId` int NOT NULL,
	`occurredAt` bigint NOT NULL,
	`eventType` enum('observation','disclosure','action','contact','decision','notification','outcome','other') NOT NULL,
	`neutralAccountCiphertext` text NOT NULL,
	`source` enum('direct_observation','young_person','staff','professional','witness','record','other') NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `incidentChronology_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `incidentPeople` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`incidentId` int NOT NULL,
	`personType` enum('young_person','staff','professional','visitor','public','other') NOT NULL,
	`placementId` int,
	`userId` int,
	`nameCiphertext` text,
	`contactCiphertext` text,
	`roleDescription` varchar(180),
	`involvement` enum('affected','witness','reporter','person_of_concern','responding_professional','other') NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `incidentPeople_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `incidentReferences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`incidentId` int NOT NULL,
	`referenceType` enum('police','nhs','local_authority','ofsted','lado','insurance','other') NOT NULL,
	`referenceValueCiphertext` text NOT NULL,
	`organisation` varchar(220),
	`notesCiphertext` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `incidentReferences_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `incidentReviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`incidentId` int NOT NULL,
	`decision` enum('started','returned','approved','follow_up','closed') NOT NULL,
	`notesCiphertext` text,
	`notificationAssessment` enum('unchanged','not_notifiable','regulation_27','other_notification') NOT NULL DEFAULT 'unchanged',
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `incidentReviews_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `incidentWitnesses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`incidentId` int NOT NULL,
	`witnessType` enum('young_person','staff','professional','public','other') NOT NULL,
	`witnessUserId` int,
	`nameCiphertext` text,
	`contactCiphertext` text,
	`statementDocumentId` int,
	`consentToContact` int NOT NULL DEFAULT 0,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `incidentWitnesses_id` PRIMARY KEY(`id`)
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
	`managerReviewState` enum('pending','in_review','returned','approved','closed') NOT NULL DEFAULT 'pending',
	`managerReviewNotesCiphertext` text,
	`reviewedBy` int,
	`reviewedAt` bigint,
	`version` int NOT NULL DEFAULT 1,
	`managerUserId` int,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `incidents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `integrationAttempts` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`deliveryId` int NOT NULL,
	`attemptNumber` int NOT NULL,
	`startedAt` bigint NOT NULL,
	`completedAt` bigint,
	`outcome` enum('processing','delivered','acknowledged','retry','failed','duplicate') NOT NULL DEFAULT 'processing',
	`httpStatus` int,
	`providerReference` varchar(200),
	`responseHash` varchar(128),
	`errorCode` varchar(120),
	`errorMessage` text,
	`retryAt` bigint,
	`metadata` json,
	CONSTRAINT `integrationAttempts_id` PRIMARY KEY(`id`),
	CONSTRAINT `integration_attempt_number_uq` UNIQUE(`deliveryId`,`attemptNumber`)
);
--> statement-breakpoint
CREATE TABLE `integrationConnections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`name` varchar(180) NOT NULL,
	`integrationType` enum('payroll','accounting','esignature','email','sms','local_authority','monitoring','malware_scan','generic_webhook') NOT NULL,
	`adapterType` enum('secure_export','signed_webhook','rest_api','smtp_api','sms_api','esign_api','scan_api') NOT NULL,
	`direction` enum('outbound','inbound','bidirectional') NOT NULL DEFAULT 'outbound',
	`status` enum('draft','pending_approval','active','paused','failed','revoked') NOT NULL DEFAULT 'draft',
	`endpointUrl` text,
	`secretCiphertext` text,
	`credentialLabel` varchar(160),
	`scopes` json NOT NULL,
	`config` json,
	`allowedResourceTypes` json,
	`rateLimitPerMinute` int NOT NULL DEFAULT 30,
	`maxAttempts` int NOT NULL DEFAULT 5,
	`retryBaseMinutes` int NOT NULL DEFAULT 5,
	`healthStatus` enum('not_checked','healthy','degraded','failed') NOT NULL DEFAULT 'not_checked',
	`lastHealthCheckAt` bigint,
	`lastSuccessAt` bigint,
	`lastFailureAt` bigint,
	`lastError` text,
	`approvedBy` int,
	`approvedAt` bigint,
	`scheduleCronTaskUid` varchar(65),
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `integrationConnections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `integrationDeliveries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`connectionId` int NOT NULL,
	`deliveryType` enum('payroll_export','invoice_export','credit_export','payment_import','reconciliation_import','esign_envelope','email','sms','referral_exchange','placement_exchange','invoice_exchange','evidence_pack','status_exchange','health_check','scan_request','generic') NOT NULL,
	`resourceType` varchar(80),
	`resourceId` varchar(80),
	`idempotencyKey` varchar(180) NOT NULL,
	`payloadSnapshot` json NOT NULL,
	`payloadHash` varchar(128) NOT NULL,
	`status` enum('draft','pending_approval','queued','processing','delivered','acknowledged','retry_scheduled','failed','cancelled','duplicate') NOT NULL DEFAULT 'draft',
	`humanApprovedBy` int,
	`humanApprovedAt` bigint,
	`recipientSnapshot` json,
	`scheduledFor` bigint,
	`attemptCount` int NOT NULL DEFAULT 0,
	`nextAttemptAt` bigint,
	`providerReference` varchar(200),
	`deliveredAt` bigint,
	`acknowledgedAt` bigint,
	`lastError` text,
	`exportDocumentId` int,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `integrationDeliveries_id` PRIMARY KEY(`id`),
	CONSTRAINT `integration_delivery_dedupe_uq` UNIQUE(`connectionId`,`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `integrationReceipts` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`connectionId` int NOT NULL,
	`externalEventId` varchar(220) NOT NULL,
	`eventType` varchar(120) NOT NULL,
	`signatureValid` int NOT NULL DEFAULT 0,
	`receivedAt` bigint NOT NULL,
	`payloadHash` varchar(128) NOT NULL,
	`status` enum('received','duplicate','processed','rejected','failed') NOT NULL DEFAULT 'received',
	`processedAt` bigint,
	`linkedResourceType` varchar(80),
	`linkedResourceId` varchar(80),
	`errorMessage` text,
	`payloadSnapshot` json,
	`reviewedBy` int,
	`reviewedAt` bigint,
	CONSTRAINT `integrationReceipts_id` PRIMARY KEY(`id`),
	CONSTRAINT `integration_receipt_event_uq` UNIQUE(`connectionId`,`externalEventId`)
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
CREATE TABLE `invoiceEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`invoiceId` int NOT NULL,
	`eventType` enum('created','approved','issued','delivered','reminded','disputed','dispute_resolved','payment','credit','reconciled','voided','document_generated','secure_link_created','secure_link_viewed','secure_link_revoked') NOT NULL,
	`occurredAt` bigint NOT NULL,
	`actorUserId` int,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `invoiceEvents_id` PRIMARY KEY(`id`)
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
	`approvalRequestedAt` bigint,
	`approvedAt` bigint,
	`approvedBy` int,
	`issuedAt` bigint,
	`issuedBy` int,
	`sentAt` bigint,
	`deliveryMethod` enum('secure_link','email','portal','manual'),
	`deliveryReference` varchar(220),
	`disputeOpenedAt` bigint,
	`disputeResolvedAt` bigint,
	`reconciliationStatus` enum('unreconciled','part_reconciled','reconciled','exception') NOT NULL DEFAULT 'unreconciled',
	`pdfDocumentId` int,
	`notes` text,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `invoice_number_uq` UNIQUE(`entityId`,`invoiceNumber`)
);
--> statement-breakpoint
CREATE TABLE `keyWorkerReportReviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`reportId` int NOT NULL,
	`decision` enum('returned','reviewed','approved','locked','addendum_requested') NOT NULL,
	`notesCiphertext` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `keyWorkerReportReviews_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
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
	`learning` text,
	`enthusiasm` varchar(120),
	`discussions` text,
	`pointsToNote` text,
	`plan` text,
	`nextReviewAt` bigint,
	`suggestions` text,
	`status` enum('draft','submitted','reviewed','returned','approved','locked') NOT NULL DEFAULT 'draft',
	`reviewedBy` int,
	`reviewedAt` bigint,
	`reviewNotesCiphertext` text,
	`approvedBy` int,
	`approvedAt` bigint,
	`lockedBy` int,
	`lockedAt` bigint,
	`version` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `keyWorkerReports_id` PRIMARY KEY(`id`)
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
CREATE TABLE `localAuthCredentials` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`emailNormalized` varchar(320) NOT NULL,
	`passwordHash` text NOT NULL,
	`passwordVersion` int NOT NULL DEFAULT 1,
	`mustChangePassword` int NOT NULL DEFAULT 0,
	`failedAttempts` int NOT NULL DEFAULT 0,
	`lockedUntil` bigint,
	`lastFailedAt` bigint,
	`lastPasswordChangedAt` bigint NOT NULL,
	`resetTokenHash` varchar(128),
	`resetExpiresAt` bigint,
	`resetUsedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `localAuthCredentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `local_auth_user_uq` UNIQUE(`userId`),
	CONSTRAINT `local_auth_email_uq` UNIQUE(`emailNormalized`)
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
CREATE TABLE `loneWorkerCheckIns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`sessionId` int NOT NULL,
	`checkInType` enum('scheduled','manual','help_requested','session_end') NOT NULL,
	`wellbeingStatus` enum('safe','concern','help_required') NOT NULL DEFAULT 'safe',
	`occurredAt` bigint NOT NULL,
	`latitude` decimal(10,7),
	`longitude` decimal(10,7),
	`accuracyMetres` decimal(10,2),
	`locationState` enum('on_site','off_site','unavailable','manual') NOT NULL,
	`noteCiphertext` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `loneWorkerCheckIns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `loneWorkerSessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`shiftId` int NOT NULL,
	`userId` int NOT NULL,
	`startsAt` bigint NOT NULL,
	`expectedEndAt` bigint NOT NULL,
	`checkInIntervalMinutes` int NOT NULL DEFAULT 60,
	`escalationAfterMinutes` int NOT NULL DEFAULT 15,
	`nextCheckInDueAt` bigint NOT NULL,
	`lastCheckInAt` bigint,
	`status` enum('active','overdue','escalated','completed','cancelled') NOT NULL DEFAULT 'active',
	`escalatedAt` bigint,
	`escalationNoteCiphertext` text,
	`completedAt` bigint,
	`version` int NOT NULL DEFAULT 1,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `loneWorkerSessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `lone_worker_shift_user_uq` UNIQUE(`shiftId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `maintenanceJobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`unitId` int,
	`propertyCheckId` int,
	`incidentId` int,
	`title` varchar(220) NOT NULL,
	`category` enum('plumbing','electrical','heating','fire_safety','security','furniture','appliance','fabric','pest','cleaning','other') NOT NULL,
	`priority` enum('routine','urgent','emergency') NOT NULL DEFAULT 'routine',
	`descriptionCiphertext` text NOT NULL,
	`accessNotesCiphertext` text,
	`assignedUserId` int,
	`contractorName` varchar(220),
	`status` enum('reported','triaged','assigned','scheduled','in_progress','completed','verified','cancelled','reopened') NOT NULL DEFAULT 'reported',
	`targetAt` bigint,
	`appointmentStart` bigint,
	`appointmentEnd` bigint,
	`completedAt` bigint,
	`verifiedBy` int,
	`verifiedAt` bigint,
	`version` int NOT NULL DEFAULT 1,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `maintenanceJobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `maintenanceUpdates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`maintenanceJobId` int NOT NULL,
	`updateType` enum('note','status_change','appointment','contractor_visit','evidence','completion','reopen') NOT NULL,
	`statusFrom` varchar(40),
	`statusTo` varchar(40),
	`noteCiphertext` text,
	`documentId` int,
	`occurredAt` bigint NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `maintenanceUpdates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `medicationAdministrations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`placementId` int NOT NULL,
	`medicationId` int NOT NULL,
	`scheduledAt` bigint NOT NULL,
	`administeredAt` bigint,
	`outcome` enum('taken','refused','omitted','unavailable','asleep','away','other') NOT NULL,
	`doseAcknowledged` varchar(120),
	`reasonCiphertext` text,
	`actionTakenCiphertext` text,
	`witnessUserId` int,
	`escalationRequired` int NOT NULL DEFAULT 0,
	`managerAcknowledgedBy` int,
	`managerAcknowledgedAt` bigint,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `medicationAdministrations_id` PRIMARY KEY(`id`)
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
CREATE TABLE `medicationStockTransactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`placementId` int NOT NULL,
	`medicationId` int NOT NULL,
	`administrationId` int,
	`transactionType` enum('receipt','administration','return','disposal','correction','count') NOT NULL,
	`quantity` decimal(10,3) NOT NULL,
	`balanceAfter` decimal(10,3) NOT NULL,
	`unit` varchar(60) NOT NULL,
	`batchReference` varchar(120),
	`expiresAt` bigint,
	`occurredAt` bigint NOT NULL,
	`reasonCiphertext` text,
	`witnessUserId` int,
	`documentId` int,
	`status` enum('recorded','review_required','approved') NOT NULL DEFAULT 'recorded',
	`reviewedBy` int,
	`reviewedAt` bigint,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `medicationStockTransactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `medications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`placementId` int NOT NULL,
	`name` varchar(220) NOT NULL,
	`form` enum('tablet','capsule','liquid','inhaler','cream','injection','patch','drops','other') NOT NULL,
	`dose` varchar(120) NOT NULL,
	`route` enum('oral','inhaled','topical','subcutaneous','intramuscular','eye','ear','nasal','other') NOT NULL,
	`frequency` enum('once_daily','twice_daily','three_times_daily','four_times_daily','weekly','as_required','other') NOT NULL,
	`administrationWindow` varchar(180) NOT NULL,
	`instructionsCiphertext` text,
	`prnInstructionsCiphertext` text,
	`supportModel` enum('staff_administered','supported_self_administration','self_administration') NOT NULL DEFAULT 'staff_administered',
	`selfAdministrationAssessmentCiphertext` text,
	`selfAdministrationReviewDueAt` bigint,
	`storageLocationCiphertext` text,
	`prescriber` varchar(220),
	`pharmacy` varchar(220),
	`stockNotesCiphertext` text,
	`startsAt` bigint NOT NULL,
	`endsAt` bigint,
	`nextDueAt` bigint,
	`reviewDueAt` bigint,
	`status` enum('draft','active','paused','ended') NOT NULL DEFAULT 'draft',
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `medications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `missingEpisodes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`placementId` int NOT NULL,
	`incidentId` int,
	`missingAt` bigint NOT NULL,
	`discoveredAt` bigint NOT NULL,
	`policeContactedAt` bigint,
	`policeReference` varchar(120),
	`riskLevel` enum('low','medium','high','critical') NOT NULL,
	`circumstancesCiphertext` text NOT NULL,
	`actionsCiphertext` text NOT NULL,
	`notifications` json,
	`returnedAt` bigint,
	`returnMethod` enum('self_return','police','staff','family','authority','found','other'),
	`returnCircumstancesCiphertext` text,
	`returnInterviewDueAt` bigint,
	`returnInterviewAt` bigint,
	`returnInterviewOutcomeCiphertext` text,
	`patternFlags` json,
	`learningCiphertext` text,
	`status` enum('missing','located','returned','interview_due','follow_up','closed') NOT NULL DEFAULT 'missing',
	`managerUserId` int,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`returnRecordedBy` int,
	`returnInterviewBy` int,
	`returnInterviewOverrideReasonCiphertext` text,
	CONSTRAINT `missingEpisodes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notificationChannelDeliveries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`notificationId` int,
	`userId` int NOT NULL,
	`channel` enum('push','email','sms') NOT NULL,
	`status` enum('pending','provider_inactive','queued','processing','delivered','failed','cancelled') NOT NULL DEFAULT 'pending',
	`providerConnectionId` int,
	`idempotencyKey` varchar(220) NOT NULL,
	`recipientHint` varchar(160),
	`payloadSnapshot` json NOT NULL,
	`attemptCount` int NOT NULL DEFAULT 0,
	`nextAttemptAt` bigint,
	`providerReference` varchar(200),
	`deliveredAt` bigint,
	`lastError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `notificationChannelDeliveries_id` PRIMARY KEY(`id`),
	CONSTRAINT `notification_channel_delivery_uq` UNIQUE(`idempotencyKey`)
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
	`deepLink` varchar(400),
	`dueAt` bigint,
	`readAt` bigint,
	`resolvedAt` bigint,
	`acknowledgementRequired` int NOT NULL DEFAULT 1,
	`snoozedUntil` bigint,
	`escalationDueAt` bigint,
	`escalationState` enum('none','escalated','acknowledged','resolved') NOT NULL DEFAULT 'none',
	`escalationCount` int NOT NULL DEFAULT 0,
	`dedupeKey` varchar(240),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `notification_dedupe_uq` UNIQUE(`userId`,`dedupeKey`)
);
--> statement-breakpoint
CREATE TABLE `occupancyEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`unitId` int,
	`placementId` int,
	`eventType` enum('reserved','move_in','move_out','made_available','maintenance_start','maintenance_end') NOT NULL,
	`effectiveAt` bigint NOT NULL,
	`reason` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `occupancyEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `offlineSyncReceipts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`userId` int NOT NULL,
	`idempotencyKey` varchar(100) NOT NULL,
	`operation` enum('key_worker_report','incident','clock_event','handover','visitor_entry','curfew_check','missing_episode','medication_administration','property_check','maintenance_job','resident_finance_transaction','lone_worker_check_in') NOT NULL,
	`payloadHash` varchar(64) NOT NULL,
	`clientCreatedAt` bigint NOT NULL,
	`clientVersion` int NOT NULL DEFAULT 1,
	`status` enum('applied','conflict','rejected') NOT NULL,
	`resourceType` varchar(80),
	`resourceId` int,
	`conflictCode` varchar(100),
	`conflictMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `offlineSyncReceipts_id` PRIMARY KEY(`id`),
	CONSTRAINT `offline_sync_user_key_uq` UNIQUE(`userId`,`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `outcomeObservations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`measureId` int NOT NULL,
	`placementId` int NOT NULL,
	`propertyId` int,
	`periodStart` bigint NOT NULL,
	`periodEnd` bigint NOT NULL,
	`numericValue` decimal(12,3),
	`feedbackScore` int,
	`feedbackCiphertext` text,
	`source` enum('young_person','key_worker','manager','professional','system_import') NOT NULL,
	`evidenceDocumentId` int,
	`contextNotes` text,
	`capturedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `outcomeObservations_id` PRIMARY KEY(`id`)
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
CREATE TABLE `placementNotifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`placementId` int NOT NULL,
	`propertyId` int,
	`notificationType` enum('admission','discharge') NOT NULL,
	`decision` enum('pending','notify_host_authority','same_authority_exempt','not_required') NOT NULL DEFAULT 'pending',
	`decisionReason` text,
	`placingAuthorityId` int,
	`hostAuthorityId` int,
	`recipientName` varchar(220),
	`recipientEmail` varchar(320),
	`eventAt` bigint NOT NULL,
	`dueAt` bigint NOT NULL,
	`factsSnapshotCiphertext` text,
	`packDocumentId` int,
	`status` enum('draft','decision_recorded','pack_ready','submitted','exempt','overdue','closed') NOT NULL DEFAULT 'draft',
	`submittedAt` bigint,
	`submittedBy` int,
	`submissionMethod` enum('email','portal','secure_link','post','other'),
	`submissionReference` varchar(180),
	`submissionEvidenceDocumentId` int,
	`decisionBy` int,
	`decisionAt` bigint,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`dischargeDestinationType` enum('family','independent_living','supported_accommodation','semi_independent','custody','hospital','homeless','unknown','other'),
	`dischargeReason` enum('planned_transition','placement_end','safeguarding','placement_breakdown','custody','hospital','young_person_choice','other'),
	`dischargeDetailsCiphertext` text,
	`receivingAuthorityId` int,
	`handoverStatus` enum('not_started','planned','complete','not_applicable'),
	`followUpRequired` int NOT NULL DEFAULT 0,
	`followUpDueAt` bigint,
	CONSTRAINT `placementNotifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `placement_notification_type_uq` UNIQUE(`placementId`,`notificationType`)
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
CREATE TABLE `processingRestrictions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`caseId` int,
	`placementId` int,
	`resourceType` varchar(80),
	`resourceId` varchar(80),
	`restrictionType` enum('all_processing','export','sharing','automation','correction','deletion','specified') NOT NULL,
	`reason` text NOT NULL,
	`blockedActions` json NOT NULL,
	`startsAt` bigint NOT NULL,
	`endsAt` bigint,
	`status` enum('active','review_due','lifted','expired') NOT NULL DEFAULT 'active',
	`approvedBy` int,
	`liftedBy` int,
	`liftedAt` bigint,
	`liftReason` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `processingRestrictions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `professionalContacts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`placementId` int NOT NULL,
	`contactType` enum('social_worker','iro','personal_adviser','emergency_duty_team','health','education','probation','court','family_advocate','other') NOT NULL,
	`name` varchar(180) NOT NULL,
	`roleTitle` varchar(180),
	`organisation` varchar(220),
	`phone` varchar(40),
	`email` varchar(320),
	`outOfHoursPhone` varchar(40),
	`preferredContactMethod` enum('phone','email','secure_email','portal','other') NOT NULL DEFAULT 'email',
	`isPrimary` int NOT NULL DEFAULT 0,
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`notesCiphertext` text,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `professionalContacts_id` PRIMARY KEY(`id`)
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
CREATE TABLE `propertyChecks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`unitId` int,
	`placementId` int,
	`shiftId` int,
	`checkType` enum('room_check','property_check','fire_check','night_check','health_safety','welfare','other') NOT NULL,
	`authorityBasis` enum('scheduled','consent','risk_assessment','emergency','policy','other') NOT NULL,
	`checklistSnapshot` json NOT NULL,
	`findingsCiphertext` text,
	`privacyNotesCiphertext` text,
	`youngPersonPresent` int NOT NULL DEFAULT 0,
	`result` enum('pass','issues_found','urgent_action') NOT NULL,
	`status` enum('draft','submitted','reviewed','returned','closed') NOT NULL DEFAULT 'draft',
	`completedAt` bigint,
	`reviewedBy` int,
	`reviewedAt` bigint,
	`reviewNotesCiphertext` text,
	`version` int NOT NULL DEFAULT 1,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `propertyChecks_id` PRIMARY KEY(`id`)
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
CREATE TABLE `propertyUnits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`label` varchar(100) NOT NULL,
	`unitType` enum('bedroom','self_contained','lodgings_room','other') NOT NULL DEFAULT 'bedroom',
	`capacity` int NOT NULL DEFAULT 1,
	`status` enum('available','occupied','reserved','maintenance','inactive') NOT NULL DEFAULT 'available',
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `propertyUnits_id` PRIMARY KEY(`id`),
	CONSTRAINT `property_unit_label_uq` UNIQUE(`propertyId`,`label`)
);
--> statement-breakpoint
CREATE TABLE `propertyVisitors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`placementId` int,
	`visitorType` enum('friend','relative','professional','contractor','public_official','other') NOT NULL,
	`nameCiphertext` text NOT NULL,
	`relationshipCiphertext` text,
	`purposeCiphertext` text NOT NULL,
	`idCheckStatus` enum('not_required','not_checked','verified','declined','unavailable') NOT NULL DEFAULT 'not_checked',
	`identityDocumentId` int,
	`vehicleRegistrationCiphertext` text,
	`arrivedAt` bigint NOT NULL,
	`expectedDepartureAt` bigint,
	`departedAt` bigint,
	`status` enum('on_site','departed','overdue','refused') NOT NULL DEFAULT 'on_site',
	`notesCiphertext` text,
	`version` int NOT NULL DEFAULT 1,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `propertyVisitors_id` PRIMARY KEY(`id`)
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
CREATE TABLE `qualityReviewConsultations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`qualityReviewId` int NOT NULL,
	`entityId` int NOT NULL,
	`audience` enum('young_person','placing_authority','staff','professional','family_advocate','other') NOT NULL,
	`participantReference` varchar(180),
	`invitedAt` bigint,
	`respondedAt` bigint,
	`method` enum('conversation','meeting','telephone','email','survey','written','advocate','other'),
	`responseStatus` enum('planned','invited','responded','declined','no_response','not_applicable') NOT NULL DEFAULT 'planned',
	`accessibilityNeeds` text,
	`responseSummary` text,
	`noResponseReason` text,
	`evidenceDocumentId` int,
	`recordedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `qualityReviewConsultations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `qualityReviewEvidence` (
	`id` int AUTO_INCREMENT NOT NULL,
	`qualityReviewId` int NOT NULL,
	`entityId` int NOT NULL,
	`category` enum('outcomes','safeguarding','staffing','placement_stability','complaints','incidents','compliance','feedback','education_health','independence','other') NOT NULL,
	`title` varchar(220) NOT NULL,
	`sourceType` varchar(100),
	`sourceId` int,
	`documentId` int,
	`status` enum('identified','collected','reviewed','excluded') NOT NULL DEFAULT 'identified',
	`analysis` text,
	`exclusionReason` text,
	`addedBy` int,
	`reviewedAt` bigint,
	`reviewedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `qualityReviewEvidence_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `qualityReviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int,
	`title` varchar(220) NOT NULL,
	`periodStart` bigint NOT NULL,
	`periodEnd` bigint NOT NULL,
	`ownerUserId` int,
	`status` enum('draft','consultation','evidence_review','report_draft','approved','submitted','overdue','closed') NOT NULL DEFAULT 'draft',
	`methodology` text,
	`strengths` text,
	`shortfalls` text,
	`outcomesSummary` text,
	`youngPeopleSummary` text,
	`consultationSummary` text,
	`managementEvaluation` text,
	`completedAt` bigint,
	`completedBy` int,
	`approvedAt` bigint,
	`approvedBy` int,
	`reportDocumentId` int,
	`submissionDueAt` bigint,
	`submittedAt` bigint,
	`submittedBy` int,
	`submissionReference` varchar(180),
	`submissionMethod` enum('email','portal','secure_link','post','other'),
	`submissionEvidenceDocumentId` int,
	`nextReviewDueAt` bigint,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `qualityReviews_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recordCorrections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`caseId` int,
	`placementId` int,
	`resourceType` varchar(80) NOT NULL,
	`resourceId` varchar(80) NOT NULL,
	`fieldPath` varchar(240) NOT NULL,
	`originalValueHash` varchar(128) NOT NULL,
	`originalValueCiphertext` text,
	`correctedValueCiphertext` text NOT NULL,
	`reason` text NOT NULL,
	`affectedOutputs` json,
	`notificationRecipients` json,
	`status` enum('proposed','approved','applied','rejected','superseded') NOT NULL DEFAULT 'proposed',
	`approvedBy` int,
	`appliedBy` int,
	`appliedAt` bigint,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `recordCorrections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recordDocumentLinks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`documentId` int NOT NULL,
	`resourceType` varchar(80) NOT NULL,
	`resourceId` varchar(80) NOT NULL,
	`linkType` enum('evidence','photo','id_document','receipt','certificate','statement','completion','other') NOT NULL,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `recordDocumentLinks_id` PRIMARY KEY(`id`),
	CONSTRAINT `record_document_link_uq` UNIQUE(`documentId`,`resourceType`,`resourceId`,`linkType`)
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
CREATE TABLE `redactionDecisions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`caseId` int NOT NULL,
	`resourceType` varchar(80) NOT NULL,
	`resourceId` varchar(80) NOT NULL,
	`fieldPath` varchar(240),
	`documentId` int,
	`decision` enum('disclose','redact','withhold','partial') NOT NULL,
	`exemptionBasis` text,
	`rationale` text NOT NULL,
	`status` enum('draft','pending_review','approved','returned') NOT NULL DEFAULT 'draft',
	`reviewedBy` int,
	`reviewedAt` bigint,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `redactionDecisions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `referenceOptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int,
	`category` varchar(100) NOT NULL,
	`value` varchar(120) NOT NULL,
	`label` varchar(180) NOT NULL,
	`description` text,
	`sortOrder` int NOT NULL DEFAULT 0,
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `referenceOptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `reference_option_uq` UNIQUE(`entityId`,`category`,`value`)
);
--> statement-breakpoint
CREATE TABLE `regulatoryRegimes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int,
	`name` varchar(220) NOT NULL,
	`jurisdiction` varchar(120) NOT NULL,
	`regulator` varchar(180),
	`sourceUrl` text,
	`effectiveFrom` bigint NOT NULL,
	`effectiveTo` bigint,
	`applicability` json NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`status` enum('draft','in_review','approved','active','superseded','withdrawn') NOT NULL DEFAULT 'draft',
	`supersedesId` int,
	`approvedBy` int,
	`approvedAt` bigint,
	`activatedBy` int,
	`activatedAt` bigint,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `regulatoryRegimes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `residentFinanceAccounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`placementId` int NOT NULL,
	`accountType` enum('cash_allowance','savings','personal_budget','petty_cash','other') NOT NULL,
	`name` varchar(180) NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'GBP',
	`balance` decimal(12,2) NOT NULL DEFAULT '0.00',
	`status` enum('active','frozen','closed') NOT NULL DEFAULT 'active',
	`version` int NOT NULL DEFAULT 1,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `residentFinanceAccounts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `residentFinanceDiscrepancies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`placementId` int NOT NULL,
	`accountId` int NOT NULL,
	`transactionId` int,
	`reconciliationId` int,
	`workPlanActionId` int,
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
	`workPlanActionId` int,
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
CREATE TABLE `residentFinanceTransactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`placementId` int NOT NULL,
	`accountId` int NOT NULL,
	`transactionType` enum('deposit','withdrawal','purchase','refund','adjustment','reversal') NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`balanceAfter` decimal(12,2) NOT NULL,
	`purposeCiphertext` text NOT NULL,
	`counterpartyCiphertext` text,
	`receiptDocumentId` int,
	`occurredAt` bigint NOT NULL,
	`status` enum('draft','submitted','approved','returned','reversed') NOT NULL DEFAULT 'submitted',
	`reviewNotesCiphertext` text,
	`approvedBy` int,
	`approvedAt` bigint,
	`reversedBy` int,
	`reversedAt` bigint,
	`reversalReasonCiphertext` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `residentFinanceTransactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `residentValuables` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`placementId` int NOT NULL,
	`reference` varchar(80) NOT NULL,
	`descriptionCiphertext` text NOT NULL,
	`quantity` int NOT NULL DEFAULT 1,
	`receivedAt` bigint NOT NULL,
	`releasedAt` bigint,
	`status` enum('held','released','missing','disposed') NOT NULL DEFAULT 'held',
	`witnessUserId` int,
	`documentId` int,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `residentValuables_id` PRIMARY KEY(`id`),
	CONSTRAINT `resident_valuable_reference_uq` UNIQUE(`entityId`,`reference`)
);
--> statement-breakpoint
CREATE TABLE `resilienceChecks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int,
	`checkType` enum('backup','restore','database','object_storage','notification','integration','scheduled_job','audit_chain','security_monitoring') NOT NULL,
	`title` varchar(220) NOT NULL,
	`ownerUserId` int,
	`status` enum('planned','due','running','passed','warning','failed','waived') NOT NULL DEFAULT 'planned',
	`frequencyDays` int,
	`lastCheckedAt` bigint,
	`nextDueAt` bigint,
	`durationMs` int,
	`evidenceDocumentId` int,
	`resultSummary` text,
	`details` json,
	`correctiveWorkPlanId` int,
	`completedBy` int,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `resilienceChecks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `restraintEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`placementId` int NOT NULL,
	`incidentId` int,
	`interventionType` enum('physical','environmental','withdrawal','other') NOT NULL,
	`startedAt` bigint NOT NULL,
	`endedAt` bigint NOT NULL,
	`necessityCiphertext` text NOT NULL,
	`proportionalityCiphertext` text NOT NULL,
	`techniques` json,
	`injuriesCiphertext` text,
	`medicalAttention` enum('none','first_aid','nhs_111','ambulance','a_and_e','gp','other') NOT NULL DEFAULT 'none',
	`witnesses` json,
	`youngPersonDebriefAt` bigint,
	`youngPersonFeedbackCiphertext` text,
	`staffDebriefAt` bigint,
	`staffDebriefCiphertext` text,
	`notifications` json,
	`managementReview` enum('pending','appropriate','learning_required','concern','escalated') NOT NULL DEFAULT 'pending',
	`reviewNotesCiphertext` text,
	`reviewedBy` int,
	`reviewedAt` bigint,
	`status` enum('draft','submitted','under_review','reviewed','closed') NOT NULL DEFAULT 'submitted',
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `restraintEvents_id` PRIMARY KEY(`id`)
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
CREATE TABLE `scheduledActivities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`placementId` int NOT NULL,
	`activityType` enum('college','education','court','probation','health','professional','contact','other') NOT NULL,
	`title` varchar(220) NOT NULL,
	`organisation` varchar(220),
	`contactName` varchar(180),
	`contactPhone` varchar(40),
	`contactEmail` varchar(320),
	`scheduledStart` bigint NOT NULL,
	`scheduledEnd` bigint,
	`actualArrival` bigint,
	`actualDeparture` bigint,
	`attendanceStatus` enum('scheduled','attended','late','did_not_attend','cancelled_by_service','cancelled_by_young_person','rescheduled','not_required') NOT NULL DEFAULT 'scheduled',
	`transport` enum('independent','staff','taxi','public_transport','family','authority','other'),
	`outcomeCiphertext` text,
	`followUpCiphertext` text,
	`evidenceDocumentId` int,
	`acknowledgementRequired` int NOT NULL DEFAULT 1,
	`acknowledgedBy` int,
	`acknowledgedAt` bigint,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scheduledActivities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `secureLinks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`providerPackId` int,
	`documentId` int,
	`invoiceId` int,
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
CREATE TABLE `sharingDecisions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`caseId` int,
	`placementId` int,
	`purpose` text NOT NULL,
	`lawfulBasis` varchar(160) NOT NULL,
	`specialCategoryCondition` varchar(200),
	`criminalDataCondition` varchar(200),
	`necessityAssessment` text NOT NULL,
	`proportionalityAssessment` text NOT NULL,
	`minimumFields` json NOT NULL,
	`recipientsCiphertext` text NOT NULL,
	`status` enum('draft','pending_approval','approved','shared','refused','expired','revoked') NOT NULL DEFAULT 'draft',
	`approvedBy` int,
	`approvedAt` bigint,
	`expiresAt` bigint,
	`revokedBy` int,
	`revokedAt` bigint,
	`revocationReason` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sharingDecisions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shiftBreaks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`shiftId` int NOT NULL,
	`userId` int NOT NULL,
	`startClockEventId` int,
	`endClockEventId` int,
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
CREATE TABLE `shiftChangeAcknowledgements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`shiftChangeEventId` int NOT NULL,
	`userId` int NOT NULL,
	`status` enum('unread','read','acknowledged','escalated') NOT NULL DEFAULT 'unread',
	`readAt` bigint,
	`acknowledgedAt` bigint,
	`escalatedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `shiftChangeAcknowledgements_id` PRIMARY KEY(`id`),
	CONSTRAINT `shift_change_ack_uq` UNIQUE(`shiftChangeEventId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `shiftChangeEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`shiftId` int NOT NULL,
	`eventType` enum('created','edited','cancelled','reassigned','opened','additional','replacement','emergency','completed') NOT NULL,
	`reasonKey` varchar(120),
	`reason` text,
	`previousSnapshot` json,
	`newSnapshot` json,
	`affectedUserId` int,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `shiftChangeEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
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
CREATE TABLE `staffAvailability` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`staffProfileId` int NOT NULL,
	`propertyId` int,
	`availabilityType` enum('available','unavailable','preferred','annual_leave','sickness','training','agency_constraint','other') NOT NULL,
	`startsAt` bigint NOT NULL,
	`endsAt` bigint NOT NULL,
	`recurrence` json,
	`preferenceLevel` enum('required','strong','normal','avoid') NOT NULL DEFAULT 'normal',
	`reason` varchar(500),
	`status` enum('draft','active','approved','cancelled','expired') NOT NULL DEFAULT 'active',
	`approvedBy` int,
	`approvedAt` bigint,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `staffAvailability_id` PRIMARY KEY(`id`)
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
CREATE TABLE `staffRequests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`staffProfileId` int NOT NULL,
	`userId` int NOT NULL,
	`requestType` enum('contact_change','certificate_submission','sickness','holiday','availability_change') NOT NULL,
	`startsAt` bigint,
	`endsAt` bigint,
	`detailsCiphertext` text NOT NULL,
	`proposedChanges` json,
	`evidenceDocumentId` int,
	`status` enum('draft','submitted','approved','declined','returned','withdrawn') NOT NULL DEFAULT 'submitted',
	`reviewNotesCiphertext` text,
	`reviewedBy` int,
	`reviewedAt` bigint,
	`version` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `staffRequests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `standardTextSnippets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`category` varchar(100) NOT NULL,
	`title` varchar(180) NOT NULL,
	`body` text NOT NULL,
	`placeholders` json,
	`version` int NOT NULL DEFAULT 1,
	`status` enum('draft','active','retired') NOT NULL DEFAULT 'draft',
	`reviewDueAt` bigint,
	`approvedBy` int,
	`approvedAt` bigint,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `standardTextSnippets_id` PRIMARY KEY(`id`),
	CONSTRAINT `standard_text_version_uq` UNIQUE(`entityId`,`category`,`title`,`version`)
);
--> statement-breakpoint
CREATE TABLE `statementArchives` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`localAuthorityId` int,
	`documentId` int NOT NULL,
	`generatedBy` int NOT NULL,
	`startAt` bigint NOT NULL,
	`endAt` bigint NOT NULL,
	`openingBalance` decimal(12,2) NOT NULL,
	`closingBalance` decimal(12,2) NOT NULL,
	`contentHash` varchar(128) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `statementArchives_id` PRIMARY KEY(`id`),
	CONSTRAINT `statement_archive_document_uq` UNIQUE(`documentId`)
);
--> statement-breakpoint
CREATE TABLE `supervisionSessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`staffProfileId` int NOT NULL,
	`managerUserId` int NOT NULL,
	`templateId` int,
	`scheduledAt` bigint NOT NULL,
	`completedAt` bigint,
	`location` varchar(220),
	`sharedNotesCiphertext` text,
	`managerNotesCiphertext` text,
	`actions` json,
	`acknowledgementRequired` int NOT NULL DEFAULT 1,
	`acknowledgedBy` int,
	`acknowledgedAt` bigint,
	`status` enum('scheduled','draft','submitted','acknowledged','completed','cancelled') NOT NULL DEFAULT 'scheduled',
	`version` int NOT NULL DEFAULT 1,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `supervisionSessions_id` PRIMARY KEY(`id`)
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
CREATE TABLE `temporaryLoginLinks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`targetUserId` int NOT NULL,
	`tokenHash` varchar(128) NOT NULL,
	`expiresAt` bigint NOT NULL,
	`redeemedAt` bigint,
	`revokedAt` bigint,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `temporaryLoginLinks_id` PRIMARY KEY(`id`),
	CONSTRAINT `temporary_login_link_token_uq` UNIQUE(`tokenHash`)
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
	`originalMinutes` int,
	`adjustedBy` int,
	`adjustedAt` bigint,
	`adjustmentReason` text,
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
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`operationalRole` enum('platform_admin','owner','registered_manager','support_worker','hr_compliance','finance','read_only') NOT NULL DEFAULT 'support_worker',
	`accountStatus` enum('invited','active','suspended') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
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
	`evidenceDocumentId` int,
	`reviewedAt` bigint,
	`reviewedBy` int,
	`reviewOutcome` enum('approved','returned'),
	`reviewNotes` text,
	`completedAt` bigint,
	`completedBy` int,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workPlanActions_id` PRIMARY KEY(`id`)
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
CREATE TABLE `workedShiftSummaries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`propertyId` int NOT NULL,
	`shiftId` int NOT NULL,
	`userId` int NOT NULL,
	`workerNameSnapshot` varchar(180) NOT NULL,
	`propertyNameSnapshot` varchar(220) NOT NULL,
	`scheduledMinutes` int NOT NULL,
	`clockedMinutes` int,
	`approvedMinutes` int,
	`staffingType` enum('standard','additional','replacement','emergency') NOT NULL,
	`replacedUserId` int,
	`shiftStatus` varchar(80) NOT NULL,
	`exceptionState` enum('none','missing_clock','off_site','overlap','policy_override','manual_adjustment') NOT NULL DEFAULT 'none',
	`payrollState` enum('not_ready','ready','approved','exported','reconciled') NOT NULL DEFAULT 'not_ready',
	`summaryGeneratedAt` bigint NOT NULL,
	`approvedBy` int,
	`approvedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workedShiftSummaries_id` PRIMARY KEY(`id`),
	CONSTRAINT `worked_shift_summary_uq` UNIQUE(`shiftId`,`userId`)
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
CREATE TABLE `workingTimeExceptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`shiftId` int NOT NULL,
	`userId` int NOT NULL,
	`policyId` int,
	`exceptionType` enum('availability','minimum_rest','maximum_shift','maximum_weekly','night_work','break','skill','placement_need','overlap','coverage') NOT NULL,
	`severity` enum('warning','block') NOT NULL DEFAULT 'warning',
	`detail` text NOT NULL,
	`overrideStatus` enum('not_requested','requested','approved','declined') NOT NULL DEFAULT 'not_requested',
	`overrideReason` text,
	`overrideBy` int,
	`overrideAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workingTimeExceptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `workingTimePolicies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entityId` int NOT NULL,
	`name` varchar(180) NOT NULL,
	`minimumRestHours` decimal(5,2) NOT NULL DEFAULT '11.00',
	`maximumShiftHours` decimal(5,2) NOT NULL DEFAULT '12.00',
	`maximumWeeklyHours` decimal(6,2) NOT NULL DEFAULT '48.00',
	`nightWindowStart` varchar(5) NOT NULL DEFAULT '23:00',
	`nightWindowEnd` varchar(5) NOT NULL DEFAULT '06:00',
	`maximumNightHours` decimal(5,2) NOT NULL DEFAULT '8.00',
	`breakAfterHours` decimal(5,2) NOT NULL DEFAULT '6.00',
	`breakMinutes` int NOT NULL DEFAULT 20,
	`allowManagerOverride` int NOT NULL DEFAULT 1,
	`effectiveFrom` bigint NOT NULL,
	`effectiveTo` bigint,
	`status` enum('draft','active','superseded','archived') NOT NULL DEFAULT 'draft',
	`createdBy` int,
	`approvedBy` int,
	`approvedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workingTimePolicies_id` PRIMARY KEY(`id`)
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
ALTER TABLE `allegationEvidence` ADD CONSTRAINT `allegationEvidence_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `allegationEvidence` ADD CONSTRAINT `allegationEvidence_allegationId_allegations_id_fk` FOREIGN KEY (`allegationId`) REFERENCES `allegations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `allegationEvidence` ADD CONSTRAINT `allegationEvidence_documentId_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `allegationEvidence` ADD CONSTRAINT `allegationEvidence_addedBy_users_id_fk` FOREIGN KEY (`addedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `allegations` ADD CONSTRAINT `allegations_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `allegations` ADD CONSTRAINT `allegations_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `allegations` ADD CONSTRAINT `allegations_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `allegations` ADD CONSTRAINT `allegations_incidentId_incidents_id_fk` FOREIGN KEY (`incidentId`) REFERENCES `incidents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `allegations` ADD CONSTRAINT `allegations_staffProfileId_staffProfiles_id_fk` FOREIGN KEY (`staffProfileId`) REFERENCES `staffProfiles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `allegations` ADD CONSTRAINT `allegations_restrictedOwnerUserId_users_id_fk` FOREIGN KEY (`restrictedOwnerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `allegations` ADD CONSTRAINT `allegations_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `analyticsMeasures` ADD CONSTRAINT `analyticsMeasures_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `analyticsMeasures` ADD CONSTRAINT `analyticsMeasures_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `analyticsMeasures` ADD CONSTRAINT `analyticsMeasures_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assuranceSchedules` ADD CONSTRAINT `assuranceSchedules_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assuranceSchedules` ADD CONSTRAINT `assuranceSchedules_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `auditLogs` ADD CONSTRAINT `auditLogs_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `auditLogs` ADD CONSTRAINT `auditLogs_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `auditLogs` ADD CONSTRAINT `auditLogs_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `auditReceiptMirrors` ADD CONSTRAINT `auditReceiptMirrors_auditEventId_auditLogs_id_fk` FOREIGN KEY (`auditEventId`) REFERENCES `auditLogs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `auditReceiptMirrors` ADD CONSTRAINT `auditReceiptMirrors_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `auditVerificationRuns` ADD CONSTRAINT `auditVerificationRuns_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `auditVerificationRuns` ADD CONSTRAINT `auditVerificationRuns_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `automationRules` ADD CONSTRAINT `automationRules_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `automationRules` ADD CONSTRAINT `automationRules_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `behaviourSupportEvents` ADD CONSTRAINT `behaviourSupportEvents_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `behaviourSupportEvents` ADD CONSTRAINT `behaviourSupportEvents_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `behaviourSupportEvents` ADD CONSTRAINT `behaviourSupportEvents_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `behaviourSupportEvents` ADD CONSTRAINT `behaviourSupportEvents_incidentId_incidents_id_fk` FOREIGN KEY (`incidentId`) REFERENCES `incidents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `behaviourSupportEvents` ADD CONSTRAINT `behaviourSupportEvents_supportPlanId_carePlans_id_fk` FOREIGN KEY (`supportPlanId`) REFERENCES `carePlans`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `behaviourSupportEvents` ADD CONSTRAINT `behaviourSupportEvents_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `behaviourSupportEvents` ADD CONSTRAINT `behaviourSupportEvents_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `carePlans` ADD CONSTRAINT `carePlans_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `carePlans` ADD CONSTRAINT `carePlans_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `carePlans` ADD CONSTRAINT `carePlans_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `carePlans` ADD CONSTRAINT `carePlans_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `clockEvents` ADD CONSTRAINT `clockEvents_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `clockEvents` ADD CONSTRAINT `clockEvents_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `clockEvents` ADD CONSTRAINT `clockEvents_shiftId_shifts_id_fk` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `clockEvents` ADD CONSTRAINT `clockEvents_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `clockEvents` ADD CONSTRAINT `clockEvents_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `colleagueInvitationPropertyGrants` ADD CONSTRAINT `colleagueInvitationPropertyGrants_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `colleagueInvitationPropertyGrants` ADD CONSTRAINT `colleague_invitation_grant_invitation_fk` FOREIGN KEY (`invitationId`) REFERENCES `colleagueInvitations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `colleagueInvitations` ADD CONSTRAINT `colleagueInvitations_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `colleagueInvitations` ADD CONSTRAINT `colleagueInvitations_acceptedByUserId_users_id_fk` FOREIGN KEY (`acceptedByUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `colleagueInvitations` ADD CONSTRAINT `colleagueInvitations_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `complaintEscalations` ADD CONSTRAINT `complaintEscalations_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `complaintEscalations` ADD CONSTRAINT `complaintEscalations_complaintId_complaints_id_fk` FOREIGN KEY (`complaintId`) REFERENCES `complaints`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `complaintEscalations` ADD CONSTRAINT `complaintEscalations_fromUserId_users_id_fk` FOREIGN KEY (`fromUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `complaintEscalations` ADD CONSTRAINT `complaintEscalations_toUserId_users_id_fk` FOREIGN KEY (`toUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `complaintEscalations` ADD CONSTRAINT `complaintEscalations_acknowledgedBy_users_id_fk` FOREIGN KEY (`acknowledgedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `complaints` ADD CONSTRAINT `complaints_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `complaints` ADD CONSTRAINT `complaints_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `complaints` ADD CONSTRAINT `complaints_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `complaints` ADD CONSTRAINT `complaints_incidentId_incidents_id_fk` FOREIGN KEY (`incidentId`) REFERENCES `incidents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `complaints` ADD CONSTRAINT `complaints_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `complaints` ADD CONSTRAINT `complaints_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `complianceObligations` ADD CONSTRAINT `complianceObligations_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `complianceObligations` ADD CONSTRAINT `complianceObligations_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `complianceObligations` ADD CONSTRAINT `complianceObligations_staffProfileId_staffProfiles_id_fk` FOREIGN KEY (`staffProfileId`) REFERENCES `staffProfiles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `complianceObligations` ADD CONSTRAINT `complianceObligations_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `complianceObligations` ADD CONSTRAINT `complianceObligations_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `complianceObligations` ADD CONSTRAINT `complianceObligations_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `creditNotes` ADD CONSTRAINT `creditNotes_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `creditNotes` ADD CONSTRAINT `creditNotes_invoiceId_invoices_id_fk` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `creditNotes` ADD CONSTRAINT `creditNotes_issuedBy_users_id_fk` FOREIGN KEY (`issuedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `creditNotes` ADD CONSTRAINT `creditNotes_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `curfewChecks` ADD CONSTRAINT `curfewChecks_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `curfewChecks` ADD CONSTRAINT `curfewChecks_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `curfewChecks` ADD CONSTRAINT `curfewChecks_curfewPlanId_curfewPlans_id_fk` FOREIGN KEY (`curfewPlanId`) REFERENCES `curfewPlans`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `curfewChecks` ADD CONSTRAINT `curfewChecks_acknowledgedBy_users_id_fk` FOREIGN KEY (`acknowledgedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `curfewChecks` ADD CONSTRAINT `curfewChecks_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `curfewPlans` ADD CONSTRAINT `curfewPlans_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `curfewPlans` ADD CONSTRAINT `curfewPlans_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `curfewPlans` ADD CONSTRAINT `curfewPlans_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dailyNotes` ADD CONSTRAINT `dailyNotes_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dailyNotes` ADD CONSTRAINT `dailyNotes_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dailyNotes` ADD CONSTRAINT `dailyNotes_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dailyNotes` ADD CONSTRAINT `dailyNotes_shiftId_shifts_id_fk` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dailyNotes` ADD CONSTRAINT `dailyNotes_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dailyNotes` ADD CONSTRAINT `dailyNotes_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dataRightsCases` ADD CONSTRAINT `dataRightsCases_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dataRightsCases` ADD CONSTRAINT `dataRightsCases_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dataRightsCases` ADD CONSTRAINT `dataRightsCases_identityEvidenceDocumentId_documents_id_fk` FOREIGN KEY (`identityEvidenceDocumentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dataRightsCases` ADD CONSTRAINT `dataRightsCases_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dataRightsCases` ADD CONSTRAINT `dataRightsCases_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dataRightsCases` ADD CONSTRAINT `dataRightsCases_exportJobId_exportJobs_id_fk` FOREIGN KEY (`exportJobId`) REFERENCES `exportJobs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dataRightsCases` ADD CONSTRAINT `dataRightsCases_deliveryDocumentId_documents_id_fk` FOREIGN KEY (`deliveryDocumentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dataRightsCases` ADD CONSTRAINT `dataRightsCases_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dataRightsCases` ADD CONSTRAINT `dataRightsCases_identityVerifiedBy_users_id_fk` FOREIGN KEY (`identityVerifiedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dataRightsEvents` ADD CONSTRAINT `dataRightsEvents_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dataRightsEvents` ADD CONSTRAINT `dataRightsEvents_caseId_dataRightsCases_id_fk` FOREIGN KEY (`caseId`) REFERENCES `dataRightsCases`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dataRightsEvents` ADD CONSTRAINT `dataRightsEvents_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documentFolders` ADD CONSTRAINT `documentFolders_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documentFolders` ADD CONSTRAINT `documentFolders_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documentScanJobs` ADD CONSTRAINT `documentScanJobs_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documentScanJobs` ADD CONSTRAINT `documentScanJobs_documentId_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documentScanJobs` ADD CONSTRAINT `documentScanJobs_documentVersionId_documentVersions_id_fk` FOREIGN KEY (`documentVersionId`) REFERENCES `documentVersions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documentScanJobs` ADD CONSTRAINT `documentScanJobs_overriddenBy_users_id_fk` FOREIGN KEY (`overriddenBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documentScanJobs` ADD CONSTRAINT `documentScanJobs_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documentTemplates` ADD CONSTRAINT `documentTemplates_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documentTemplates` ADD CONSTRAINT `documentTemplates_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documentVersions` ADD CONSTRAINT `documentVersions_documentId_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documentVersions` ADD CONSTRAINT `documentVersions_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documentVersions` ADD CONSTRAINT `documentVersions_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_folderId_documentFolders_id_fk` FOREIGN KEY (`folderId`) REFERENCES `documentFolders`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `eSignatureEnvelopes` ADD CONSTRAINT `eSignatureEnvelopes_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `eSignatureEnvelopes` ADD CONSTRAINT `eSignatureEnvelopes_connectionId_integrationConnections_id_fk` FOREIGN KEY (`connectionId`) REFERENCES `integrationConnections`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `eSignatureEnvelopes` ADD CONSTRAINT `eSignatureEnvelopes_documentId_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `eSignatureEnvelopes` ADD CONSTRAINT `eSignatureEnvelopes_documentVersionId_documentVersions_id_fk` FOREIGN KEY (`documentVersionId`) REFERENCES `documentVersions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `eSignatureEnvelopes` ADD CONSTRAINT `eSignatureEnvelopes_completionEvidenceDocumentId_documents_id_fk` FOREIGN KEY (`completionEvidenceDocumentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `eSignatureEnvelopes` ADD CONSTRAINT `eSignatureEnvelopes_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `eSignatureSigners` ADD CONSTRAINT `eSignatureSigners_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `eSignatureSigners` ADD CONSTRAINT `eSignatureSigners_envelopeId_eSignatureEnvelopes_id_fk` FOREIGN KEY (`envelopeId`) REFERENCES `eSignatureEnvelopes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE `entities` ADD CONSTRAINT `entities_bankDetailsUpdatedBy_users_id_fk` FOREIGN KEY (`bankDetailsUpdatedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entities` ADD CONSTRAINT `entities_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entityMemberships` ADD CONSTRAINT `entityMemberships_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entityMemberships` ADD CONSTRAINT `entityMemberships_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `entityMemberships` ADD CONSTRAINT `entityMemberships_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `evidenceFrameworks` ADD CONSTRAINT `evidenceFrameworks_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `evidenceFrameworks` ADD CONSTRAINT `evidenceFrameworks_regimeId_regulatoryRegimes_id_fk` FOREIGN KEY (`regimeId`) REFERENCES `regulatoryRegimes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `evidenceFrameworks` ADD CONSTRAINT `evidenceFrameworks_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `evidenceFrameworks` ADD CONSTRAINT `evidenceFrameworks_activatedBy_users_id_fk` FOREIGN KEY (`activatedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `evidenceFrameworks` ADD CONSTRAINT `evidenceFrameworks_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `exportJobs` ADD CONSTRAINT `exportJobs_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `exportJobs` ADD CONSTRAINT `exportJobs_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `exportJobs` ADD CONSTRAINT `exportJobs_documentId_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `exportJobs` ADD CONSTRAINT `exportJobs_requestedBy_users_id_fk` FOREIGN KEY (`requestedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `feeSchedules` ADD CONSTRAINT `feeSchedules_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `feeSchedules` ADD CONSTRAINT `feeSchedules_localAuthorityId_localAuthorities_id_fk` FOREIGN KEY (`localAuthorityId`) REFERENCES `localAuthorities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `feeSchedules` ADD CONSTRAINT `feeSchedules_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `feeSchedules` ADD CONSTRAINT `feeSchedules_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `frameworkPublications` ADD CONSTRAINT `frameworkPublications_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `frameworkPublications` ADD CONSTRAINT `frameworkPublications_frameworkId_evidenceFrameworks_id_fk` FOREIGN KEY (`frameworkId`) REFERENCES `evidenceFrameworks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `frameworkPublications` ADD CONSTRAINT `frameworkPublications_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `frameworkPublications` ADD CONSTRAINT `frameworkPublications_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `frameworkRequirements` ADD CONSTRAINT `frameworkRequirements_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `frameworkRequirements` ADD CONSTRAINT `frameworkRequirements_frameworkId_evidenceFrameworks_id_fk` FOREIGN KEY (`frameworkId`) REFERENCES `evidenceFrameworks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `frameworkRequirements` ADD CONSTRAINT `frameworkRequirements_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `guestInvitations` ADD CONSTRAINT `guestInvitations_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `guestInvitations` ADD CONSTRAINT `guestInvitations_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `guestInvitations` ADD CONSTRAINT `guestInvitations_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `handoverAcknowledgements` ADD CONSTRAINT `handoverAcknowledgements_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `handoverAcknowledgements` ADD CONSTRAINT `handoverAcknowledgements_handoverId_handovers_id_fk` FOREIGN KEY (`handoverId`) REFERENCES `handovers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `handoverAcknowledgements` ADD CONSTRAINT `handoverAcknowledgements_shiftId_shifts_id_fk` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `handoverAcknowledgements` ADD CONSTRAINT `handoverAcknowledgements_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `handoverReviewEvents` ADD CONSTRAINT `handoverReviewEvents_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `handoverReviewEvents` ADD CONSTRAINT `handoverReviewEvents_handoverId_handovers_id_fk` FOREIGN KEY (`handoverId`) REFERENCES `handovers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `handoverReviewEvents` ADD CONSTRAINT `handoverReviewEvents_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `handovers` ADD CONSTRAINT `handovers_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `handovers` ADD CONSTRAINT `handovers_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `handovers` ADD CONSTRAINT `handovers_shiftId_shifts_id_fk` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `handovers` ADD CONSTRAINT `handovers_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `handovers` ADD CONSTRAINT `handovers_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `handovers` ADD CONSTRAINT `handovers_acknowledgedBy_users_id_fk` FOREIGN KEY (`acknowledgedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `handovers` ADD CONSTRAINT `handovers_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `healthMonitoringEvents` ADD CONSTRAINT `healthMonitoringEvents_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `healthMonitoringEvents` ADD CONSTRAINT `healthMonitoringEvents_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `healthMonitoringEvents` ADD CONSTRAINT `healthMonitoringEvents_planId_healthMonitoringPlans_id_fk` FOREIGN KEY (`planId`) REFERENCES `healthMonitoringPlans`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `healthMonitoringEvents` ADD CONSTRAINT `healthMonitoringEvents_acknowledgedBy_users_id_fk` FOREIGN KEY (`acknowledgedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `healthMonitoringEvents` ADD CONSTRAINT `healthMonitoringEvents_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `healthMonitoringPlans` ADD CONSTRAINT `healthMonitoringPlans_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `healthMonitoringPlans` ADD CONSTRAINT `healthMonitoringPlans_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `healthMonitoringPlans` ADD CONSTRAINT `healthMonitoringPlans_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `identityAssuranceReviews` ADD CONSTRAINT `identityAssuranceReviews_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `identityAssuranceReviews` ADD CONSTRAINT `identityAssuranceReviews_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `identityAssuranceReviews` ADD CONSTRAINT `identityAssuranceReviews_evidenceDocumentId_documents_id_fk` FOREIGN KEY (`evidenceDocumentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `identityAssuranceReviews` ADD CONSTRAINT `identityAssuranceReviews_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `identityAssuranceReviews` ADD CONSTRAINT `identityAssuranceReviews_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `identityAssuranceReviews` ADD CONSTRAINT `identityAssuranceReviews_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidentChronology` ADD CONSTRAINT `incidentChronology_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidentChronology` ADD CONSTRAINT `incidentChronology_incidentId_incidents_id_fk` FOREIGN KEY (`incidentId`) REFERENCES `incidents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidentChronology` ADD CONSTRAINT `incidentChronology_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidentPeople` ADD CONSTRAINT `incidentPeople_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidentPeople` ADD CONSTRAINT `incidentPeople_incidentId_incidents_id_fk` FOREIGN KEY (`incidentId`) REFERENCES `incidents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidentPeople` ADD CONSTRAINT `incidentPeople_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidentPeople` ADD CONSTRAINT `incidentPeople_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidentPeople` ADD CONSTRAINT `incidentPeople_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidentReferences` ADD CONSTRAINT `incidentReferences_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidentReferences` ADD CONSTRAINT `incidentReferences_incidentId_incidents_id_fk` FOREIGN KEY (`incidentId`) REFERENCES `incidents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidentReferences` ADD CONSTRAINT `incidentReferences_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidentReviews` ADD CONSTRAINT `incidentReviews_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidentReviews` ADD CONSTRAINT `incidentReviews_incidentId_incidents_id_fk` FOREIGN KEY (`incidentId`) REFERENCES `incidents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidentReviews` ADD CONSTRAINT `incidentReviews_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidentWitnesses` ADD CONSTRAINT `incidentWitnesses_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidentWitnesses` ADD CONSTRAINT `incidentWitnesses_incidentId_incidents_id_fk` FOREIGN KEY (`incidentId`) REFERENCES `incidents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidentWitnesses` ADD CONSTRAINT `incidentWitnesses_witnessUserId_users_id_fk` FOREIGN KEY (`witnessUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidentWitnesses` ADD CONSTRAINT `incidentWitnesses_statementDocumentId_documents_id_fk` FOREIGN KEY (`statementDocumentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidentWitnesses` ADD CONSTRAINT `incidentWitnesses_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_managerUserId_users_id_fk` FOREIGN KEY (`managerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `integrationAttempts` ADD CONSTRAINT `integrationAttempts_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `integrationAttempts` ADD CONSTRAINT `integrationAttempts_deliveryId_integrationDeliveries_id_fk` FOREIGN KEY (`deliveryId`) REFERENCES `integrationDeliveries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `integrationConnections` ADD CONSTRAINT `integrationConnections_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `integrationConnections` ADD CONSTRAINT `integrationConnections_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `integrationConnections` ADD CONSTRAINT `integrationConnections_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `integrationDeliveries` ADD CONSTRAINT `integrationDeliveries_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `integrationDeliveries` ADD CONSTRAINT `integrationDeliveries_connectionId_integrationConnections_id_fk` FOREIGN KEY (`connectionId`) REFERENCES `integrationConnections`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `integrationDeliveries` ADD CONSTRAINT `integrationDeliveries_humanApprovedBy_users_id_fk` FOREIGN KEY (`humanApprovedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `integrationDeliveries` ADD CONSTRAINT `integrationDeliveries_exportDocumentId_documents_id_fk` FOREIGN KEY (`exportDocumentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `integrationDeliveries` ADD CONSTRAINT `integrationDeliveries_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `integrationReceipts` ADD CONSTRAINT `integrationReceipts_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `integrationReceipts` ADD CONSTRAINT `integrationReceipts_connectionId_integrationConnections_id_fk` FOREIGN KEY (`connectionId`) REFERENCES `integrationConnections`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `integrationReceipts` ADD CONSTRAINT `integrationReceipts_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE `invoiceEvents` ADD CONSTRAINT `invoiceEvents_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoiceEvents` ADD CONSTRAINT `invoiceEvents_invoiceId_invoices_id_fk` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoiceEvents` ADD CONSTRAINT `invoiceEvents_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoiceLines` ADD CONSTRAINT `invoiceLines_invoiceId_invoices_id_fk` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoiceLines` ADD CONSTRAINT `invoiceLines_feeScheduleId_feeSchedules_id_fk` FOREIGN KEY (`feeScheduleId`) REFERENCES `feeSchedules`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_localAuthorityId_localAuthorities_id_fk` FOREIGN KEY (`localAuthorityId`) REFERENCES `localAuthorities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_issuedBy_users_id_fk` FOREIGN KEY (`issuedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_pdfDocumentId_documents_id_fk` FOREIGN KEY (`pdfDocumentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyWorkerReportReviews` ADD CONSTRAINT `keyWorkerReportReviews_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyWorkerReportReviews` ADD CONSTRAINT `keyWorkerReportReviews_reportId_keyWorkerReports_id_fk` FOREIGN KEY (`reportId`) REFERENCES `keyWorkerReports`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyWorkerReportReviews` ADD CONSTRAINT `keyWorkerReportReviews_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyWorkerReportSources` ADD CONSTRAINT `keyWorkerReportSources_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyWorkerReportSources` ADD CONSTRAINT `keyWorkerReportSources_reportId_keyWorkerReports_id_fk` FOREIGN KEY (`reportId`) REFERENCES `keyWorkerReports`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyWorkerReportSources` ADD CONSTRAINT `keyWorkerReportSources_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyWorkerReports` ADD CONSTRAINT `keyWorkerReports_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyWorkerReports` ADD CONSTRAINT `keyWorkerReports_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyWorkerReports` ADD CONSTRAINT `keyWorkerReports_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyWorkerReports` ADD CONSTRAINT `keyWorkerReports_authorUserId_users_id_fk` FOREIGN KEY (`authorUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyWorkerReports` ADD CONSTRAINT `keyWorkerReports_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyWorkerReports` ADD CONSTRAINT `keyWorkerReports_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyWorkerReports` ADD CONSTRAINT `keyWorkerReports_lockedBy_users_id_fk` FOREIGN KEY (`lockedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyworkSessions` ADD CONSTRAINT `keyworkSessions_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyworkSessions` ADD CONSTRAINT `keyworkSessions_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyworkSessions` ADD CONSTRAINT `keyworkSessions_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyworkSessions` ADD CONSTRAINT `keyworkSessions_shiftId_shifts_id_fk` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyworkSessions` ADD CONSTRAINT `keyworkSessions_goalId_supportGoals_id_fk` FOREIGN KEY (`goalId`) REFERENCES `supportGoals`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyworkSessions` ADD CONSTRAINT `keyworkSessions_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `keyworkSessions` ADD CONSTRAINT `keyworkSessions_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `localAuthCredentials` ADD CONSTRAINT `localAuthCredentials_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `localAuthorities` ADD CONSTRAINT `localAuthorities_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `localAuthorities` ADD CONSTRAINT `localAuthorities_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loneWorkerCheckIns` ADD CONSTRAINT `loneWorkerCheckIns_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loneWorkerCheckIns` ADD CONSTRAINT `loneWorkerCheckIns_sessionId_loneWorkerSessions_id_fk` FOREIGN KEY (`sessionId`) REFERENCES `loneWorkerSessions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loneWorkerCheckIns` ADD CONSTRAINT `loneWorkerCheckIns_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loneWorkerSessions` ADD CONSTRAINT `loneWorkerSessions_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loneWorkerSessions` ADD CONSTRAINT `loneWorkerSessions_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loneWorkerSessions` ADD CONSTRAINT `loneWorkerSessions_shiftId_shifts_id_fk` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loneWorkerSessions` ADD CONSTRAINT `loneWorkerSessions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `loneWorkerSessions` ADD CONSTRAINT `loneWorkerSessions_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `maintenanceJobs` ADD CONSTRAINT `maintenanceJobs_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `maintenanceJobs` ADD CONSTRAINT `maintenanceJobs_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `maintenanceJobs` ADD CONSTRAINT `maintenanceJobs_unitId_propertyUnits_id_fk` FOREIGN KEY (`unitId`) REFERENCES `propertyUnits`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `maintenanceJobs` ADD CONSTRAINT `maintenanceJobs_propertyCheckId_propertyChecks_id_fk` FOREIGN KEY (`propertyCheckId`) REFERENCES `propertyChecks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `maintenanceJobs` ADD CONSTRAINT `maintenanceJobs_incidentId_incidents_id_fk` FOREIGN KEY (`incidentId`) REFERENCES `incidents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `maintenanceJobs` ADD CONSTRAINT `maintenanceJobs_assignedUserId_users_id_fk` FOREIGN KEY (`assignedUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `maintenanceJobs` ADD CONSTRAINT `maintenanceJobs_verifiedBy_users_id_fk` FOREIGN KEY (`verifiedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `maintenanceJobs` ADD CONSTRAINT `maintenanceJobs_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `maintenanceUpdates` ADD CONSTRAINT `maintenanceUpdates_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `maintenanceUpdates` ADD CONSTRAINT `maintenanceUpdates_maintenanceJobId_maintenanceJobs_id_fk` FOREIGN KEY (`maintenanceJobId`) REFERENCES `maintenanceJobs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `maintenanceUpdates` ADD CONSTRAINT `maintenanceUpdates_documentId_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `maintenanceUpdates` ADD CONSTRAINT `maintenanceUpdates_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationAdministrations` ADD CONSTRAINT `medicationAdministrations_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationAdministrations` ADD CONSTRAINT `medicationAdministrations_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationAdministrations` ADD CONSTRAINT `medicationAdministrations_medicationId_medications_id_fk` FOREIGN KEY (`medicationId`) REFERENCES `medications`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationAdministrations` ADD CONSTRAINT `medicationAdministrations_witnessUserId_users_id_fk` FOREIGN KEY (`witnessUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationAdministrations` ADD CONSTRAINT `medicationAdministrations_managerAcknowledgedBy_users_id_fk` FOREIGN KEY (`managerAcknowledgedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationAdministrations` ADD CONSTRAINT `medicationAdministrations_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationDiscrepancies` ADD CONSTRAINT `medicationDiscrepancies_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationDiscrepancies` ADD CONSTRAINT `medicationDiscrepancies_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationDiscrepancies` ADD CONSTRAINT `medicationDiscrepancies_medicationId_medications_id_fk` FOREIGN KEY (`medicationId`) REFERENCES `medications`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationDiscrepancies` ADD CONSTRAINT `medicationDiscrepancies_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationDiscrepancies` ADD CONSTRAINT `medicationDiscrepancies_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationDiscrepancies` ADD CONSTRAINT `fk_medicationDiscrepancies_administrationId_97aab9` FOREIGN KEY (`administrationId`) REFERENCES `medicationAdministrations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationDiscrepancies` ADD CONSTRAINT `fk_medicationDiscrepancies_stockTransactionId_897f8f` FOREIGN KEY (`stockTransactionId`) REFERENCES `medicationStockTransactions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationSelfAdministrationEvents` ADD CONSTRAINT `medicationSelfAdministrationEvents_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationSelfAdministrationEvents` ADD CONSTRAINT `medicationSelfAdministrationEvents_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationSelfAdministrationEvents` ADD CONSTRAINT `medicationSelfAdministrationEvents_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationSelfAdministrationEvents` ADD CONSTRAINT `medicationSelfAdministrationEvents_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationSelfAdministrationEvents` ADD CONSTRAINT `fk_medicationSelfAdministra_medicationId_061f4d` FOREIGN KEY (`medicationId`) REFERENCES `medications`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationSelfAdministrationEvents` ADD CONSTRAINT `fk_medicationSelfAdministra_administrationId_2863c8` FOREIGN KEY (`administrationId`) REFERENCES `medicationAdministrations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationSelfAdministrationEvents` ADD CONSTRAINT `fk_medicationSelfAdministra_stockTransactionId_9322aa` FOREIGN KEY (`stockTransactionId`) REFERENCES `medicationStockTransactions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationSelfAdministrationEvents` ADD CONSTRAINT `fk_medicationSelfAdministra_discrepancyId_abb526` FOREIGN KEY (`discrepancyId`) REFERENCES `medicationDiscrepancies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationStockTransactions` ADD CONSTRAINT `medicationStockTransactions_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationStockTransactions` ADD CONSTRAINT `medicationStockTransactions_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationStockTransactions` ADD CONSTRAINT `medicationStockTransactions_medicationId_medications_id_fk` FOREIGN KEY (`medicationId`) REFERENCES `medications`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationStockTransactions` ADD CONSTRAINT `medicationStockTransactions_witnessUserId_users_id_fk` FOREIGN KEY (`witnessUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationStockTransactions` ADD CONSTRAINT `medicationStockTransactions_documentId_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationStockTransactions` ADD CONSTRAINT `medicationStockTransactions_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationStockTransactions` ADD CONSTRAINT `medicationStockTransactions_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medicationStockTransactions` ADD CONSTRAINT `fk_medicationStockTransacti_administrationId_1c0c44` FOREIGN KEY (`administrationId`) REFERENCES `medicationAdministrations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medications` ADD CONSTRAINT `medications_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medications` ADD CONSTRAINT `medications_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `medications` ADD CONSTRAINT `medications_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `missingEpisodes` ADD CONSTRAINT `missingEpisodes_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `missingEpisodes` ADD CONSTRAINT `missingEpisodes_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `missingEpisodes` ADD CONSTRAINT `missingEpisodes_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `missingEpisodes` ADD CONSTRAINT `missingEpisodes_incidentId_incidents_id_fk` FOREIGN KEY (`incidentId`) REFERENCES `incidents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `missingEpisodes` ADD CONSTRAINT `missingEpisodes_managerUserId_users_id_fk` FOREIGN KEY (`managerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `missingEpisodes` ADD CONSTRAINT `missingEpisodes_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `missingEpisodes` ADD CONSTRAINT `missingEpisodes_returnRecordedBy_users_id_fk` FOREIGN KEY (`returnRecordedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `missingEpisodes` ADD CONSTRAINT `missingEpisodes_returnInterviewBy_users_id_fk` FOREIGN KEY (`returnInterviewBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notificationChannelDeliveries` ADD CONSTRAINT `notificationChannelDeliveries_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notificationChannelDeliveries` ADD CONSTRAINT `notificationChannelDeliveries_notificationId_notifications_id_fk` FOREIGN KEY (`notificationId`) REFERENCES `notifications`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notificationChannelDeliveries` ADD CONSTRAINT `notificationChannelDeliveries_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notificationChannelDeliveries` ADD CONSTRAINT `fk_notificationChannelDeliv_providerConnectionId_6a2c68` FOREIGN KEY (`providerConnectionId`) REFERENCES `integrationConnections`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `occupancyEvents` ADD CONSTRAINT `occupancyEvents_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `occupancyEvents` ADD CONSTRAINT `occupancyEvents_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `occupancyEvents` ADD CONSTRAINT `occupancyEvents_unitId_propertyUnits_id_fk` FOREIGN KEY (`unitId`) REFERENCES `propertyUnits`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `occupancyEvents` ADD CONSTRAINT `occupancyEvents_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `occupancyEvents` ADD CONSTRAINT `occupancyEvents_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `offlineSyncReceipts` ADD CONSTRAINT `offlineSyncReceipts_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `offlineSyncReceipts` ADD CONSTRAINT `offlineSyncReceipts_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `outcomeObservations` ADD CONSTRAINT `outcomeObservations_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `outcomeObservations` ADD CONSTRAINT `outcomeObservations_measureId_analyticsMeasures_id_fk` FOREIGN KEY (`measureId`) REFERENCES `analyticsMeasures`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `outcomeObservations` ADD CONSTRAINT `outcomeObservations_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `outcomeObservations` ADD CONSTRAINT `outcomeObservations_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `outcomeObservations` ADD CONSTRAINT `outcomeObservations_evidenceDocumentId_documents_id_fk` FOREIGN KEY (`evidenceDocumentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `outcomeObservations` ADD CONSTRAINT `outcomeObservations_capturedBy_users_id_fk` FOREIGN KEY (`capturedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_invoiceId_invoices_id_fk` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_recordedBy_users_id_fk` FOREIGN KEY (`recordedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placementNotifications` ADD CONSTRAINT `placementNotifications_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placementNotifications` ADD CONSTRAINT `placementNotifications_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placementNotifications` ADD CONSTRAINT `placementNotifications_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placementNotifications` ADD CONSTRAINT `placementNotifications_placingAuthorityId_localAuthorities_id_fk` FOREIGN KEY (`placingAuthorityId`) REFERENCES `localAuthorities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placementNotifications` ADD CONSTRAINT `placementNotifications_hostAuthorityId_localAuthorities_id_fk` FOREIGN KEY (`hostAuthorityId`) REFERENCES `localAuthorities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placementNotifications` ADD CONSTRAINT `placementNotifications_packDocumentId_documents_id_fk` FOREIGN KEY (`packDocumentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placementNotifications` ADD CONSTRAINT `placementNotifications_submittedBy_users_id_fk` FOREIGN KEY (`submittedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placementNotifications` ADD CONSTRAINT `placementNotifications_decisionBy_users_id_fk` FOREIGN KEY (`decisionBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placementNotifications` ADD CONSTRAINT `placementNotifications_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placementNotifications` ADD CONSTRAINT `fk_placementNotifications_submissionEvidenceDo_fd1b8b` FOREIGN KEY (`submissionEvidenceDocumentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placementNotifications` ADD CONSTRAINT `fk_placementNotifications_receivingAuthorityId_c6f136` FOREIGN KEY (`receivingAuthorityId`) REFERENCES `localAuthorities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placements` ADD CONSTRAINT `placements_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placements` ADD CONSTRAINT `placements_youngPersonId_youngPeople_id_fk` FOREIGN KEY (`youngPersonId`) REFERENCES `youngPeople`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placements` ADD CONSTRAINT `placements_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placements` ADD CONSTRAINT `placements_localAuthorityId_localAuthorities_id_fk` FOREIGN KEY (`localAuthorityId`) REFERENCES `localAuthorities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `placements` ADD CONSTRAINT `placements_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `policyAcknowledgements` ADD CONSTRAINT `policyAcknowledgements_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `policyAcknowledgements` ADD CONSTRAINT `policyAcknowledgements_documentId_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `policyAcknowledgements` ADD CONSTRAINT `policyAcknowledgements_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `processingRestrictions` ADD CONSTRAINT `processingRestrictions_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `processingRestrictions` ADD CONSTRAINT `processingRestrictions_caseId_dataRightsCases_id_fk` FOREIGN KEY (`caseId`) REFERENCES `dataRightsCases`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `processingRestrictions` ADD CONSTRAINT `processingRestrictions_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `processingRestrictions` ADD CONSTRAINT `processingRestrictions_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `processingRestrictions` ADD CONSTRAINT `processingRestrictions_liftedBy_users_id_fk` FOREIGN KEY (`liftedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `processingRestrictions` ADD CONSTRAINT `processingRestrictions_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalContacts` ADD CONSTRAINT `professionalContacts_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalContacts` ADD CONSTRAINT `professionalContacts_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `professionalContacts` ADD CONSTRAINT `professionalContacts_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `properties` ADD CONSTRAINT `properties_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `properties` ADD CONSTRAINT `properties_managerUserId_users_id_fk` FOREIGN KEY (`managerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `properties` ADD CONSTRAINT `properties_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyAssignments` ADD CONSTRAINT `propertyAssignments_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyAssignments` ADD CONSTRAINT `propertyAssignments_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyAssignments` ADD CONSTRAINT `propertyAssignments_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyAssignments` ADD CONSTRAINT `propertyAssignments_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyChecks` ADD CONSTRAINT `propertyChecks_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyChecks` ADD CONSTRAINT `propertyChecks_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyChecks` ADD CONSTRAINT `propertyChecks_unitId_propertyUnits_id_fk` FOREIGN KEY (`unitId`) REFERENCES `propertyUnits`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyChecks` ADD CONSTRAINT `propertyChecks_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyChecks` ADD CONSTRAINT `propertyChecks_shiftId_shifts_id_fk` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyChecks` ADD CONSTRAINT `propertyChecks_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyChecks` ADD CONSTRAINT `propertyChecks_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyEvidence` ADD CONSTRAINT `propertyEvidence_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyEvidence` ADD CONSTRAINT `propertyEvidence_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyEvidence` ADD CONSTRAINT `propertyEvidence_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyEvidence` ADD CONSTRAINT `propertyEvidence_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyPresenceEvents` ADD CONSTRAINT `propertyPresenceEvents_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyPresenceEvents` ADD CONSTRAINT `propertyPresenceEvents_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyPresenceEvents` ADD CONSTRAINT `propertyPresenceEvents_shiftId_shifts_id_fk` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyPresenceEvents` ADD CONSTRAINT `propertyPresenceEvents_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyPresenceEvents` ADD CONSTRAINT `propertyPresenceEvents_visitorId_propertyVisitors_id_fk` FOREIGN KEY (`visitorId`) REFERENCES `propertyVisitors`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyPresenceEvents` ADD CONSTRAINT `propertyPresenceEvents_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyPresenceEvents` ADD CONSTRAINT `propertyPresenceEvents_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyUnits` ADD CONSTRAINT `propertyUnits_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyUnits` ADD CONSTRAINT `propertyUnits_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyUnits` ADD CONSTRAINT `propertyUnits_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyVisitors` ADD CONSTRAINT `propertyVisitors_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyVisitors` ADD CONSTRAINT `propertyVisitors_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyVisitors` ADD CONSTRAINT `propertyVisitors_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyVisitors` ADD CONSTRAINT `propertyVisitors_identityDocumentId_documents_id_fk` FOREIGN KEY (`identityDocumentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyVisitors` ADD CONSTRAINT `propertyVisitors_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `providerPacks` ADD CONSTRAINT `providerPacks_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `providerPacks` ADD CONSTRAINT `providerPacks_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `providerPacks` ADD CONSTRAINT `providerPacks_localAuthorityId_localAuthorities_id_fk` FOREIGN KEY (`localAuthorityId`) REFERENCES `localAuthorities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `providerPacks` ADD CONSTRAINT `providerPacks_documentId_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `providerPacks` ADD CONSTRAINT `providerPacks_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualityReviewConsultations` ADD CONSTRAINT `qualityReviewConsultations_qualityReviewId_qualityReviews_id_fk` FOREIGN KEY (`qualityReviewId`) REFERENCES `qualityReviews`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualityReviewConsultations` ADD CONSTRAINT `qualityReviewConsultations_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualityReviewConsultations` ADD CONSTRAINT `qualityReviewConsultations_evidenceDocumentId_documents_id_fk` FOREIGN KEY (`evidenceDocumentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualityReviewConsultations` ADD CONSTRAINT `qualityReviewConsultations_recordedBy_users_id_fk` FOREIGN KEY (`recordedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualityReviewEvidence` ADD CONSTRAINT `qualityReviewEvidence_qualityReviewId_qualityReviews_id_fk` FOREIGN KEY (`qualityReviewId`) REFERENCES `qualityReviews`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualityReviewEvidence` ADD CONSTRAINT `qualityReviewEvidence_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualityReviewEvidence` ADD CONSTRAINT `qualityReviewEvidence_documentId_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualityReviewEvidence` ADD CONSTRAINT `qualityReviewEvidence_addedBy_users_id_fk` FOREIGN KEY (`addedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualityReviewEvidence` ADD CONSTRAINT `qualityReviewEvidence_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualityReviews` ADD CONSTRAINT `qualityReviews_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualityReviews` ADD CONSTRAINT `qualityReviews_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualityReviews` ADD CONSTRAINT `qualityReviews_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualityReviews` ADD CONSTRAINT `qualityReviews_completedBy_users_id_fk` FOREIGN KEY (`completedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualityReviews` ADD CONSTRAINT `qualityReviews_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualityReviews` ADD CONSTRAINT `qualityReviews_reportDocumentId_documents_id_fk` FOREIGN KEY (`reportDocumentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualityReviews` ADD CONSTRAINT `qualityReviews_submittedBy_users_id_fk` FOREIGN KEY (`submittedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualityReviews` ADD CONSTRAINT `qualityReviews_submissionEvidenceDocumentId_documents_id_fk` FOREIGN KEY (`submissionEvidenceDocumentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `qualityReviews` ADD CONSTRAINT `qualityReviews_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recordCorrections` ADD CONSTRAINT `recordCorrections_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recordCorrections` ADD CONSTRAINT `recordCorrections_caseId_dataRightsCases_id_fk` FOREIGN KEY (`caseId`) REFERENCES `dataRightsCases`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recordCorrections` ADD CONSTRAINT `recordCorrections_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recordCorrections` ADD CONSTRAINT `recordCorrections_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recordCorrections` ADD CONSTRAINT `recordCorrections_appliedBy_users_id_fk` FOREIGN KEY (`appliedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recordCorrections` ADD CONSTRAINT `recordCorrections_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recordDocumentLinks` ADD CONSTRAINT `recordDocumentLinks_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recordDocumentLinks` ADD CONSTRAINT `recordDocumentLinks_documentId_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recordDocumentLinks` ADD CONSTRAINT `recordDocumentLinks_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recordLinks` ADD CONSTRAINT `recordLinks_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recordLinks` ADD CONSTRAINT `recordLinks_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recordShortcuts` ADD CONSTRAINT `recordShortcuts_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recordShortcuts` ADD CONSTRAINT `recordShortcuts_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `redactionDecisions` ADD CONSTRAINT `redactionDecisions_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `redactionDecisions` ADD CONSTRAINT `redactionDecisions_caseId_dataRightsCases_id_fk` FOREIGN KEY (`caseId`) REFERENCES `dataRightsCases`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `redactionDecisions` ADD CONSTRAINT `redactionDecisions_documentId_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `redactionDecisions` ADD CONSTRAINT `redactionDecisions_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `redactionDecisions` ADD CONSTRAINT `redactionDecisions_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `referenceOptions` ADD CONSTRAINT `referenceOptions_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `referenceOptions` ADD CONSTRAINT `referenceOptions_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `regulatoryRegimes` ADD CONSTRAINT `regulatoryRegimes_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `regulatoryRegimes` ADD CONSTRAINT `regulatoryRegimes_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `regulatoryRegimes` ADD CONSTRAINT `regulatoryRegimes_activatedBy_users_id_fk` FOREIGN KEY (`activatedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `regulatoryRegimes` ADD CONSTRAINT `regulatoryRegimes_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceAccounts` ADD CONSTRAINT `residentFinanceAccounts_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceAccounts` ADD CONSTRAINT `residentFinanceAccounts_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceAccounts` ADD CONSTRAINT `residentFinanceAccounts_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceDiscrepancies` ADD CONSTRAINT `residentFinanceDiscrepancies_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceDiscrepancies` ADD CONSTRAINT `residentFinanceDiscrepancies_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceDiscrepancies` ADD CONSTRAINT `residentFinanceDiscrepancies_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceDiscrepancies` ADD CONSTRAINT `residentFinanceDiscrepancies_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceDiscrepancies` ADD CONSTRAINT `fk_residentFinanceDiscrepan_accountId_21b03f` FOREIGN KEY (`accountId`) REFERENCES `residentFinanceAccounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceDiscrepancies` ADD CONSTRAINT `fk_residentFinanceDiscrepan_transactionId_9a1d45` FOREIGN KEY (`transactionId`) REFERENCES `residentFinanceTransactions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceDiscrepancies` ADD CONSTRAINT `fk_residentFinanceDiscrepan_reconciliationId_a9ec8d` FOREIGN KEY (`reconciliationId`) REFERENCES `residentFinanceReconciliations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceDiscrepancies` ADD CONSTRAINT `fk_residentFinanceDiscrepan_workPlanActionId_b31174` FOREIGN KEY (`workPlanActionId`) REFERENCES `workPlanActions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceReconciliations` ADD CONSTRAINT `residentFinanceReconciliations_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceReconciliations` ADD CONSTRAINT `residentFinanceReconciliations_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceReconciliations` ADD CONSTRAINT `residentFinanceReconciliations_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceReconciliations` ADD CONSTRAINT `residentFinanceReconciliations_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceReconciliations` ADD CONSTRAINT `fk_residentFinanceReconcili_accountId_0fa85f` FOREIGN KEY (`accountId`) REFERENCES `residentFinanceAccounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceReconciliations` ADD CONSTRAINT `fk_residentFinanceReconcili_workPlanActionId_8dbfa6` FOREIGN KEY (`workPlanActionId`) REFERENCES `workPlanActions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceTransactions` ADD CONSTRAINT `residentFinanceTransactions_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceTransactions` ADD CONSTRAINT `residentFinanceTransactions_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceTransactions` ADD CONSTRAINT `residentFinanceTransactions_receiptDocumentId_documents_id_fk` FOREIGN KEY (`receiptDocumentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceTransactions` ADD CONSTRAINT `residentFinanceTransactions_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceTransactions` ADD CONSTRAINT `residentFinanceTransactions_reversedBy_users_id_fk` FOREIGN KEY (`reversedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceTransactions` ADD CONSTRAINT `residentFinanceTransactions_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentFinanceTransactions` ADD CONSTRAINT `fk_residentFinanceTransacti_accountId_b1ab25` FOREIGN KEY (`accountId`) REFERENCES `residentFinanceAccounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentValuables` ADD CONSTRAINT `residentValuables_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentValuables` ADD CONSTRAINT `residentValuables_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentValuables` ADD CONSTRAINT `residentValuables_witnessUserId_users_id_fk` FOREIGN KEY (`witnessUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentValuables` ADD CONSTRAINT `residentValuables_documentId_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `residentValuables` ADD CONSTRAINT `residentValuables_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resilienceChecks` ADD CONSTRAINT `resilienceChecks_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resilienceChecks` ADD CONSTRAINT `resilienceChecks_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resilienceChecks` ADD CONSTRAINT `resilienceChecks_evidenceDocumentId_documents_id_fk` FOREIGN KEY (`evidenceDocumentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resilienceChecks` ADD CONSTRAINT `resilienceChecks_correctiveWorkPlanId_workPlanActions_id_fk` FOREIGN KEY (`correctiveWorkPlanId`) REFERENCES `workPlanActions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resilienceChecks` ADD CONSTRAINT `resilienceChecks_completedBy_users_id_fk` FOREIGN KEY (`completedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resilienceChecks` ADD CONSTRAINT `resilienceChecks_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `restraintEvents` ADD CONSTRAINT `restraintEvents_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `restraintEvents` ADD CONSTRAINT `restraintEvents_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `restraintEvents` ADD CONSTRAINT `restraintEvents_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `restraintEvents` ADD CONSTRAINT `restraintEvents_incidentId_incidents_id_fk` FOREIGN KEY (`incidentId`) REFERENCES `incidents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `restraintEvents` ADD CONSTRAINT `restraintEvents_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `restraintEvents` ADD CONSTRAINT `restraintEvents_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `retentionReviews` ADD CONSTRAINT `retentionReviews_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `retentionReviews` ADD CONSTRAINT `retentionReviews_requestedBy_users_id_fk` FOREIGN KEY (`requestedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `retentionReviews` ADD CONSTRAINT `retentionReviews_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `safeguardingConcerns` ADD CONSTRAINT `safeguardingConcerns_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `safeguardingConcerns` ADD CONSTRAINT `safeguardingConcerns_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `safeguardingConcerns` ADD CONSTRAINT `safeguardingConcerns_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `safeguardingConcerns` ADD CONSTRAINT `safeguardingConcerns_incidentId_incidents_id_fk` FOREIGN KEY (`incidentId`) REFERENCES `incidents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `safeguardingConcerns` ADD CONSTRAINT `safeguardingConcerns_complaintId_complaints_id_fk` FOREIGN KEY (`complaintId`) REFERENCES `complaints`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `safeguardingConcerns` ADD CONSTRAINT `safeguardingConcerns_allegationId_allegations_id_fk` FOREIGN KEY (`allegationId`) REFERENCES `allegations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `safeguardingConcerns` ADD CONSTRAINT `safeguardingConcerns_restrictedOwnerUserId_users_id_fk` FOREIGN KEY (`restrictedOwnerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `safeguardingConcerns` ADD CONSTRAINT `safeguardingConcerns_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `savedViews` ADD CONSTRAINT `savedViews_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `savedViews` ADD CONSTRAINT `savedViews_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scheduledActivities` ADD CONSTRAINT `scheduledActivities_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scheduledActivities` ADD CONSTRAINT `scheduledActivities_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scheduledActivities` ADD CONSTRAINT `scheduledActivities_evidenceDocumentId_documents_id_fk` FOREIGN KEY (`evidenceDocumentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scheduledActivities` ADD CONSTRAINT `scheduledActivities_acknowledgedBy_users_id_fk` FOREIGN KEY (`acknowledgedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `scheduledActivities` ADD CONSTRAINT `scheduledActivities_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `secureLinks` ADD CONSTRAINT `secureLinks_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `secureLinks` ADD CONSTRAINT `secureLinks_providerPackId_providerPacks_id_fk` FOREIGN KEY (`providerPackId`) REFERENCES `providerPacks`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `secureLinks` ADD CONSTRAINT `secureLinks_documentId_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `secureLinks` ADD CONSTRAINT `secureLinks_invoiceId_invoices_id_fk` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `secureLinks` ADD CONSTRAINT `secureLinks_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sharingDecisions` ADD CONSTRAINT `sharingDecisions_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sharingDecisions` ADD CONSTRAINT `sharingDecisions_caseId_dataRightsCases_id_fk` FOREIGN KEY (`caseId`) REFERENCES `dataRightsCases`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sharingDecisions` ADD CONSTRAINT `sharingDecisions_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sharingDecisions` ADD CONSTRAINT `sharingDecisions_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sharingDecisions` ADD CONSTRAINT `sharingDecisions_revokedBy_users_id_fk` FOREIGN KEY (`revokedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sharingDecisions` ADD CONSTRAINT `sharingDecisions_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftBreaks` ADD CONSTRAINT `shiftBreaks_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftBreaks` ADD CONSTRAINT `shiftBreaks_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftBreaks` ADD CONSTRAINT `shiftBreaks_shiftId_shifts_id_fk` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftBreaks` ADD CONSTRAINT `shiftBreaks_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftBreaks` ADD CONSTRAINT `shiftBreaks_startClockEventId_clockEvents_id_fk` FOREIGN KEY (`startClockEventId`) REFERENCES `clockEvents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftBreaks` ADD CONSTRAINT `shiftBreaks_endClockEventId_clockEvents_id_fk` FOREIGN KEY (`endClockEventId`) REFERENCES `clockEvents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftBreaks` ADD CONSTRAINT `shiftBreaks_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftChangeAcknowledgements` ADD CONSTRAINT `shiftChangeAcknowledgements_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftChangeAcknowledgements` ADD CONSTRAINT `shiftChangeAcknowledgements_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftChangeAcknowledgements` ADD CONSTRAINT `fk_shiftChangeAcknowledgeme_shiftChangeEventId_b24305` FOREIGN KEY (`shiftChangeEventId`) REFERENCES `shiftChangeEvents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftChangeEvents` ADD CONSTRAINT `shiftChangeEvents_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftChangeEvents` ADD CONSTRAINT `shiftChangeEvents_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftChangeEvents` ADD CONSTRAINT `shiftChangeEvents_shiftId_shifts_id_fk` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftChangeEvents` ADD CONSTRAINT `shiftChangeEvents_affectedUserId_users_id_fk` FOREIGN KEY (`affectedUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftChangeEvents` ADD CONSTRAINT `shiftChangeEvents_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftRequests` ADD CONSTRAINT `shiftRequests_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftRequests` ADD CONSTRAINT `shiftRequests_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftRequests` ADD CONSTRAINT `shiftRequests_shiftId_shifts_id_fk` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftRequests` ADD CONSTRAINT `shiftRequests_requestedBy_users_id_fk` FOREIGN KEY (`requestedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftRequests` ADD CONSTRAINT `shiftRequests_proposedUserId_users_id_fk` FOREIGN KEY (`proposedUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shiftRequests` ADD CONSTRAINT `shiftRequests_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_assignedUserId_users_id_fk` FOREIGN KEY (`assignedUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staffAvailability` ADD CONSTRAINT `staffAvailability_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staffAvailability` ADD CONSTRAINT `staffAvailability_staffProfileId_staffProfiles_id_fk` FOREIGN KEY (`staffProfileId`) REFERENCES `staffProfiles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staffAvailability` ADD CONSTRAINT `staffAvailability_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staffAvailability` ADD CONSTRAINT `staffAvailability_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staffAvailability` ADD CONSTRAINT `staffAvailability_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staffProfiles` ADD CONSTRAINT `staffProfiles_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staffProfiles` ADD CONSTRAINT `staffProfiles_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staffProfiles` ADD CONSTRAINT `staffProfiles_managerUserId_users_id_fk` FOREIGN KEY (`managerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staffProfiles` ADD CONSTRAINT `staffProfiles_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staffRequests` ADD CONSTRAINT `staffRequests_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staffRequests` ADD CONSTRAINT `staffRequests_staffProfileId_staffProfiles_id_fk` FOREIGN KEY (`staffProfileId`) REFERENCES `staffProfiles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staffRequests` ADD CONSTRAINT `staffRequests_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staffRequests` ADD CONSTRAINT `staffRequests_evidenceDocumentId_documents_id_fk` FOREIGN KEY (`evidenceDocumentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `staffRequests` ADD CONSTRAINT `staffRequests_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `standardTextSnippets` ADD CONSTRAINT `standardTextSnippets_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `standardTextSnippets` ADD CONSTRAINT `standardTextSnippets_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `standardTextSnippets` ADD CONSTRAINT `standardTextSnippets_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `statementArchives` ADD CONSTRAINT `statementArchives_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `statementArchives` ADD CONSTRAINT `statementArchives_localAuthorityId_localAuthorities_id_fk` FOREIGN KEY (`localAuthorityId`) REFERENCES `localAuthorities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `statementArchives` ADD CONSTRAINT `statementArchives_documentId_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `statementArchives` ADD CONSTRAINT `statementArchives_generatedBy_users_id_fk` FOREIGN KEY (`generatedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supervisionSessions` ADD CONSTRAINT `supervisionSessions_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supervisionSessions` ADD CONSTRAINT `supervisionSessions_staffProfileId_staffProfiles_id_fk` FOREIGN KEY (`staffProfileId`) REFERENCES `staffProfiles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supervisionSessions` ADD CONSTRAINT `supervisionSessions_managerUserId_users_id_fk` FOREIGN KEY (`managerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supervisionSessions` ADD CONSTRAINT `supervisionSessions_templateId_documentTemplates_id_fk` FOREIGN KEY (`templateId`) REFERENCES `documentTemplates`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supervisionSessions` ADD CONSTRAINT `supervisionSessions_acknowledgedBy_users_id_fk` FOREIGN KEY (`acknowledgedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supervisionSessions` ADD CONSTRAINT `supervisionSessions_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supportGoals` ADD CONSTRAINT `supportGoals_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supportGoals` ADD CONSTRAINT `supportGoals_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supportGoals` ADD CONSTRAINT `supportGoals_carePlanId_carePlans_id_fk` FOREIGN KEY (`carePlanId`) REFERENCES `carePlans`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `supportGoals` ADD CONSTRAINT `supportGoals_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `temporaryLoginLinks` ADD CONSTRAINT `temporaryLoginLinks_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `temporaryLoginLinks` ADD CONSTRAINT `temporaryLoginLinks_targetUserId_users_id_fk` FOREIGN KEY (`targetUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `temporaryLoginLinks` ADD CONSTRAINT `temporaryLoginLinks_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timesheetEntries` ADD CONSTRAINT `timesheetEntries_timesheetId_timesheets_id_fk` FOREIGN KEY (`timesheetId`) REFERENCES `timesheets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timesheetEntries` ADD CONSTRAINT `timesheetEntries_shiftId_shifts_id_fk` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timesheetEntries` ADD CONSTRAINT `timesheetEntries_adjustedBy_users_id_fk` FOREIGN KEY (`adjustedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timesheets` ADD CONSTRAINT `timesheets_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timesheets` ADD CONSTRAINT `timesheets_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timesheets` ADD CONSTRAINT `timesheets_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workPlanActions` ADD CONSTRAINT `workPlanActions_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workPlanActions` ADD CONSTRAINT `workPlanActions_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workPlanActions` ADD CONSTRAINT `workPlanActions_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workPlanActions` ADD CONSTRAINT `workPlanActions_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workPlanActions` ADD CONSTRAINT `workPlanActions_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workPlanActions` ADD CONSTRAINT `workPlanActions_completedBy_users_id_fk` FOREIGN KEY (`completedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workPlanActions` ADD CONSTRAINT `workPlanActions_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workPlanDependencies` ADD CONSTRAINT `workPlanDependencies_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workPlanDependencies` ADD CONSTRAINT `workPlanDependencies_actionId_workPlanActions_id_fk` FOREIGN KEY (`actionId`) REFERENCES `workPlanActions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workPlanDependencies` ADD CONSTRAINT `workPlanDependencies_dependsOnActionId_workPlanActions_id_fk` FOREIGN KEY (`dependsOnActionId`) REFERENCES `workPlanActions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workPlanDependencies` ADD CONSTRAINT `workPlanDependencies_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workedShiftSummaries` ADD CONSTRAINT `workedShiftSummaries_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workedShiftSummaries` ADD CONSTRAINT `workedShiftSummaries_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workedShiftSummaries` ADD CONSTRAINT `workedShiftSummaries_shiftId_shifts_id_fk` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workedShiftSummaries` ADD CONSTRAINT `workedShiftSummaries_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workedShiftSummaries` ADD CONSTRAINT `workedShiftSummaries_replacedUserId_users_id_fk` FOREIGN KEY (`replacedUserId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workedShiftSummaries` ADD CONSTRAINT `workedShiftSummaries_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workerAssignments` ADD CONSTRAINT `workerAssignments_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workerAssignments` ADD CONSTRAINT `workerAssignments_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workerAssignments` ADD CONSTRAINT `workerAssignments_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workerAssignments` ADD CONSTRAINT `workerAssignments_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workforceChecks` ADD CONSTRAINT `workforceChecks_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workforceChecks` ADD CONSTRAINT `workforceChecks_staffProfileId_staffProfiles_id_fk` FOREIGN KEY (`staffProfileId`) REFERENCES `staffProfiles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workforceChecks` ADD CONSTRAINT `workforceChecks_verifiedBy_users_id_fk` FOREIGN KEY (`verifiedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workforceChecks` ADD CONSTRAINT `workforceChecks_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workingTimeExceptions` ADD CONSTRAINT `workingTimeExceptions_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workingTimeExceptions` ADD CONSTRAINT `workingTimeExceptions_shiftId_shifts_id_fk` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workingTimeExceptions` ADD CONSTRAINT `workingTimeExceptions_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workingTimeExceptions` ADD CONSTRAINT `workingTimeExceptions_policyId_workingTimePolicies_id_fk` FOREIGN KEY (`policyId`) REFERENCES `workingTimePolicies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workingTimeExceptions` ADD CONSTRAINT `workingTimeExceptions_overrideBy_users_id_fk` FOREIGN KEY (`overrideBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workingTimePolicies` ADD CONSTRAINT `workingTimePolicies_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workingTimePolicies` ADD CONSTRAINT `workingTimePolicies_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `workingTimePolicies` ADD CONSTRAINT `workingTimePolicies_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `youngPeople` ADD CONSTRAINT `youngPeople_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `youngPeople` ADD CONSTRAINT `youngPeople_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `allegation_due_idx` ON `allegations` (`entityId`,`reviewDueAt`,`status`);--> statement-breakpoint
CREATE INDEX `analytics_measure_domain_idx` ON `analyticsMeasures` (`entityId`,`domain`,`status`);--> statement-breakpoint
CREATE INDEX `assurance_schedule_task_uid_idx` ON `assuranceSchedules` (`scheduleCronTaskUid`);--> statement-breakpoint
CREATE INDEX `audit_resource_idx` ON `auditLogs` (`resourceType`,`resourceId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `audit_actor_idx` ON `auditLogs` (`actorUserId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `audit_receipt_verify_idx` ON `auditReceiptMirrors` (`entityId`,`status`,`lastVerifiedAt`);--> statement-breakpoint
CREATE INDEX `audit_verification_idx` ON `auditVerificationRuns` (`entityId`,`startedAt`,`status`);--> statement-breakpoint
CREATE INDEX `automation_task_uid_idx` ON `automationRules` (`scheduleCronTaskUid`);--> statement-breakpoint
CREATE INDEX `behaviour_review_idx` ON `behaviourSupportEvents` (`entityId`,`reviewRequired`,`reviewDueAt`);--> statement-breakpoint
CREATE INDEX `care_plan_review_idx` ON `carePlans` (`entityId`,`reviewDueAt`,`status`);--> statement-breakpoint
CREATE INDEX `clock_user_time_idx` ON `clockEvents` (`userId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `colleague_invitation_property_idx` ON `colleagueInvitationPropertyGrants` (`propertyId`);--> statement-breakpoint
CREATE INDEX `colleague_invitation_entity_status_idx` ON `colleagueInvitations` (`entityId`,`status`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `colleague_invitation_email_idx` ON `colleagueInvitations` (`emailNormalized`,`status`);--> statement-breakpoint
CREATE INDEX `complaint_escalation_idx` ON `complaintEscalations` (`complaintId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `complaint_due_idx` ON `complaints` (`entityId`,`responseDueAt`,`status`);--> statement-breakpoint
CREATE INDEX `compliance_due_idx` ON `complianceObligations` (`entityId`,`dueAt`,`status`);--> statement-breakpoint
CREATE INDEX `credit_invoice_idx` ON `creditNotes` (`invoiceId`);--> statement-breakpoint
CREATE INDEX `curfew_check_due_idx` ON `curfewChecks` (`placementId`,`expectedAt`,`status`);--> statement-breakpoint
CREATE INDEX `curfew_plan_placement_idx` ON `curfewPlans` (`placementId`,`status`,`reviewDueAt`);--> statement-breakpoint
CREATE INDEX `daily_note_placement_idx` ON `dailyNotes` (`placementId`,`observedAt`,`status`);--> statement-breakpoint
CREATE INDEX `data_rights_due_idx` ON `dataRightsCases` (`entityId`,`status`,`dueAt`);--> statement-breakpoint
CREATE INDEX `data_rights_event_idx` ON `dataRightsEvents` (`caseId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `scan_job_retry_idx` ON `documentScanJobs` (`status`,`nextRetryAt`);--> statement-breakpoint
CREATE INDEX `scan_job_document_idx` ON `documentScanJobs` (`documentVersionId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `documents_entity_status_idx` ON `documents` (`entityId`,`status`,`documentType`);--> statement-breakpoint
CREATE INDEX `esign_envelope_entity_status_idx` ON `eSignatureEnvelopes` (`entityId`,`status`);--> statement-breakpoint
CREATE INDEX `esign_signer_envelope_idx` ON `eSignatureSigners` (`envelopeId`,`signingOrder`,`status`);--> statement-breakpoint
CREATE INDEX `roll_call_entry_idx` ON `emergencyRollCallEntries` (`rollCallId`,`accountedState`);--> statement-breakpoint
CREATE INDEX `emergency_roll_call_idx` ON `emergencyRollCalls` (`propertyId`,`status`,`initiatedAt`);--> statement-breakpoint
CREATE INDEX `entities_status_idx` ON `entities` (`status`);--> statement-breakpoint
CREATE INDEX `entity_membership_user_idx` ON `entityMemberships` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `framework_regime_status_idx` ON `evidenceFrameworks` (`regimeId`,`status`,`version`);--> statement-breakpoint
CREATE INDEX `export_jobs_status_idx` ON `exportJobs` (`entityId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `fee_schedule_effective_idx` ON `feeSchedules` (`entityId`,`effectiveFrom`,`status`);--> statement-breakpoint
CREATE INDEX `framework_publication_idx` ON `frameworkPublications` (`frameworkId`,`publicationType`,`createdAt`);--> statement-breakpoint
CREATE INDEX `framework_requirement_status_idx` ON `frameworkRequirements` (`frameworkId`,`status`,`category`);--> statement-breakpoint
CREATE INDEX `guest_invitation_entity_idx` ON `guestInvitations` (`entityId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `guest_invitation_expiry_idx` ON `guestInvitations` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `handover_acknowledgement_user_idx` ON `handoverAcknowledgements` (`userId`,`acknowledgedAt`);--> statement-breakpoint
CREATE INDEX `handover_review_event_idx` ON `handoverReviewEvents` (`handoverId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `handover_property_idx` ON `handovers` (`propertyId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `health_event_placement_idx` ON `healthMonitoringEvents` (`placementId`,`occurredAt`,`outcome`);--> statement-breakpoint
CREATE INDEX `health_plan_due_idx` ON `healthMonitoringPlans` (`entityId`,`placementId`,`status`,`nextDueAt`);--> statement-breakpoint
CREATE INDEX `identity_assurance_due_idx` ON `identityAssuranceReviews` (`entityId`,`nextReviewAt`,`status`);--> statement-breakpoint
CREATE INDEX `identity_assurance_user_idx` ON `identityAssuranceReviews` (`userId`,`assuranceType`);--> statement-breakpoint
CREATE INDEX `incident_chronology_idx` ON `incidentChronology` (`incidentId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `incident_people_idx` ON `incidentPeople` (`incidentId`,`involvement`);--> statement-breakpoint
CREATE INDEX `incident_reference_idx` ON `incidentReferences` (`incidentId`,`referenceType`);--> statement-breakpoint
CREATE INDEX `incident_review_idx` ON `incidentReviews` (`incidentId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `incident_witness_idx` ON `incidentWitnesses` (`incidentId`,`witnessType`);--> statement-breakpoint
CREATE INDEX `incident_entity_status_idx` ON `incidents` (`entityId`,`status`,`severity`);--> statement-breakpoint
CREATE INDEX `integration_attempt_delivery_idx` ON `integrationAttempts` (`deliveryId`,`startedAt`);--> statement-breakpoint
CREATE INDEX `integration_entity_status_idx` ON `integrationConnections` (`entityId`,`status`,`integrationType`);--> statement-breakpoint
CREATE INDEX `integration_task_uid_idx` ON `integrationConnections` (`scheduleCronTaskUid`);--> statement-breakpoint
CREATE INDEX `integration_delivery_queue_idx` ON `integrationDeliveries` (`connectionId`,`status`,`nextAttemptAt`);--> statement-breakpoint
CREATE INDEX `integration_receipt_status_idx` ON `integrationReceipts` (`connectionId`,`status`,`receivedAt`);--> statement-breakpoint
CREATE INDEX `investigation_action_idx` ON `investigationActions` (`investigationId`,`status`,`dueAt`);--> statement-breakpoint
CREATE INDEX `investigation_queue_idx` ON `investigations` (`entityId`,`status`,`dueAt`);--> statement-breakpoint
CREATE INDEX `invoice_event_idx` ON `invoiceEvents` (`invoiceId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `invoice_lines_invoice_idx` ON `invoiceLines` (`invoiceId`);--> statement-breakpoint
CREATE INDEX `invoice_due_status_idx` ON `invoices` (`entityId`,`dueAt`,`status`);--> statement-breakpoint
CREATE INDEX `key_worker_report_review_idx` ON `keyWorkerReportReviews` (`reportId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `report_source_lookup_idx` ON `keyWorkerReportSources` (`sourceType`,`sourceId`);--> statement-breakpoint
CREATE INDEX `key_report_placement_date_idx` ON `keyWorkerReports` (`placementId`,`reportDate`);--> statement-breakpoint
CREATE INDEX `keywork_session_placement_idx` ON `keyworkSessions` (`placementId`,`occurredAt`,`status`);--> statement-breakpoint
CREATE INDEX `local_auth_reset_idx` ON `localAuthCredentials` (`resetTokenHash`,`resetExpiresAt`);--> statement-breakpoint
CREATE INDEX `lone_worker_checkin_idx` ON `loneWorkerCheckIns` (`sessionId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `lone_worker_due_idx` ON `loneWorkerSessions` (`entityId`,`status`,`nextCheckInDueAt`);--> statement-breakpoint
CREATE INDEX `maintenance_job_queue_idx` ON `maintenanceJobs` (`entityId`,`propertyId`,`status`,`priority`);--> statement-breakpoint
CREATE INDEX `maintenance_update_job_idx` ON `maintenanceUpdates` (`maintenanceJobId`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `med_admin_due_idx` ON `medicationAdministrations` (`placementId`,`scheduledAt`,`outcome`);--> statement-breakpoint
CREATE INDEX `medication_discrepancy_idx` ON `medicationDiscrepancies` (`entityId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `med_self_admin_idx` ON `medicationSelfAdministrationEvents` (`medicationId`,`occurredAt`,`eventType`);--> statement-breakpoint
CREATE INDEX `medication_stock_idx` ON `medicationStockTransactions` (`medicationId`,`occurredAt`,`status`);--> statement-breakpoint
CREATE INDEX `medication_due_idx` ON `medications` (`entityId`,`placementId`,`status`,`nextDueAt`);--> statement-breakpoint
CREATE INDEX `missing_episode_status_idx` ON `missingEpisodes` (`entityId`,`status`,`missingAt`);--> statement-breakpoint
CREATE INDEX `notification_channel_queue_idx` ON `notificationChannelDeliveries` (`entityId`,`channel`,`status`,`nextAttemptAt`);--> statement-breakpoint
CREATE INDEX `notification_user_idx` ON `notifications` (`userId`,`readAt`);--> statement-breakpoint
CREATE INDEX `occupancy_property_time_idx` ON `occupancyEvents` (`propertyId`,`effectiveAt`);--> statement-breakpoint
CREATE INDEX `offline_sync_entity_status_idx` ON `offlineSyncReceipts` (`entityId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `outcome_measure_period_idx` ON `outcomeObservations` (`entityId`,`measureId`,`periodStart`);--> statement-breakpoint
CREATE INDEX `outcome_placement_period_idx` ON `outcomeObservations` (`placementId`,`periodStart`);--> statement-breakpoint
CREATE INDEX `payments_invoice_idx` ON `payments` (`invoiceId`,`receivedAt`);--> statement-breakpoint
CREATE INDEX `placement_notification_due_idx` ON `placementNotifications` (`entityId`,`status`,`dueAt`);--> statement-breakpoint
CREATE INDEX `placement_property_status_idx` ON `placements` (`entityId`,`propertyId`,`status`);--> statement-breakpoint
CREATE INDEX `processing_restriction_scope_idx` ON `processingRestrictions` (`entityId`,`placementId`,`status`);--> statement-breakpoint
CREATE INDEX `professional_contact_placement_idx` ON `professionalContacts` (`placementId`,`contactType`,`status`);--> statement-breakpoint
CREATE INDEX `properties_entity_status_idx` ON `properties` (`entityId`,`status`);--> statement-breakpoint
CREATE INDEX `property_check_status_idx` ON `propertyChecks` (`entityId`,`propertyId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `property_evidence_due_idx` ON `propertyEvidence` (`entityId`,`propertyId`,`dueAt`,`status`);--> statement-breakpoint
CREATE INDEX `property_presence_idx` ON `propertyPresenceEvents` (`propertyId`,`occurredAt`,`personType`);--> statement-breakpoint
CREATE INDEX `property_visitor_status_idx` ON `propertyVisitors` (`entityId`,`propertyId`,`status`,`arrivedAt`);--> statement-breakpoint
CREATE INDEX `provider_pack_entity_status_idx` ON `providerPacks` (`entityId`,`status`);--> statement-breakpoint
CREATE INDEX `quality_review_consultation_idx` ON `qualityReviewConsultations` (`qualityReviewId`,`audience`,`responseStatus`);--> statement-breakpoint
CREATE INDEX `quality_review_evidence_idx` ON `qualityReviewEvidence` (`qualityReviewId`,`category`,`status`);--> statement-breakpoint
CREATE INDEX `quality_review_due_idx` ON `qualityReviews` (`entityId`,`status`,`periodEnd`,`submissionDueAt`);--> statement-breakpoint
CREATE INDEX `record_correction_resource_idx` ON `recordCorrections` (`resourceType`,`resourceId`,`status`);--> statement-breakpoint
CREATE INDEX `record_document_resource_idx` ON `recordDocumentLinks` (`resourceType`,`resourceId`);--> statement-breakpoint
CREATE INDEX `record_link_target_idx` ON `recordLinks` (`toResourceType`,`toResourceId`);--> statement-breakpoint
CREATE INDEX `record_shortcut_recent_idx` ON `recordShortcuts` (`userId`,`entityId`,`lastViewedAt`);--> statement-breakpoint
CREATE INDEX `redaction_case_idx` ON `redactionDecisions` (`caseId`,`status`);--> statement-breakpoint
CREATE INDEX `regime_entity_status_idx` ON `regulatoryRegimes` (`entityId`,`status`,`effectiveFrom`);--> statement-breakpoint
CREATE INDEX `resident_finance_account_idx` ON `residentFinanceAccounts` (`entityId`,`placementId`,`status`);--> statement-breakpoint
CREATE INDEX `resident_finance_discrepancy_idx` ON `residentFinanceDiscrepancies` (`entityId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `resident_reconciliation_idx` ON `residentFinanceReconciliations` (`entityId`,`status`,`periodEnd`);--> statement-breakpoint
CREATE INDEX `resident_finance_transaction_idx` ON `residentFinanceTransactions` (`accountId`,`occurredAt`,`status`);--> statement-breakpoint
CREATE INDEX `resident_valuable_placement_idx` ON `residentValuables` (`placementId`,`status`);--> statement-breakpoint
CREATE INDEX `resilience_due_idx` ON `resilienceChecks` (`entityId`,`nextDueAt`,`status`);--> statement-breakpoint
CREATE INDEX `restraint_review_idx` ON `restraintEvents` (`entityId`,`managementReview`,`startedAt`);--> statement-breakpoint
CREATE INDEX `retention_review_due_idx` ON `retentionReviews` (`entityId`,`reviewDueAt`,`status`);--> statement-breakpoint
CREATE INDEX `safeguarding_concern_queue_idx` ON `safeguardingConcerns` (`entityId`,`status`,`riskLevel`,`reviewDueAt`);--> statement-breakpoint
CREATE INDEX `scheduled_activity_due_idx` ON `scheduledActivities` (`placementId`,`scheduledStart`,`attendanceStatus`);--> statement-breakpoint
CREATE INDEX `secure_link_expiry_idx` ON `secureLinks` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `sharing_decision_status_idx` ON `sharingDecisions` (`entityId`,`status`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `shift_break_user_idx` ON `shiftBreaks` (`shiftId`,`userId`,`startedAt`);--> statement-breakpoint
CREATE INDEX `shift_ack_user_idx` ON `shiftChangeAcknowledgements` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `shift_change_event_idx` ON `shiftChangeEvents` (`entityId`,`shiftId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `shift_request_status_idx` ON `shiftRequests` (`entityId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `shift_property_time_idx` ON `shifts` (`propertyId`,`startsAt`,`status`);--> statement-breakpoint
CREATE INDEX `availability_staff_time_idx` ON `staffAvailability` (`staffProfileId`,`startsAt`,`endsAt`,`status`);--> statement-breakpoint
CREATE INDEX `staff_entity_status_idx` ON `staffProfiles` (`entityId`,`status`);--> statement-breakpoint
CREATE INDEX `staff_request_queue_idx` ON `staffRequests` (`entityId`,`status`,`requestType`,`createdAt`);--> statement-breakpoint
CREATE INDEX `staff_request_user_idx` ON `staffRequests` (`userId`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `statement_archive_entity_created_idx` ON `statementArchives` (`entityId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `statement_archive_authority_period_idx` ON `statementArchives` (`entityId`,`localAuthorityId`,`startAt`,`endAt`);--> statement-breakpoint
CREATE INDEX `supervision_due_idx` ON `supervisionSessions` (`entityId`,`staffProfileId`,`status`,`scheduledAt`);--> statement-breakpoint
CREATE INDEX `support_goal_placement_idx` ON `supportGoals` (`placementId`,`status`,`reviewDueAt`);--> statement-breakpoint
CREATE INDEX `temporary_login_link_recipient_idx` ON `temporaryLoginLinks` (`entityId`,`targetUserId`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `temporary_login_link_expiry_idx` ON `temporaryLoginLinks` (`expiresAt`);--> statement-breakpoint
CREATE INDEX `timesheet_entry_sheet_idx` ON `timesheetEntries` (`timesheetId`);--> statement-breakpoint
CREATE INDEX `work_plan_due_idx` ON `workPlanActions` (`entityId`,`dueAt`,`status`);--> statement-breakpoint
CREATE INDEX `worked_shift_property_idx` ON `workedShiftSummaries` (`entityId`,`propertyId`,`summaryGeneratedAt`);--> statement-breakpoint
CREATE INDEX `workforce_check_due_idx` ON `workforceChecks` (`entityId`,`expiresAt`,`status`);--> statement-breakpoint
CREATE INDEX `working_exception_shift_idx` ON `workingTimeExceptions` (`shiftId`,`severity`,`overrideStatus`);--> statement-breakpoint
CREATE INDEX `working_policy_effective_idx` ON `workingTimePolicies` (`entityId`,`status`,`effectiveFrom`);