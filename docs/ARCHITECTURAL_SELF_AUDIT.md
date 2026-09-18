# Cognitive Workspace: Architectural Self-Audit

**Audit date:** 30 August 2026  
**Scope:** Existing implementation only. No application functionality was added or changed during this audit.

## Executive verdict

Cognitive Workspace has a real, authenticated full-stack foundation with a normalized MySQL/TiDB schema, protected tRPC procedures, a modular adapter contract, and a direct OpenRouter implementation for model discovery, chat completion, and embeddings. Source conversations and derived memories are represented as separate tables, and the memory-creation procedure checks source ownership and message membership before insertion.

The implementation is not yet a complete production-grade memory platform. Semantic retrieval is implemented as application-side cosine comparison over JSON vectors, not as a database/vector index. Council calls are real, but each council member receives only the council prompt rather than shared deliberation context. Raw and normalized successful provider payloads are preserved; failed payloads are not. The project has a Manus artifact Git remote rather than a GitHub remote, so the GitHub requirement is documented as an export step rather than completed in the repository itself. The existing tests pass, but most workflow claims are covered structurally rather than by procedure-level integration tests.

## Verification status

| Area | Verified finding | Status |
|---|---|---|
| TypeScript | `pnpm check` completed without reported type errors | Passing |
| Tests | `pnpm test` completed with **4 test files and 9 tests passing** | Passing, but limited behavioral coverage |
| Database | Three SQL migration artifacts exist in the repository; the active schema is represented in `drizzle/schema.ts` | Implemented |
| Authentication | Manus OAuth/session plumbing is inherited from the scaffold and workspace procedures use `protectedProcedure` | Implemented, Manus-dependent |
| OpenRouter | Direct `fetch` calls exist for `/models`, `/chat/completions`, and `/embeddings` | Implemented, credential/network-dependent |
| GitHub source repository | `git remote -v` shows a Manus artifact remote, not GitHub | Not completed in current repository |

The OpenRouter test is not a strong end-to-end credential proof: it asserts that `OPENROUTER_API_KEY` exists and performs a live request when possible, but catches network/TLS errors and treats recognized socket failures as an accepted test outcome. Therefore, the test suite passing does not prove that the current environment can reach OpenRouter at test time.

## 1. Fully implemented and working

The following behavior is present in source code and was verified by inspection and tests.

| Capability | Actual implementation |
|---|---|
| Protected workspace API | `workspace.*` procedures are registered under `protectedProcedure` in the main router. |
| Provider-independent registry | `model_registry` stores `providerKey`, `modelKey`, display name, adapter status, capabilities, notes, and user ownership. |
| Modular adapter boundary | `ModelProviderAdapter` requires `listModels`, `complete`, and `embed`; `getAdapter` resolves providers by key. |
| Explicit unsupported-provider state | `anthropic-direct` and `google-direct` are listed as `unimplemented`; unknown keys throw `ProviderUnavailableError`. |
| Source archive | `conversations` and `conversation_messages` persist source titles, roles, content, model identity, request ID, and timestamps. |
| Memory provenance checks | `createMemory` verifies conversation ownership and verifies that the submitted message belongs to that conversation before inserting a memory. |
| Memory/model ownership | Memory creation resolves a user-owned model; model listing and memory listing are filtered by `userId`. |
| Eligibility control | `isRetrievalEligible` is persisted and can be changed through `setMemoryEligibility`, after an ownership lookup. |
| Retrieval result provenance | Retrieval returns memory data plus model data and a provenance object containing conversation ID/title, message ID, and message timestamp when found. |
| Council persistence | One `council_runs` row and one `council_results` row per selected registered model are created; final run status is completed, partial, or failed. |
| Partial result retention | Successful sibling council results remain persisted when another selected model fails. |
| Audit fields | Successful council results store response text, raw provider payload, normalized result JSON, request ID, latency, and completion time. |
| UI routes | `/`, `/models`, `/conversations`, `/memories`, `/councils`, and `/integrations` all resolve to the workspace shell and select a focused view. |

