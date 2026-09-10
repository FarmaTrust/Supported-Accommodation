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
ALTER TABLE `notificationChannelDeliveries` ADD CONSTRAINT `notificationChannelDeliveries_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notificationChannelDeliveries` ADD CONSTRAINT `notificationChannelDeliveries_notificationId_notifications_id_fk` FOREIGN KEY (`notificationId`) REFERENCES `notifications`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notificationChannelDeliveries` ADD CONSTRAINT `notificationChannelDeliveries_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notificationChannelDeliveries` ADD CONSTRAINT `notificationChannelDeliveries_providerConnectionId_integrationConnections_id_fk` FOREIGN KEY (`providerConnectionId`) REFERENCES `integrationConnections`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `notification_channel_queue_idx` ON `notificationChannelDeliveries` (`entityId`,`channel`,`status`,`nextAttemptAt`);