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
ALTER TABLE `keyWorkerReports` ADD `learning` text;--> statement-breakpoint
ALTER TABLE `keyWorkerReports` ADD `enthusiasm` varchar(120);--> statement-breakpoint
ALTER TABLE `handoverAcknowledgements` ADD CONSTRAINT `handoverAcknowledgements_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `handoverAcknowledgements` ADD CONSTRAINT `handoverAcknowledgements_handoverId_handovers_id_fk` FOREIGN KEY (`handoverId`) REFERENCES `handovers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `handoverAcknowledgements` ADD CONSTRAINT `handoverAcknowledgements_shiftId_shifts_id_fk` FOREIGN KEY (`shiftId`) REFERENCES `shifts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `handoverAcknowledgements` ADD CONSTRAINT `handoverAcknowledgements_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `handover_acknowledgement_user_idx` ON `handoverAcknowledgements` (`userId`,`acknowledgedAt`);