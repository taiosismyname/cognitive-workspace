# Cognitive Workspace: Provider-Neutral History Import and Versioned External State Design

**Purpose:** Define the first continuity slice without implementing it. This design preserves the existing workspace substrate while adding the boundaries required for legitimate provider-native history access, model-led reconstruction, and durable model-specific continuity.

## 1. The design target

Cognitive Workspace should not treat all conversations as one universal memory source. It should model a pipeline with distinct ownership and meaning:

```text
Provider-native history
        │
        ▼
Authorized history access
        │
        ▼
Imported/provider-sourced archive
        │
        ▼
Model reconstruction run
        │
        ▼
Versioned external model state
        │
        ├── model-specific retrieval
        ├── continuity-aware native/OpenRouter exchange
        └── temporary council context
                         │
                         ▼
                 state update input
```

The existing `conversations`, `conversation_messages`, and `memories` tables remain useful, but they must acquire an explicit origin and lifecycle rather than being overloaded to represent provider history, reconstruction, external state, and council context simultaneously.

## 2. What the attached export tells us

The uploaded archive contains two files: an XLSX export and a JSON conversation export. The XLSX contains eight sheets, including a `Memory` sheet with 169 data rows and a `User Preferences` sheet with a `DEFAULT_MODEL` field. The JSON has a top-level `conversations` array with **2,132 conversation objects**. Each conversation object has these verified fields:

```text
collection_uuid
context_title
context_uuid
created_at
entries
mode
updated_at
```

Each sampled `entries` item has these fields:

```text
answer
created_at
entry_uuid
label
query
query_status
```

This is sufficient to normalize a first provider-sourced archive without pretending that the export already contains a universal provider schema. `context_uuid` is a native conversation identifier candidate; `entry_uuid` is a native exchange identifier candidate; `query` and `answer` can be represented as normalized user/assistant message content; `created_at` and `updated_at` provide source timestamps. The `mode`, `label`, `collection_uuid`, and raw JSON should be retained as provider metadata rather than discarded.

The XLSX memory rows are not automatically equivalent to model-reconstructed state. They are an existing user/provider export memory representation. They should be imported as source metadata or explicitly labeled imported memory candidates until a selected model reconstructs and publishes its own state from the imported history.

## 3. Separate contracts: model runtime versus history access

The current `ModelProviderAdapter` is an inference contract with `listModels`, `complete`, and `embed`. Native-history access should be a separate contract. A provider may support chat inference but not native history export, or may support history access only through a different authorization mechanism.

### 3.1 Provider-neutral history adapter

```ts
export type ProviderKey = string;

export type HistoryCapability =
  | "oauth"
  | "manual_import"
  | "browser_session"
  | "list_conversations"
  | "fetch_conversation"
  | "incremental_sync"
  | "revoke";

export type ProviderConnection = {
  connectionId: string;
  providerKey: ProviderKey;
  externalAccountId?: string;
  displayLabel?: string;
  grantedScopes: string[];
  status: "pending" | "active" | "expired" | "revoked" | "error";
  expiresAt?: Date;
};

export type NativeConversationRef = {
  providerKey: ProviderKey;
  nativeConversationId: string;
  nativeAccountId?: string;
  title?: string;
  mode?: string;
  collectionId?: string;
  createdAt?: Date;
  updatedAt?: Date;
  metadata?: Record<string, unknown>;
};

export type NativeMessage = {
  nativeMessageId: string;
  nativeConversationId: string;
  role: "system" | "user" | "assistant" | "tool" | "unknown";
  content: string;
  nativeCreatedAt?: Date;
  nativeOrder?: string | number;
  metadata?: Record<string, unknown>;
};

export type NativeConversation = {
  ref: NativeConversationRef;
  messages: NativeMessage[];
  rawPayload?: unknown;
};

export type HistoryPage<T> = {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
};

export interface HistoryProviderAdapter {
  readonly providerKey: ProviderKey;
  getCapabilities(): Promise<HistoryCapability[]>;
  beginAuthorization(input: {
    userId: number;
    redirectUri: string;
    requestedScopes: string[];
  }): Promise<{ authorizationUrl: string; state: string }>;
  completeAuthorization(input: {
    userId: number;
    state: string;
    authorizationCode: string;
  }): Promise<ProviderConnection>;
  listConversations(input: {
    connection: ProviderConnection;
    cursor?: string;
    updatedAfter?: Date;
  }): Promise<HistoryPage<NativeConversationRef>>;
  fetchConversation(input: {
    connection: ProviderConnection;
    nativeConversationId: string;
  }): Promise<NativeConversation>;
  revoke?(input: { connection: ProviderConnection }): Promise<void>;
}
```

