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
ALTER TABLE `handovers` ADD `templateCode` varchar(80);--> statement-breakpoint
ALTER TABLE `handovers` ADD `structuredBriefCiphertext` text;--> statement-breakpoint
ALTER TABLE `handovers` ADD `dictatedTextCiphertext` text;--> statement-breakpoint
ALTER TABLE `handovers` ADD `dictatedReviewState` enum('not_required','pending_review','reviewed','approved','returned') DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE `handovers` ADD `reviewedBy` int;--> statement-breakpoint
ALTER TABLE `handovers` ADD `reviewedAt` bigint;--> statement-breakpoint
ALTER TABLE `handovers` ADD `approvedBy` int;--> statement-breakpoint
ALTER TABLE `handovers` ADD `approvedAt` bigint;--> statement-breakpoint
ALTER TABLE `handovers` ADD `reviewNotesCiphertext` text;--> statement-breakpoint
ALTER TABLE `handoverReviewEvents` ADD CONSTRAINT `handoverReviewEvents_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `handoverReviewEvents` ADD CONSTRAINT `handoverReviewEvents_handoverId_handovers_id_fk` FOREIGN KEY (`handoverId`) REFERENCES `handovers`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `handoverReviewEvents` ADD CONSTRAINT `handoverReviewEvents_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `handover_review_event_idx` ON `handoverReviewEvents` (`handoverId`,`createdAt`);--> statement-breakpoint
ALTER TABLE `handovers` ADD CONSTRAINT `handovers_reviewedBy_users_id_fk` FOREIGN KEY (`reviewedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `handovers` ADD CONSTRAINT `handovers_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;