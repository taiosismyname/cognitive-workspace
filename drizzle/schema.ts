import {
  bigint,
  boolean,
  index,
  int,
  json,
  longtext,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }).unique(),
  passwordHash: varchar("passwordHash", { length: 255 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const modelRegistry = mysqlTable(
  "model_registry",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    providerKey: varchar("providerKey", { length: 64 }).notNull(),
    modelKey: varchar("modelKey", { length: 255 }).notNull(),
    displayName: varchar("displayName", { length: 255 }).notNull(),
    adapterStatus: mysqlEnum("adapterStatus", ["active", "unimplemented", "disabled"]).notNull().default("active"),
    capabilities: json("capabilities"),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ ownerIdx: index("model_registry_user_idx").on(table.userId) }),
);

export const conversations = mysqlTable(
  "conversations",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    summary: text("summary"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({ ownerIdx: index("conversations_user_idx").on(table.userId) }),
);

// NOTE: added modelStateSnapshotId — present in 0001_nice_albert_cleary.sql
// but missing from the schema.ts you had. Without it, any message inserted
// under a continuity-backed reply has nowhere to record which snapshot
// produced it.
export const conversationMessages = mysqlTable(
  "conversation_messages",
  {
    id: int("id").autoincrement().primaryKey(),
    conversationId: int("conversationId").notNull(),
    role: mysqlEnum("role", ["system", "user", "assistant", "tool"]).notNull(),
    content: text("content").notNull(),
    modelRegistryId: int("modelRegistryId"),
    modelStateSnapshotId: int("modelStateSnapshotId"),
    providerRequestId: varchar("providerRequestId", { length: 255 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({ conversationIdx: index("conversation_messages_conversation_idx").on(table.conversationId) }),
);

// NEW — provenance link from an in-app conversation back to the provider-native
// thread it was imported from (or marks it as workspace-native).
export const conversationOrigins = mysqlTable(
  "conversation_origins",
  {
    conversationId: int("conversationId").primaryKey(),
    originType: mysqlEnum("originType", ["workspace", "provider_import", "manual_file_import"]).notNull(),
    providerConnectionId: int("providerConnectionId"),
    historyImportId: int("historyImportId"),
    providerKey: varchar("providerKey", { length: 64 }),
    nativeConversationId: varchar("nativeConversationId", { length: 255 }),
    nativeCreatedAt: timestamp("nativeCreatedAt"),
    nativeUpdatedAt: timestamp("nativeUpdatedAt"),
    rawPayloadJson: longtext("rawPayloadJson"),
    metadataJson: text("metadataJson"),
  },
  table => ({
    nativeIdx: unique("conversation_origins_native_idx").on(table.providerConnectionId, table.nativeConversationId),
    importIdx: index("conversation_origins_import_idx").on(table.historyImportId),
  }),
);

// NEW — same idea, per message, for imports that go message-by-message.
export const messageOrigins = mysqlTable(
  "message_origins",
  {
    messageId: int("messageId").primaryKey(),
    historyImportId: int("historyImportId"),
    nativeMessageId: varchar("nativeMessageId", { length: 255 }),
    nativeParentId: varchar("nativeParentId", { length: 255 }),
    nativeCreatedAt: timestamp("nativeCreatedAt"),
    nativeOrder: varchar("nativeOrder", { length: 64 }),
    rawPayloadJson: longtext("rawPayloadJson"),
    metadataJson: text("metadataJson"),
  },
  table => ({
    nativeIdx: unique("message_origins_native_idx").on(table.historyImportId, table.nativeMessageId),
    importIdx: index("message_origins_import_idx").on(table.historyImportId),
  }),
);

// NEW — an authorized connection to an external provider (Kimi, ChatGPT, etc.)
// that a history import or reconstruction run can be traced back to.
export const providerConnections = mysqlTable(
  "provider_connections",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    providerKey: varchar("providerKey", { length: 64 }).notNull(),
    externalAccountId: varchar("externalAccountId", { length: 255 }),
    displayLabel: varchar("displayLabel", { length: 255 }),
    status: mysqlEnum("status", ["pending", "active", "expired", "revoked", "error"]).notNull().default("pending"),
    scopesJson: text("scopesJson"),
    secretRef: varchar("secretRef", { length: 255 }),
    expiresAt: timestamp("expiresAt"),
    lastValidatedAt: timestamp("lastValidatedAt"),
    metadataJson: text("metadataJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    ownerIdx: index("provider_connections_user_idx").on(table.userId),
    providerIdx: index("provider_connections_provider_idx").on(table.userId, table.providerKey),
  }),
);

// NEW — one job that pulls a batch of history from a provider connection.
export const historyImports = mysqlTable(
  "history_imports",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    providerConnectionId: int("providerConnectionId").notNull(),
    mode: mysqlEnum("mode", ["full", "incremental", "selected_conversations"]).notNull(),
    status: mysqlEnum("status", ["queued", "running", "completed", "partial", "failed", "cancelled"]).notNull().default("queued"),
    sourceFileName: varchar("sourceFileName", { length: 255 }),
    cursor: text("cursor"),
    sourceSelectionJson: text("sourceSelectionJson"),
    conversationsDiscovered: int("conversationsDiscovered").notNull().default(0),
    conversationsImported: int("conversationsImported").notNull().default(0),
    messagesImported: int("messagesImported").notNull().default(0),
    duplicatesSkipped: int("duplicatesSkipped").notNull().default(0),
    errorJson: longtext("errorJson"),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    ownerIdx: index("history_imports_user_idx").on(table.userId),
    connectionIdx: index("history_imports_connection_idx").on(table.providerConnectionId),
  }),
);

// NEW — the job that asks a model to reconstruct its own continuity state
// from an imported archive. This is what continuity.ts's prompt builders feed.
export const reconstructionRuns = mysqlTable(
  "reconstruction_runs",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    modelRegistryId: int("modelRegistryId").notNull(),
    historyImportId: int("historyImportId"),
    sourceSelectionJson: longtext("sourceSelectionJson"),
    strategyVersion: varchar("strategyVersion", { length: 64 }).notNull(),
    inputManifestHash: varchar("inputManifestHash", { length: 128 }).notNull(),
    status: mysqlEnum("status", ["queued", "running", "completed", "partial", "failed"]).notNull().default("queued"),
    rawResponseJson: longtext("rawResponseJson"),
    errorJson: longtext("errorJson"),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    ownerIdx: index("reconstruction_runs_user_idx").on(table.userId),
    modelIdx: index("reconstruction_runs_model_idx").on(table.modelRegistryId),
  }),
);