The adapter must never return fabricated conversations. If a provider has no supported legitimate access path, the adapter registry should return an explicit unsupported status. Browser/session access, if ever used, must be a separately reviewed adapter with explicit user authorization; it must not be hidden inside the normal inference adapter.

### 3.2 Import service contract

The import service owns normalization, deduplication, provenance, and resumability. It does not ask a model to interpret the data during the source-preservation step.

```ts
export type ImportMode = "full" | "incremental" | "selected_conversations";

export type StartHistoryImport = {
  userId: number;
  connectionId: string;
  mode: ImportMode;
  selectedNativeConversationIds?: string[];
  cursor?: string;
};

export type ImportReport = {
  importId: string;
  status: "queued" | "running" | "completed" | "partial" | "failed";
  conversationsDiscovered: number;
  conversationsImported: number;
  messagesImported: number;
  duplicatesSkipped: number;
  errors: Array<{ nativeId?: string; code: string; message: string }>;
  nextCursor?: string;
};
```

A normalized imported row should preserve both normalized fields and the original provider payload/reference. The source archive is immutable from the reconstruction service’s perspective. Re-importing the same native conversation should upsert or create a revision based on the provider-native ID and source version, not duplicate the conversation silently.

## 4. Additive database schema

The existing core tables can remain. The following tables add continuity-specific identity and lifecycle without collapsing domains.

### 4.1 `provider_connections`

Stores legitimate access to a provider account, not a model registration.

| Column | Type | Purpose |
|---|---|---|
| `id` | bigint primary key | Internal connection identity |
| `userId` | bigint not null | Owning user |
| `providerKey` | varchar | Provider namespace, such as `chatgpt`, `claude`, or `kimi` |
| `externalAccountId` | varchar nullable | Provider account identity when available |
| `status` | enum | Pending, active, expired, revoked, or error |
| `scopesJson` | text/json | Granted scopes |
| `secretRef` | varchar nullable | Reference to encrypted token storage; never the raw token |
| `expiresAt` | timestamp nullable | Authorization expiry |
| `lastValidatedAt` | timestamp nullable | Last successful validation |
| `metadataJson` | text/json | Non-secret provider metadata |
| `createdAt`, `updatedAt` | timestamp | Lifecycle timestamps |

Recommended uniqueness: `(userId, providerKey, externalAccountId)` when an external account ID exists.

### 4.2 `history_imports`

Represents one auditable import attempt or synchronization run.

| Column | Type | Purpose |
|---|---|---|
| `id` | bigint primary key | Import identity |
| `userId` | bigint not null | Owning user |
| `providerConnectionId` | bigint not null | Authorized source |
| `mode` | enum | Full, incremental, or selected |
| `status` | enum | Queued, running, completed, partial, failed, cancelled |
| `cursor` | text nullable | Provider continuation cursor |
| `sourceSelectionJson` | text/json nullable | Selected native IDs or filters |
| `conversationsDiscovered` | int | Import metrics |
| `conversationsImported` | int | Import metrics |
| `messagesImported` | int | Import metrics |
| `errorJson` | text/json nullable | Structured errors |
| `startedAt`, `completedAt` | timestamp nullable | Run timing |

### 4.3 `conversation_origins`

Keeps current normalized conversations while explicitly distinguishing provider-sourced and workspace-created records.

| Column | Type | Purpose |
|---|---|---|
| `conversationId` | bigint primary key | Existing `conversations.id` |
| `originType` | enum | `workspace`, `provider_import`, or `manual_file_import` |
| `providerConnectionId` | bigint nullable | Source connection for imported rows |
| `historyImportId` | bigint nullable | Import batch that produced the row |
| `providerKey` | varchar nullable | Stable provider namespace |
| `nativeConversationId` | varchar nullable | Provider-native conversation ID |
| `nativeCreatedAt`, `nativeUpdatedAt` | timestamp nullable | Original provider times |
| `rawPayloadRef` | text nullable | Encrypted/S3 reference to original payload |
| `metadataJson` | text/json nullable | Mode, collection, labels, and provider fields |

