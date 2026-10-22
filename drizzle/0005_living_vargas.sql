ALTER TABLE `conversation_messages` MODIFY COLUMN `content` longtext NOT NULL;--> statement-breakpoint
ALTER TABLE `model_registry` ADD `corpusProviderKeys` varchar(255);