// NEW — a versioned, published continuity state for one model lane. This is
// the row buildContinuitySystemMessage() in continuity.ts renders into a prompt.
export const modelStateSnapshots = mysqlTable(
  "model_state_snapshots",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    modelRegistryId: int("modelRegistryId").notNull(),
    reconstructionRunId: int("reconstructionRunId").notNull(),
    parentSnapshotId: int("parentSnapshotId"),
    version: int("version").notNull(),
    stateSchemaVersion: varchar("stateSchemaVersion", { length: 64 }).notNull(),
    status: mysqlEnum("status", ["draft", "published", "superseded", "rejected"]).notNull().default("draft"),
    isCurrent: boolean("isCurrent").notNull().default(false),
    stateSummaryJson: text("stateSummaryJson"),
    stateHash: varchar("stateHash", { length: 128 }).notNull(),
    publishedAt: timestamp("publishedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    laneVersionIdx: unique("model_state_lane_version_idx").on(table.userId, table.modelRegistryId, table.version),
    laneCurrentIdx: index("model_state_lane_current_idx").on(table.userId, table.modelRegistryId, table.isCurrent),
  }),
);

// NEW — one cited "understanding/project/decision/open_loop/..." unit inside
// a snapshot. Matches NormalizedStateArtifact in continuity.ts.
export const modelStateArtifacts = mysqlTable(
  "model_state_artifacts",
  {
    id: int("id").autoincrement().primaryKey(),
    snapshotId: int("snapshotId").notNull(),
    artifactType: varchar("artifactType", { length: 64 }).notNull(),
    contentJson: longtext("contentJson").notNull(),
    confidence: varchar("confidence", { length: 32 }),
    status: mysqlEnum("status", ["active", "superseded", "disputed", "archived"]).notNull().default("active"),
    embeddingJson: longtext("embeddingJson"),
    embeddingModel: varchar("embeddingModel", { length: 255 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    snapshotIdx: index("model_state_artifacts_snapshot_idx").on(table.snapshotId),
    statusIdx: index("model_state_artifacts_status_idx").on(table.status),
  }),
);

// NEW — the citation rows (conversationId/messageId/quote) attached to each
// artifact. This is the enforcement point for "every artifact must cite its source."
export const modelStateArtifactSources = mysqlTable("model_state_artifact_sources", {
  artifactId: int("artifactId").notNull(),
  conversationId: int("conversationId").notNull(),
  messageId: int("messageId"),
  sourceRole: varchar("sourceRole", { length: 64 }).notNull().default("evidence"),
  relevance: varchar("relevance", { length: 32 }),
  quoteJson: text("quoteJson"),
}, table => ({
  artifactIdx: index("artifact_sources_artifact_idx").on(table.artifactId),
  messageIdx: index("artifact_sources_message_idx").on(table.messageId),
}));

// NEW — the frozen bundle of context (which snapshot version, which items)
// that was actually handed to one model in one council run.
export const councilContextManifests = mysqlTable(
  "council_context_manifests",
  {
    id: int("id").autoincrement().primaryKey(),
    councilRunId: int("councilRunId").notNull(),
    modelRegistryId: int("modelRegistryId").notNull(),
    modelStateSnapshotId: int("modelStateSnapshotId"),
    contextHash: varchar("contextHash", { length: 128 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    runIdx: index("council_context_run_idx").on(table.councilRunId),
    modelIdx: index("council_context_model_idx").on(table.modelRegistryId),
  }),
);

export const councilContextItems = mysqlTable(
  "council_context_items",
  {
    id: int("id").autoincrement().primaryKey(),
    manifestId: int("manifestId").notNull(),
    itemType: varchar("itemType", { length: 64 }).notNull(),
    sourceId: int("sourceId"),
    contentJson: longtext("contentJson").notNull(),
    ordinal: int("ordinal").notNull().default(0),
  },
  table => ({ manifestIdx: index("council_context_items_manifest_idx").on(table.manifestId) }),
);

export const memories = mysqlTable(
  "memories",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    modelRegistryId: int("modelRegistryId").notNull(),
    sourceConversationId: int("sourceConversationId").notNull(),
    sourceMessageId: int("sourceMessageId").notNull(),
    content: text("content").notNull(),
    memoryType: varchar("memoryType", { length: 64 }).notNull().default("fact"),
    embeddingJson: text("embeddingJson"),
    embeddingModel: varchar("embeddingModel", { length: 255 }),
    isRetrievalEligible: boolean("isRetrievalEligible").notNull().default(true),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    ownerIdx: index("memories_user_idx").on(table.userId),
    modelIdx: index("memories_model_idx").on(table.modelRegistryId),
    provenanceIdx: index("memories_provenance_idx").on(table.sourceConversationId, table.sourceMessageId),
  }),
);