Recommended uniqueness: `(providerConnectionId, nativeConversationId)`.

### 4.4 `message_origins`

Adds provider-native identity and source fidelity to existing `conversation_messages`.

| Column | Type | Purpose |
|---|---|---|
| `messageId` | bigint primary key | Existing `conversation_messages.id` |
| `historyImportId` | bigint nullable | Import event |
| `nativeMessageId` | varchar nullable | Provider-native message/entry ID |
| `nativeParentId` | varchar nullable | Provider-native parent or tree ID |
| `nativeCreatedAt` | timestamp nullable | Original provider time |
| `nativeOrder` | varchar nullable | Stable ordering key |
| `rawPayloadRef` | text nullable | Original message/entry payload |
| `metadataJson` | text/json nullable | Query status, labels, mode, and provider details |

Recommended uniqueness: `(historyImportId, nativeMessageId)` or `(providerConnectionId, nativeMessageId)` via the import relationship.

### 4.5 `reconstruction_runs`

Represents a model independently examining an imported corpus.

| Column | Type | Purpose |
|---|---|---|
| `id` | bigint primary key | Reconstruction identity |
| `userId` | bigint not null | Owner |
| `modelRegistryId` | bigint not null | Model performing reconstruction |
| `historyImportId` | bigint nullable | Source import scope |
| `sourceSelectionJson` | text/json | Exact source conversations/messages selected |
| `strategyVersion` | varchar | Prompt/parser/schema version |
| `status` | enum | Queued, running, completed, partial, failed |
| `inputManifestHash` | varchar | Reproducible input identity |
| `rawResponseRef` | text nullable | Raw model reconstruction payload |
| `errorJson` | text/json nullable | Structured failure |
| `startedAt`, `completedAt` | timestamp nullable | Timing |

A reconstruction run must identify the model that performed it. The model should not be inferred later from the source provider name.

### 4.6 `model_state_snapshots`

Represents a published version of one model’s external continuity state.

| Column | Type | Purpose |
|---|---|---|
| `id` | bigint primary key | Snapshot identity |
| `userId` | bigint not null | Owner |
| `modelRegistryId` | bigint not null | Model-specific lane |
| `reconstructionRunId` | bigint not null | Producing run |
| `parentSnapshotId` | bigint nullable | Prior state version |
| `version` | int not null | Monotonic per model/user lane |
| `stateSchemaVersion` | varchar | State document schema version |
| `status` | enum | Draft, published, superseded, rejected |
| `isCurrent` | boolean | Current published state marker |
| `stateSummaryJson` | text/json | Compact state envelope and category counts |
| `stateHash` | varchar | Content identity |
| `publishedAt` | timestamp nullable | Publication time |
| `createdAt` | timestamp | Creation time |

Recommended uniqueness: `(userId, modelRegistryId, version)`. At most one current published snapshot should exist per user/model lane.

### 4.7 `model_state_artifacts`

Stores the model’s actual self-constructed units of understanding.

| Column | Type | Purpose |
|---|---|---|
| `id` | bigint primary key | Artifact identity |
| `snapshotId` | bigint not null | Owning external state version |
| `artifactType` | enum/string | Understanding, project, decision, open loop, belief, contradiction, relationship, preference, context, or other |
| `contentJson` | text/json | Structured model-authored content |
| `confidence` | decimal nullable | Model-reported or system-scored confidence |
| `status` | enum | Active, superseded, disputed, archived |
| `embeddingJson` | text/json nullable | Retrieval vector |
| `embeddingModel` | varchar nullable | Embedding identity |
| `createdAt`, `updatedAt` | timestamp | Artifact lifecycle |

### 4.8 `model_state_artifact_sources`

A many-to-many provenance bridge. One artifact may be supported by many imported messages, and one message may support many artifacts.

| Column | Type | Purpose |
|---|---|---|
| `artifactId` | bigint | External-state artifact |
| `conversationId` | bigint | Normalized source conversation |
| `messageId` | bigint nullable | Normalized source message |
| `sourceRole` | enum/string | Evidence, contradiction, context, or related source |
| `relevance` | decimal nullable | Optional model/system relevance |
| `quoteJson` | text/json nullable | Exact cited excerpt or span metadata |

