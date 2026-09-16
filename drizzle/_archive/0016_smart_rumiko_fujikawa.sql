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
ALTER TABLE `statementArchives` ADD CONSTRAINT `statementArchives_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `statementArchives` ADD CONSTRAINT `statementArchives_localAuthorityId_localAuthorities_id_fk` FOREIGN KEY (`localAuthorityId`) REFERENCES `localAuthorities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `statementArchives` ADD CONSTRAINT `statementArchives_documentId_documents_id_fk` FOREIGN KEY (`documentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `statementArchives` ADD CONSTRAINT `statementArchives_generatedBy_users_id_fk` FOREIGN KEY (`generatedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `statement_archive_entity_created_idx` ON `statementArchives` (`entityId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `statement_archive_authority_period_idx` ON `statementArchives` (`entityId`,`localAuthorityId`,`startAt`,`endAt`);