The dashboard is therefore more than a static mock: its forms call real tRPC procedures. However, the existence of a form does not mean the external operation will succeed; success still depends on database availability, registered models, credentials, and provider reachability.

## 2. Implemented but dependent on live configuration or credentials

OpenRouter is the only implemented external model provider. `server/adapters.ts` sends direct HTTPS requests to `https://openrouter.ai/api/v1/` with a server-side `OPENROUTER_API_KEY`. Chat requires a registered model whose `providerKey` resolves to `openrouter`; embeddings use `OPENROUTER_EMBEDDING_MODEL`, defaulting to `openai/text-embedding-3-small`.

The following operations therefore require live conditions:

1. Model discovery requires a valid OpenRouter key and outbound network access.
2. A source chat turn requires a user-owned active OpenRouter model registration and a reachable model.
3. Memory embedding is attempted through OpenRouter. If the adapter reports the provider as unavailable, the memory is still inserted without an embedding and retrieval later reports unavailable; other embedding failures are rethrown.
4. Semantic retrieval requires at least one eligible memory with stored `embeddingJson`, plus a reachable OpenRouter embeddings endpoint.
5. Council execution requires at least one user-owned registered model. Each active provider call must be reachable and accepted by the upstream model.
6. Database-backed operations require `DATABASE_URL`; otherwise the router raises `PRECONDITION_FAILED` for write operations or returns empty lists in the query helpers.

The inherited Manus OAuth flow and server environment are also configuration-dependent. The workspace uses `JWT_SECRET`, `VITE_APP_ID`, `OAUTH_SERVER_URL`, and related Manus variables through the scaffold runtime rather than implementing an independent identity system.

## 3. UI-only or incomplete functional representation

Several visible concepts are represented more strongly in the UI than in the underlying implementation.

| UI representation | Underlying limitation |
|---|---|
| “Integration readiness” | The `/integrations` view reports OpenRouter and fixed unsupported states but does not edit provider configuration, discover models, rotate credentials, or persist integration settings. |
| “Model registry” | Registration is a simple insert form. There is no update, delete, capability refresh, duplicate prevention, or provider-specific configuration record. |
| “Source conversation” | The UI can create a conversation and send a real prompt, but there is no import, export, attachment ingestion, edit, delete, or archival lifecycle. |
| “Memory ledger” | Memory creation accepts user-supplied derived text and source IDs; there is no automatic extraction pipeline, review state, versioning, conflict handling, or deletion. |
| “Semantic retrieval” | Retrieval is real only for memories that have embeddings. There is no vector database, durable query index, pagination, filtering by provenance date, or robust handling of malformed stored vectors. |
| “Council runs” | Calls are real and persisted, but there is no synthesis/judge stage, shared council transcript, cancellation, retry policy, streaming, or export. |
| “GitHub source repository” | Documentation tells the user to export through the Management UI. The inspected Git remote remains a Manus artifact remote. |

No mock provider response path was found in the inspected workspace adapter or router code. The UI does not fabricate model outputs; it displays empty states or server errors when data or providers are unavailable.

## 4. Real versus explicitly unimplemented integrations

| Integration | Classification | Evidence and boundary |
|---|---|---|
| OpenRouter model catalog | Real | `OpenRouterAdapter.listModels()` calls `/models`. |
| OpenRouter chat completion | Real | `OpenRouterAdapter.complete()` calls `/chat/completions` and returns text, request ID, and raw payload. |
| OpenRouter embeddings | Real | `OpenRouterAdapter.embed()` calls `/embeddings` and stores the returned vector as JSON in a memory. |
| Anthropic direct | Explicitly unimplemented | Listed in `unimplementedProviders` with explanatory notes; no adapter is registered. |
| Google direct | Explicitly unimplemented | Listed in `unimplementedProviders` with explanatory notes; no adapter is registered. |
| Manus OAuth | Real scaffold integration | The project uses the supplied callback/session/context plumbing. It is not an independent OAuth implementation. |
| Manus built-in LLM | Present in scaffold, not used by workspace flows | `server/_core/llm.ts` contains a separate Forge-backed LLM helper; `server/routers.ts` imports and uses the OpenRouter adapter instead. |
| S3/file storage | Present in scaffold, not part of the current workspace data flow | Storage helpers exist, but conversations, memories, and council payloads are stored in database text columns; no workspace file procedure was found. |
| GitHub | Not configured as current remote | Repository metadata shows a Manus artifact remote. The docs describe GitHub export as a future/user-operated step. |