The composite `(artifactId, messageId)` should be unique when a message is the citation unit. This is the continuity-grade provenance layer missing from a single `sourceMessageId` column.

### 4.9 `council_context_manifests` and `council_context_items`

These tables keep temporary council context separate from persistent external state.

A manifest references a `councilRunId`, the participating `modelRegistryId`, the selected `modelStateSnapshotId`, the prompt/context hash, and timing. Items identify included state artifacts, retrieved evidence, imported excerpts, and temporary instructions. A council result should point to the manifest used for that model, making the exact context auditable without promoting it into durable state.

## 5. How the attached export maps into the model

| Export field | Normalized destination | Treatment |
|---|---|---|
| `context_uuid` | `conversation_origins.nativeConversationId` | Stable source identity candidate |
| `context_title` | `conversations.title` | Normalized display title |
| `created_at`, `updated_at` | `conversation_origins.nativeCreatedAt/nativeUpdatedAt` | Preserve original provider time separately from internal timestamps |
| `collection_uuid` | `conversation_origins.metadataJson` or future collection table | Preserve, do not flatten into title |
| `mode` | `conversation_origins.metadataJson` | Provider metadata |
| `entry_uuid` | `message_origins.nativeMessageId` | Stable source entry identity candidate |
| `query` | `conversation_messages` role `user` | Normalized source content |
| `answer` | `conversation_messages` role `assistant` | Normalized source content |
| entry `created_at` | `message_origins.nativeCreatedAt` | Historical timestamp |
| `label`, `query_status` | `message_origins.metadataJson` | Preserve source semantics |
| XLSX `MEMORY_KEY`, `MEMORY_VALUE` | Imported memory candidate metadata | Do not automatically publish as model reconstruction |

The sample export’s `entries` array length is one for the first conversation inspected, so the importer must support one-entry and multi-entry conversations without assuming a fixed shape. It should also preserve raw JSON because a provider’s normalized fields may evolve or omit branch/tool/system information.

## 6. State update lifecycle

A first reconstruction creates snapshot version 1 for a specific model and source corpus. A later exchange creates an update input referencing the current snapshot, the new source message(s), and any newly imported history. A subsequent reconstruction produces version 2 with `parentSnapshotId = version 1`. Version 1 remains immutable and auditable; version 2 becomes current only after validation/publication.

A state update should not mean “append arbitrary text to memory.” It should re-evaluate affected artifacts, create new artifacts where necessary, mark superseded or contradicted artifacts explicitly, and retain the source citations that caused the change. This is how the system can tie up loose ends and make new connections without erasing earlier interpretations.

## 7. What is deliberately not in this first slice

This design does not assume that every provider offers a public history API. It does not prescribe a browser automation implementation, bypass access controls, or simulate provider access. Each provider must declare what legitimate mechanism it supports: OAuth API, user-supplied export, approved session bridge, or unsupported.

It also does not make the current council a reconstruction engine. Council synthesis, if added later, should receive selected state snapshots and temporary context manifests; it should not silently publish council output into a model’s persistent state. State publication remains a separate model reconstruction or explicit curation step.

## 8. Recommended implementation order

The safest implementation sequence is:

1. Add the provider-neutral types and adapter registry without changing the current inference adapter.
2. Add provider connection and import-job records with encrypted secret references, not raw tokens.
3. Add origin tables and import normalization for one real export format—the attached JSON/XLSX pair is a suitable test fixture after privacy review.
4. Add reconstruction runs and snapshot/artifact tables.
5. Implement one model-led reconstruction flow over imported source rows.
6. Add state-aware retrieval and context manifests.
7. Update councils only after per-model state loading and context recording are verified.

This sequence keeps provider-specific complexity at the edge and lets the core remain portable.

## References

[1]: ../drizzle/schema.ts "Current Drizzle schema"
[2]: ../server/adapters.ts "Current model inference adapter contract"
[3]: ../server/routers.ts "Current workspace procedures"
[4]: ../server/db.ts "Current database helper layer"
[5]: ../docs/EXTERNAL_MODEL_CONTINUITY_AUDIT.md "Previous continuity-focused architectural audit"
[6]: ../docs/ARCHITECTURE.md "Existing architecture documentation"
[7]: ../scripts/inspect_export.py "Safe export inspection script"
[8]: ./export_inspection.txt "Verified export structure summary"
