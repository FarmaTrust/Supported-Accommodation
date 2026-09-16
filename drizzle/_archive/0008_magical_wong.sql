ALTER TABLE `invoices` ADD `approvalRequestedAt` bigint;--> statement-breakpoint
ALTER TABLE `invoices` ADD `approvedAt` bigint;--> statement-breakpoint
ALTER TABLE `invoices` ADD `approvedBy` int;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_approvedBy_users_id_fk` FOREIGN KEY (`approvedBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;