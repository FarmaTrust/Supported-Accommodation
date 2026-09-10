ALTER TABLE `notifications` ADD `acknowledgementRequired` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `notifications` ADD `snoozedUntil` bigint;--> statement-breakpoint
ALTER TABLE `notifications` ADD `escalationDueAt` bigint;