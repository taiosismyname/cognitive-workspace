CREATE TABLE `conversation_origins` (
	`conversationId` int NOT NULL,
	`originType` enum('workspace','provider_import','manual_file_import') NOT NULL,
	`providerConnectionId` int,
	`historyImportId` int,
	`providerKey` varchar(64),
	`nativeConversationId` varchar(255),
	`nativeCreatedAt` timestamp,
	`nativeUpdatedAt` timestamp,
	`rawPayloadJson` longtext,
	`metadataJson` text,
	CONSTRAINT `conversation_origins_conversationId` PRIMARY KEY(`conversationId`),
	CONSTRAINT `conversation_origins_native_idx` UNIQUE(`providerConnectionId`,`nativeConversationId`)
);
--> statement-breakpoint
CREATE TABLE `council_context_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`manifestId` int NOT NULL,
	`itemType` varchar(64) NOT NULL,
	`sourceId` int,
	`contentJson` longtext NOT NULL,
	`ordinal` int NOT NULL DEFAULT 0,
	CONSTRAINT `council_context_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `council_context_manifests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`councilRunId` int NOT NULL,
	`modelRegistryId` int NOT NULL,
	`modelStateSnapshotId` int,
	`contextHash` varchar(128) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `council_context_manifests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `history_imports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`providerConnectionId` int NOT NULL,
	`mode` enum('full','incremental','selected_conversations') NOT NULL,
	`status` enum('queued','running','completed','partial','failed','cancelled') NOT NULL DEFAULT 'queued',
	`sourceFileName` varchar(255),
	`cursor` text,
	`sourceSelectionJson` text,
	`conversationsDiscovered` int NOT NULL DEFAULT 0,
	`conversationsImported` int NOT NULL DEFAULT 0,
	`messagesImported` int NOT NULL DEFAULT 0,
	`duplicatesSkipped` int NOT NULL DEFAULT 0,
	`errorJson` longtext,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `history_imports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `message_origins` (
	`messageId` int NOT NULL,
	`historyImportId` int,
	`nativeMessageId` varchar(255),
	`nativeParentId` varchar(255),
	`nativeCreatedAt` timestamp,
	`nativeOrder` varchar(64),
	`rawPayloadJson` longtext,
	`metadataJson` text,
	CONSTRAINT `message_origins_messageId` PRIMARY KEY(`messageId`),
	CONSTRAINT `message_origins_native_idx` UNIQUE(`historyImportId`,`nativeMessageId`)
);
--> statement-breakpoint
CREATE TABLE `model_state_artifact_sources` (
	`artifactId` int NOT NULL,
	`conversationId` int NOT NULL,
	`messageId` int,
	`sourceRole` varchar(64) NOT NULL DEFAULT 'evidence',
	`relevance` varchar(32),
	`quoteJson` text
);
--> statement-breakpoint
CREATE TABLE `model_state_artifacts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`snapshotId` int NOT NULL,
	`artifactType` varchar(64) NOT NULL,
	`contentJson` longtext NOT NULL,
	`confidence` varchar(32),
	`status` enum('active','superseded','disputed','archived') NOT NULL DEFAULT 'active',
	`embeddingJson` longtext,
	`embeddingModel` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `model_state_artifacts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `model_state_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`modelRegistryId` int NOT NULL,
	`reconstructionRunId` int NOT NULL,
	`parentSnapshotId` int,
	`version` int NOT NULL,
	`stateSchemaVersion` varchar(64) NOT NULL,
	`status` enum('draft','published','superseded','rejected') NOT NULL DEFAULT 'draft',
	`isCurrent` boolean NOT NULL DEFAULT false,
	`stateSummaryJson` text,
	`stateHash` varchar(128) NOT NULL,
	`publishedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `model_state_snapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `model_state_lane_version_idx` UNIQUE(`userId`,`modelRegistryId`,`version`)
);
--> statement-breakpoint
CREATE TABLE `provider_connections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`providerKey` varchar(64) NOT NULL,
	`externalAccountId` varchar(255),
	`displayLabel` varchar(255),
	`status` enum('pending','active','expired','revoked','error') NOT NULL DEFAULT 'pending',
	`scopesJson` text,
	`secretRef` varchar(255),
	`expiresAt` timestamp,
	`lastValidatedAt` timestamp,
	`metadataJson` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `provider_connections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reconstruction_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`modelRegistryId` int NOT NULL,
	`historyImportId` int,
	`sourceSelectionJson` longtext,
	`strategyVersion` varchar(64) NOT NULL,
	`inputManifestHash` varchar(128) NOT NULL,
	`status` enum('queued','running','completed','partial','failed') NOT NULL DEFAULT 'queued',
	`rawResponseJson` longtext,
	`errorJson` longtext,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reconstruction_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `council_results` MODIFY COLUMN `rawProviderPayload` longtext;--> statement-breakpoint
ALTER TABLE `conversation_messages` ADD `modelStateSnapshotId` int;--> statement-breakpoint
ALTER TABLE `council_results` ADD `modelStateSnapshotId` int;--> statement-breakpoint
ALTER TABLE `council_results` ADD `contextManifestId` int;--> statement-breakpoint
CREATE INDEX `conversation_origins_import_idx` ON `conversation_origins` (`historyImportId`);--> statement-breakpoint
CREATE INDEX `council_context_items_manifest_idx` ON `council_context_items` (`manifestId`);--> statement-breakpoint
CREATE INDEX `council_context_run_idx` ON `council_context_manifests` (`councilRunId`);--> statement-breakpoint
CREATE INDEX `council_context_model_idx` ON `council_context_manifests` (`modelRegistryId`);--> statement-breakpoint
CREATE INDEX `history_imports_user_idx` ON `history_imports` (`userId`);--> statement-breakpoint
CREATE INDEX `history_imports_connection_idx` ON `history_imports` (`providerConnectionId`);--> statement-breakpoint
CREATE INDEX `message_origins_import_idx` ON `message_origins` (`historyImportId`);--> statement-breakpoint
CREATE INDEX `artifact_sources_artifact_idx` ON `model_state_artifact_sources` (`artifactId`);--> statement-breakpoint
CREATE INDEX `artifact_sources_message_idx` ON `model_state_artifact_sources` (`messageId`);--> statement-breakpoint
CREATE INDEX `model_state_artifacts_snapshot_idx` ON `model_state_artifacts` (`snapshotId`);--> statement-breakpoint
CREATE INDEX `model_state_artifacts_status_idx` ON `model_state_artifacts` (`status`);--> statement-breakpoint
CREATE INDEX `model_state_lane_current_idx` ON `model_state_snapshots` (`userId`,`modelRegistryId`,`isCurrent`);--> statement-breakpoint
CREATE INDEX `provider_connections_user_idx` ON `provider_connections` (`userId`);--> statement-breakpoint
CREATE INDEX `provider_connections_provider_idx` ON `provider_connections` (`userId`,`providerKey`);--> statement-breakpoint
CREATE INDEX `reconstruction_runs_user_idx` ON `reconstruction_runs` (`userId`);--> statement-breakpoint
CREATE INDEX `reconstruction_runs_model_idx` ON `reconstruction_runs` (`modelRegistryId`);