export const councilRuns = mysqlTable(
  "council_runs",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    prompt: text("prompt").notNull(),
    status: mysqlEnum("status", ["running", "completed", "partial", "failed"]).notNull().default("running"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    completedAt: timestamp("completedAt"),
  },
  table => ({ ownerIdx: index("council_runs_user_idx").on(table.userId) }),
);

// NOTE: added modelStateSnapshotId + contextManifestId — present in the SQL
// migration but missing from the schema.ts you had. Without these there's no
// way to record which continuity state (if any) backed a given council result.
export const councilResults = mysqlTable(
  "council_results",
  {
    id: int("id").autoincrement().primaryKey(),
    councilRunId: int("councilRunId").notNull(),
    modelRegistryId: int("modelRegistryId").notNull(),
    modelStateSnapshotId: int("modelStateSnapshotId"),
    contextManifestId: int("contextManifestId"),
    status: mysqlEnum("status", ["running", "completed", "failed"]).notNull().default("running"),
    responseText: text("responseText"),
    rawProviderPayload: longtext("rawProviderPayload"),
    normalizedResult: text("normalizedResult"),
    errorMessage: text("errorMessage"),
    providerRequestId: varchar("providerRequestId", { length: 255 }),
    latencyMs: bigint("latencyMs", { mode: "number" }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    completedAt: timestamp("completedAt"),
  },
  table => ({ runIdx: index("council_results_run_idx").on(table.councilRunId) }),
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type ModelRegistry = typeof modelRegistry.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type ConversationMessage = typeof conversationMessages.$inferSelect;
export type ConversationOrigin = typeof conversationOrigins.$inferSelect;
export type MessageOrigin = typeof messageOrigins.$inferSelect;
export type ProviderConnection = typeof providerConnections.$inferSelect;
export type HistoryImport = typeof historyImports.$inferSelect;
export type ReconstructionRun = typeof reconstructionRuns.$inferSelect;
export type ModelStateSnapshot = typeof modelStateSnapshots.$inferSelect;
export type ModelStateArtifact = typeof modelStateArtifacts.$inferSelect;
export type ModelStateArtifactSource = typeof modelStateArtifactSources.$inferSelect;
export type CouncilContextManifest = typeof councilContextManifests.$inferSelect;
export type CouncilContextItem = typeof councilContextItems.$inferSelect;
export type Memory = typeof memories.$inferSelect;
export type CouncilRun = typeof councilRuns.$inferSelect;
export type CouncilResult = typeof councilResults.$inferSelect;