## 5. Exact data model

The physical schema is defined in `drizzle/schema.ts` and represented by additive SQL migration files. The migrations create tables and indexes but do **not** declare foreign-key constraints.

| Table | Important columns | Role |
|---|---|---|
| `users` | `id`, `openId`, `name`, `email`, `role`, timestamps | Manus-authenticated application users. |
| `model_registry` | `id`, `userId`, `providerKey`, `modelKey`, `displayName`, `adapterStatus`, `capabilities` JSON, `notes`, timestamps | User-owned provider-independent model identities. |
| `conversations` | `id`, `userId`, `title`, `summary`, timestamps | Source conversation containers. |
| `conversation_messages` | `id`, `conversationId`, `role`, `content`, nullable `modelRegistryId`, nullable `providerRequestId`, `createdAt` | Immutable-ish source message archive rows for system/user/assistant/tool turns. |
| `memories` | `id`, `userId`, `modelRegistryId`, `sourceConversationId`, `sourceMessageId`, `content`, `memoryType`, nullable `embeddingJson`, nullable `embeddingModel`, `isRetrievalEligible`, timestamps | Derived, model-specific memory ledger rows. |
| `council_runs` | `id`, `userId`, `prompt`, `status`, `createdAt`, nullable `completedAt` | Parent record for a multi-model prompt execution. |
| `council_results` | `id`, `councilRunId`, `modelRegistryId`, `status`, nullable `responseText`, `rawProviderPayload`, `normalizedResult`, `errorMessage`, `providerRequestId`, `latencyMs`, timestamps | One per-model outcome within a council run. |

The schema has ownership and lookup indexes, including user indexes, conversation-message conversation index, memory model/provenance indexes, and council-run result index. There are no unique constraints preventing duplicate model registrations or duplicate memories.

## 6. Model-specific memory isolation and retrieval

A memory stores a mandatory `modelRegistryId`, so every derived memory is associated with a registered model identity. Listing memories is user-scoped. Retrieval first loads all memories for the authenticated user, filters to `isRetrievalEligible`, optionally filters by submitted model IDs, and requires a non-null `embeddingJson`.

The query is embedded through the OpenRouter adapter using the configured embedding model. Each stored vector is parsed from JSON and compared with the query vector using `cosineSimilarity`. Results are sorted descending and limited to a maximum of 20. The current implementation performs this scan in application memory; it does not use a database vector type or approximate-nearest-neighbor index.

The isolation is therefore logical and API-enforced, not database-enforced through foreign keys or row-level security. A memory can be associated with any user-owned model, including an inactive/unimplemented model, because `createMemory` checks model ownership but does not require the model’s adapter status to be active.

## 7. Provenance chain

The intended chain is:

`memories.sourceMessageId` → `conversation_messages.id` → `conversation_messages.conversationId` → `conversations.id`.

At insertion time, `createMemory` checks all of the following in application code:

1. `sourceConversationId` belongs to the authenticated user.
2. `modelId` belongs to the authenticated user.
3. `sourceMessageId` appears among messages returned for the submitted source conversation.

At retrieval time, the procedure resolves the source message and source conversation and returns a `provenance` object containing `conversationId`, `conversationTitle`, `messageId`, and `messageCreatedAt`.

The important limitation is that the database itself has no foreign-key constraints, and the `relations.ts` file is empty. Direct SQL or a future code path could create orphaned or cross-user references. The current guarantee is therefore an application-procedure guarantee, not a database invariant.

## 8. Raw provider responses versus normalized representations

For successful council results, the router stores both independent representations:

- `responseText` stores the displayable provider text.
- `rawProviderPayload` stores `JSON.stringify(response.raw)`, where the adapter returns the complete OpenRouter payload it received.
- `normalizedResult` stores a separate JSON envelope containing text, provider request ID, model registry ID, and measured latency.

This is a genuine separation of raw and normalized success data. The source conversation assistant message stores only normalized text plus provider request ID; it does not preserve the raw chat-completion payload. Failed council results store an error message, latency, and completion time, but no raw failed HTTP body, status code, or provider error payload. The adapter itself parses an error response and throws only a message string.

## 9. Council persistence and actual model context

`runCouncil` validates that every submitted model ID belongs to the authenticated user, inserts a parent `council_runs` row, then inserts one `council_results` row per selected model in `running` state. It concurrently calls each model’s adapter with exactly:

```text
messages: [{ role: "user", content: input.prompt }]
```

Thus, each model receives the same user prompt and no conversation history, retrieved memories, other model outputs, system instruction, council role, or shared deliberation context. The council is parallel fan-out, not a multi-round deliberation protocol.

Each successful result is updated with response text, raw payload, normalized envelope, provider request ID, latency, and completion time. Each failed result is updated with failed status, error message, latency, and completion time. The parent status is `completed` if all succeed, `partial` if some succeed, and `failed` if none succeed. There is no final synthesis call.

## 10. Future historical-provider imports

The core source/derived split is a reasonable foundation for future imports. An external provider importer could create a `conversations` row and corresponding `conversation_messages` rows, preserving the provider’s original roles and timestamps where the current schema allows. Memories could then reference imported source rows exactly as they reference live workspace rows.

However, the current model would require extensions for a robust importer rather than a complete redesign. There is no provider/source conversation ID, import batch ID, original message ID, source provider metadata JSON, external timestamp column separate from `createdAt`, deduplication key, or raw imported payload column. The current `createdAt` uses database timestamps and cannot reliably preserve historical event time without additional fields. Imports are therefore structurally compatible but operationally under-modeled.

## 11. Security, privacy, and data-isolation weaknesses

The principal findings are:

| Finding | Risk and consequence |
|---|---|
| No database foreign keys | Provenance and ownership relationships can be violated by direct SQL or future code that bypasses router checks. |
| No database row-level security | Isolation depends on every query using `userId` filters and every mutation performing ownership checks. |
| `listMessages` is not user-scoped by itself | The router protects access by first calling `ownsConversation`, but the helper is unsafe as a standalone boundary. |
| Council result lookup is not user-scoped by itself | `getCouncilResults(councilRunId)` trusts the caller after the parent run has been checked; it is safe through the current route, but not as an independent helper. |
| Raw provider payloads are stored in database text | Payloads may contain provider metadata or content that increases privacy and retention exposure; there is no redaction, retention policy, encryption-at-rest control in application code, or payload-size limit. |
| Conversation content is sent to OpenRouter | The application has no visible consent, provider-retention disclosure, content redaction, or per-model data policy controls. |
| OpenRouter error details are reduced | Failed raw provider responses are not preserved, limiting incident diagnosis and auditability. |
| `setMemoryEligibility` uses list-and-find before update | It is user-safe in the current route, but it performs an in-memory ownership check followed by an update constrained only by memory ID. |
| Live credential test can pass on network failure | The test suite can report green while connectivity or credential validity is unverified at that moment. |
| No rate limiting or request budget | Chat, embedding, and council procedures have no application-level rate limit, quota, timeout, or cancellation policy. |
| Council concurrency is unbounded within the eight-model input limit | Eight simultaneous upstream calls can be made per request, with no provider-specific throttling or retry strategy. |

The server-side placement of `OPENROUTER_API_KEY` is correct in the inspected code: the browser receives only readiness booleans/model names, while the adapter reads the key from server environment state. The UI does not display the secret value.

## 12. Exportability and independent operation outside Manus

The project is conventional enough to be portable at the application level: React, Express, tRPC, Drizzle, MySQL-compatible storage, Vitest, and a direct OpenRouter HTTP adapter are all recognizable external technologies. The `package.json` includes build and start scripts, and the workspace provider integration itself does not require a Manus-only LLM API.

