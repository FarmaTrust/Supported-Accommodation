ALTER TABLE `invoices` ADD `pdfDocumentId` int;--> statement-breakpoint
ALTER TABLE `secureLinks` ADD `invoiceId` int;--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_pdfDocumentId_documents_id_fk` FOREIGN KEY (`pdfDocumentId`) REFERENCES `documents`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `secureLinks` ADD CONSTRAINT `secureLinks_invoiceId_invoices_id_fk` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE no action ON UPDATE no action;