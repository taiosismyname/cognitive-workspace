CREATE TABLE `conversation_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` int NOT NULL,
	`role` enum('system','user','assistant','tool') NOT NULL,
	`content` text NOT NULL,
	`modelRegistryId` int,
	`providerRequestId` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `conversation_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(255) NOT NULL,
	`summary` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `conversations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `council_results` (
	`id` int AUTO_INCREMENT NOT NULL,
	`councilRunId` int NOT NULL,
	`modelRegistryId` int NOT NULL,
	`status` enum('running','completed','failed') NOT NULL DEFAULT 'running',
	`responseText` text,
	`errorMessage` text,
	`providerRequestId` varchar(255),
	`latencyMs` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `council_results_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `council_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`prompt` text NOT NULL,
	`status` enum('running','completed','partial','failed') NOT NULL DEFAULT 'running',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `council_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `memories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`modelRegistryId` int NOT NULL,
	`sourceConversationId` int NOT NULL,
	`sourceMessageId` int NOT NULL,
	`content` text NOT NULL,
	`memoryType` varchar(64) NOT NULL DEFAULT 'fact',
	`embeddingJson` text,
	`embeddingModel` varchar(255),
	`isRetrievalEligible` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `memories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `model_registry` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`providerKey` varchar(64) NOT NULL,
	`modelKey` varchar(255) NOT NULL,
	`displayName` varchar(255) NOT NULL,
	`adapterStatus` enum('active','unimplemented','disabled') NOT NULL DEFAULT 'active',
	`capabilities` json,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `model_registry_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `conversation_messages_conversation_idx` ON `conversation_messages` (`conversationId`);--> statement-breakpoint
CREATE INDEX `conversations_user_idx` ON `conversations` (`userId`);--> statement-breakpoint
CREATE INDEX `council_results_run_idx` ON `council_results` (`councilRunId`);--> statement-breakpoint
CREATE INDEX `council_runs_user_idx` ON `council_runs` (`userId`);--> statement-breakpoint
CREATE INDEX `memories_user_idx` ON `memories` (`userId`);--> statement-breakpoint
CREATE INDEX `memories_model_idx` ON `memories` (`modelRegistryId`);--> statement-breakpoint
CREATE INDEX `memories_provenance_idx` ON `memories` (`sourceConversationId`,`sourceMessageId`);--> statement-breakpoint
CREATE INDEX `model_registry_user_idx` ON `model_registry` (`userId`);