The following dependencies make independent operation incomplete without replacement work:

1. Authentication depends on Manus OAuth routes, session cookies, `OAUTH_SERVER_URL`, `VITE_APP_ID`, and Manus context helpers.
2. The deployment/runtime scaffold depends on Manus WebDev conventions and generated runtime files under `server/_core`.
3. Analytics uses Manus-provided environment configuration in the client HTML.
4. File storage helpers are Manus/S3-integrated and are not abstracted behind a workspace-owned storage interface in the current flows.
5. The current Git remote is a Manus artifact URL, not GitHub.
6. Database migrations are repository artifacts, but the documented workflow uses Manus-specific SQL execution tooling rather than a self-contained migration deployment path.
7. The project has no independent OAuth provider configuration, deployment manifest, Dockerfile, infrastructure definition, secret-management configuration, or operational runbook for a non-Manus host.

The adapter boundary and direct OpenRouter calls reduce portability risk. The auth, hosting, management, secrets, and migration workflow remain the main Manus coupling points.

## Test evidence and limitations

The existing suite ran successfully:

```text
Test Files  4 passed (4)
Tests       9 passed (9)
```

The tests cover adapter lookup and unsupported-provider errors, cosine-similarity primitives, logout cookie clearing, schema-column presence, and a network-tolerant OpenRouter catalog check. They do **not** execute a database-backed `createMemory`, `retrieve`, or `runCouncil` procedure against fixtures or a test database. They therefore do not prove cross-user rejection, source-message mismatch rejection, retrieval provenance payload correctness under live rows, or mixed success/failure council persistence.

## What Cognitive Workspace Can Actually Do Right Now

With a working Manus-authenticated session, database, and valid OpenRouter configuration, a user can register provider-independent model records, create source conversation containers, send real prompts to a registered OpenRouter model, and persist the returned assistant text in the source message archive. The user can create a derived memory only when they provide a user-owned model, a user-owned source conversation, and a message ID that belongs to that conversation. The server attempts a real OpenRouter embedding and stores it when successful; otherwise the memory can remain unembedded and cannot participate in semantic retrieval.

The user can retrieve eligible embedded memories by sending a query that is embedded through OpenRouter. Returned results include the memory, its registered model, and the available source conversation/message provenance fields. The user can run a real parallel council over selected registered models; each model receives only the submitted prompt, and the system persists each success or failure plus the parent run status. Successful council rows retain raw and normalized payload representations separately.

The user cannot currently import historical provider archives, perform vector-database retrieval, run a multi-round council with shared context or synthesis, configure provider credentials from inside the application, recover failed raw provider payloads, or operate the project independently of Manus auth/runtime without additional integration work. The current repository is also not yet a GitHub remote: GitHub export remains a documented Management UI step requiring user authorization.

## References

[1]: ../drizzle/schema.ts "Current Drizzle schema"
[2]: ../drizzle/0001_bizarre_onslaught.sql "Initial workspace migration"
[3]: ../drizzle/0002_slippery_callisto.sql "Council audit-field migration"
[4]: ../server/adapters.ts "Provider adapter contract and OpenRouter implementation"
[5]: ../server/db.ts "Database helpers and ownership queries"
[6]: ../server/routers.ts "Protected workspace tRPC procedures"
[7]: ../server/_core/env.ts "Server environment bindings"
[8]: ../server/_core/llm.ts "Manus Forge LLM helper"
[9]: ../drizzle/relations.ts "Drizzle relation declarations"
[10]: ../server/adapters.test.ts "Adapter and retrieval math tests"
[11]: ../server/workspace.invariants.test.ts "Schema invariant tests"
[12]: ../server/openrouter.config.test.ts "OpenRouter configuration test"
[13]: ../server/auth.logout.test.ts "Auth logout test"
[14]: ../client/src/App.tsx "Application route declarations"
[15]: ../docs/ARCHITECTURE.md "Existing architecture documentation"
