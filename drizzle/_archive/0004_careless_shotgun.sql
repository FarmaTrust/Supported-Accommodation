ALTER TABLE `feeSchedules` ADD `placementType` varchar(120);--> statement-breakpoint
ALTER TABLE `feeSchedules` ADD `contractReference` varchar(160);--> statement-breakpoint
ALTER TABLE `notifications` ADD `deepLink` varchar(400);--> statement-breakpoint
ALTER TABLE `notifications` ADD `escalationState` enum('none','escalated','acknowledged','resolved') DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `notifications` ADD `escalationCount` int DEFAULT 0 NOT NULL;