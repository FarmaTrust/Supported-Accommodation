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
ALTER TABLE `occupancyEvents` ADD CONSTRAINT `occupancyEvents_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `occupancyEvents` ADD CONSTRAINT `occupancyEvents_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `occupancyEvents` ADD CONSTRAINT `occupancyEvents_unitId_propertyUnits_id_fk` FOREIGN KEY (`unitId`) REFERENCES `propertyUnits`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `occupancyEvents` ADD CONSTRAINT `occupancyEvents_placementId_placements_id_fk` FOREIGN KEY (`placementId`) REFERENCES `placements`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `occupancyEvents` ADD CONSTRAINT `occupancyEvents_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyUnits` ADD CONSTRAINT `propertyUnits_entityId_entities_id_fk` FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyUnits` ADD CONSTRAINT `propertyUnits_propertyId_properties_id_fk` FOREIGN KEY (`propertyId`) REFERENCES `properties`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `propertyUnits` ADD CONSTRAINT `propertyUnits_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `occupancy_property_time_idx` ON `occupancyEvents` (`propertyId`,`effectiveAt`);