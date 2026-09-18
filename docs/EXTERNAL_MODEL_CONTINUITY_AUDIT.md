# Cognitive Workspace: External Model Continuity Audit

**Audit date:** 30 August 2026  
**Scope:** Existing implementation only. No application functionality or UI was changed for this audit.

## Executive conclusion

The current implementation is a real authenticated workspace for registering model identities, creating in-app source conversations, deriving model-associated memory records, embedding eligible memories through OpenRouter, retrieving them by cosine similarity, and running parallel OpenRouter-backed councils. It is **not yet an external model continuity system**.

The current `conversations` table represents conversations created inside Cognitive Workspace. It has no origin discriminator, provider identity, native conversation identifier, import batch, provider connection, or historical-source metadata. The current `memories` table represents derived rows attached to a registered model and two source IDs, but it is not a versioned external model state or a reconstruction artifact. No service currently authorizes access to native histories on ChatGPT, Claude, Kimi, MiniMax, or another provider. No reconstruction run allows a model to inspect its accessible historical corpus and derive its own self-model, unresolved threads, relationships, or context. Councils receive a prompt, not a durable model state package or a recorded council-context bundle.

The core relational design can support continuity with additive extensions. The essential next step is to introduce explicit source-origin, provider-connection, import/reconstruction, external-state version, and council-context boundaries rather than overloading the existing in-app conversation and memory tables.

## The six concepts and the current implementation

| Clarified concept | What it means | Current implementation status | Factual evidence |
|---|---|---|---|
| Provider-native conversation history | History that already exists on a provider’s native platform | **Missing** | No provider-history API, native conversation identifier, provider authorization grant, or history retrieval procedure exists in the inspected schema, router, or adapter layer. |
| Imported/provider-sourced conversations | Historical records brought into Cognitive Workspace through legitimate authorization | **Missing as a distinct subsystem** | `conversations` and `conversation_messages` exist, but there is no import origin, provider key, external ID, import job, raw source payload, cursor, deduplication key, or import procedure. |
| Model reconstruction | A model examines accessible history and derives its own memories, interpretations, unresolved threads, relationships, and context | **Missing** | `createMemory` accepts user-supplied content and source IDs. There is no reconstruction run, model-directed extraction protocol, self-authored artifact set, review/version lifecycle, or history-corpus selection. |
| External model state | Durable model-specific representation independent of the provider platform | **Partially present, but not equivalent** | `memories` has `modelRegistryId`, content, type, optional embedding, and source IDs. It is a flat memory ledger, not a versioned state bundle containing reconstruction provenance, state categories, snapshot status, or model-authored interpretations. |
| Cognitive Workspace conversations | Conversations occurring directly inside this application | **Implemented** | `conversations`, `conversation_messages`, `createConversation`, `conversation`, and `sendMessage` persist and retrieve in-app source threads. `sendMessage` makes a real OpenRouter completion for an active registered model. |
| Council context | Temporary/shared information supplied to models during a council | **Implemented only as a minimal prompt fan-out** | `runCouncil` sends each selected model exactly one user turn containing the submitted prompt. It does not attach imported history, external state, retrieved memories, prior council outputs, or a persisted context manifest. |

The current architecture therefore has one real source domain—application-created conversations—and one derived domain—flat model-associated memories. It does not yet model the external continuity lifecycle.

## Current verified data model

The physical schema contains these relevant tables:

| Table | Current purpose | Continuity limitation |
|---|---|---|
| `model_registry` | User-owned provider key, model key, display name, adapter status, capabilities, and notes | Identifies a callable model but does not identify a native account, native conversation corpus, authorization grant, or state snapshot. |
| `conversations` | User-owned title and summary for a source conversation created in the workspace | No `originType`, provider, native conversation ID, import batch, external timestamp, or raw source metadata. |
| `conversation_messages` | Conversation ID, role, content, optional model registry ID, optional provider request ID, and database timestamp | No native message ID, original provider timestamp, source payload, import lineage, or external message ordering key. |
| `memories` | User-owned derived content associated with a model and mandatory source conversation/message IDs; optional JSON embedding and retrieval flag | Not a reconstructable external-state snapshot; no category, confidence, authoring run, revision, supersession, state scope, or many-to-many source set. |
| `council_runs` | User-owned prompt, aggregate status, and timestamps | Stores no context manifest, state snapshot reference, retrieved-memory IDs, or source corpus. |
| `council_results` | One row per selected model with status, response text, raw/normalized success payloads, error, request ID, latency, and timestamps | Does not record the exact context supplied to each model or a model-specific state version. |

The current schema uses indexes for ownership, lookup, and memory provenance, but the migrations do not define foreign keys and `drizzle/relations.ts` is empty. The existing source-to-memory chain is enforced by current router checks rather than by database constraints.

## Current provider boundary

`ModelProviderAdapter` exposes three operations: `listModels`, `complete`, and `embed`. The only registered implementation is `OpenRouterAdapter`, which directly calls OpenRouter’s `/models`, `/chat/completions`, and `/embeddings` endpoints. This is a **model invocation boundary**, not a native-history boundary.

The adapter does not expose operations such as `authorize`, `listNativeConversations`, `getNativeConversation`, `listNativeMessages`, `exportHistory`, `refreshGrant`, or `reconstructState`. There are no adapters for ChatGPT/OpenAI-native history, Anthropic-native history, Kimi, MiniMax, or other provider-native archives. The explicit `anthropic-direct` and `google-direct` entries mean direct model adapters for those keys are unimplemented; they do not establish access to those providers’ native conversation histories.

OpenRouter routing must not be interpreted as native-history access. If an OpenRouter model is hosted by a vendor, the OpenRouter API call provides model inference through OpenRouter; it does not provide the user’s private historical conversation archive on that vendor’s native platform.

## Current memory pipeline versus model reconstruction

The current memory path is:

1. The user submits `modelId`, `sourceConversationId`, `sourceMessageId`, content, type, and eligibility.
2. The router verifies that the conversation belongs to the user.
3. The router verifies that the selected message belongs to that conversation.
4. The router verifies that the selected model belongs to the user.
5. The router attempts a real embedding through the selected model’s adapter using the configured OpenRouter embedding model.
6. The router inserts a single `memories` row.

This is provenance-aware manual derivation. It is not model reconstruction. The model does not independently inspect a historical corpus, choose relevant episodes, state uncertainty, identify unresolved threads, or author a cohesive external-state snapshot. The current API has no reconstruction job or reconstruction input that could represent an imported history set.

The existing memory row is model-associated because it stores `modelRegistryId`. Retrieval can filter by model ID and eligibility, and returns source conversation/message identifiers and the source message timestamp. That provides a useful foundation for continuity, but it is not sufficient to represent the model’s durable external identity or evolving self-authored context.

## Current provenance path and its continuity gap

The existing provenance path is:

```text
memory.sourceMessageId
  -> conversation_messages.id
  -> conversation_messages.conversationId
  -> conversations.id
```

At creation time, the router checks source conversation ownership and source message membership. At retrieval time, it returns conversation ID/title and message ID/timestamp alongside the memory.

For external continuity, that path needs an origin layer. A historical memory should be traceable through something like:

```text
external_state_snapshot
  -> reconstruction_artifact or state_memory
  -> imported_message
  -> imported_conversation
  -> provider_connection / import_batch / native identifiers
```

The current path can be extended without replacing the existing one, but using the current `conversations` table alone would not distinguish a native import from an in-app thread. Provenance must retain provider identity, native conversation/message identifiers, import event, and reconstruction run/version in addition to the current internal IDs.

## What is missing for legitimate provider-native history access

A provider-native continuity system requires more than a completion adapter. The following boundaries are absent.

| Required boundary | Why it is needed | Additive design direction |
|---|---|---|
| Provider connection and authorization grant | Native history access must be tied to a legitimate user authorization with scopes, expiry, revocation, and provider account identity | Add a user-owned `provider_connections` table with provider key, external account ID, encrypted token reference, scopes, status, expiry, and revocation metadata. Keep secrets out of ordinary model rows. |
| Native-history capability interface | History APIs differ from model inference APIs | Add a separate `HistoryProviderAdapter` contract. Do not expand `ModelProviderAdapter` with provider-history methods that every model provider must implement. |
| Import batch and cursor | Imports need resumability, deduplication, error reporting, and auditability | Add `conversation_imports` or `history_import_jobs` with connection, provider, status, cursor, counts, timestamps, and error fields. |
| Imported source identity | Native records need stable IDs and source metadata | Add origin metadata to a separate `conversation_sources`/`imported_conversations` boundary or add a discriminated origin record keyed to `conversations`. Store provider, native conversation ID, native title, native timestamps, and raw-payload reference. |
| Imported message identity | Messages require native IDs and original ordering/timestamps | Add imported-message metadata keyed to `conversation_messages`, including native message ID, parent/native ordering key, original timestamp, and raw payload reference. |
| Reconstruction run | Model-led analysis must be repeatable, inspectable, and versioned | Add `reconstruction_runs` with model registry ID, source scope/import batch, status, prompt/strategy version, token/cost metadata where available, and timestamps. |
| External-state snapshot | Durable model state must be versioned and independently addressable | Add `model_state_snapshots` keyed by user and model, with version, status, reconstruction run, state schema version, and publication/current flags. |
| State artifacts and provenance | Memories, interpretations, unresolved threads, relationships, and context are different artifact types and may cite multiple source messages | Add `model_state_artifacts` plus a many-to-many artifact-source table. Existing `memories` can remain a compatible artifact subtype or be linked to the snapshot. |
| Council context manifest | Models need auditable knowledge of which state and temporary evidence they received | Add `council_context_items` or a persisted manifest keyed by council run/result, referencing snapshot versions, retrieved memories, imported source excerpts, and temporary council instructions. |
| Provider policy and consent | Native histories are sensitive and provider terms vary | Add provider capability/policy metadata, explicit user consent records, retention controls, and user-visible authorization/revocation status. |

These are additive seams. The existing `model_registry`, `conversations`, `conversation_messages`, `memories`, `council_runs`, and `council_results` tables can remain in place while continuity-specific tables and relations are added around them.

## What would need to change in the execution flow

### Authorized import flow

A future import would first establish a provider connection through a legitimate authorization mechanism. The history adapter would enumerate native conversations and messages, persist an import batch, upsert internal source rows using provider-native IDs as deduplication keys, and retain raw source payloads separately from normalized content. Imported records would be marked as provider-sourced rather than silently treated as application-created conversations.

An import must not require the model to be called merely to copy data. The system should preserve the source faithfully first, then make reconstruction a separate explicit operation.

### Model reconstruction flow

A reconstruction run would select a specific model identity, a bounded source corpus, and a reconstruction strategy/version. The model would receive the imported history in controlled chunks or retrieved episodes and would produce typed artifacts such as durable facts, preferences, relationship models, unresolved threads, recurring themes, self-interpretations, and context guidance. Each artifact would reference the reconstruction run and one or more imported messages.

The resulting state should be versioned and publishable as a specific snapshot. A later reconstruction should create a new version or superseding artifacts rather than overwrite the source archive or silently mutate the current state.

### Continuity-aware model invocation

When the model participates in a Cognitive Workspace conversation or council, the invocation layer should optionally assemble context from a chosen external-state snapshot plus temporary council context. The request should record a context manifest or stable hash so the exact state supplied to the model is auditable. The source archive remains unchanged, and council context remains temporary unless explicitly promoted into a new reconstruction/state artifact.

## Council context must remain separate

The current council parent row stores only the prompt. The current per-model result stores provider output audit fields, but neither stores the context package given to each model.

A continuity-aware council should distinguish at least three inputs:

1. **Persistent external model state:** the selected model’s published state snapshot.
2. **Retrieved evidence:** eligible memories or imported source excerpts selected for this council invocation.
3. **Temporary council context:** the current prompt, council instructions, and possibly other models’ outputs in a future multi-round protocol.

These should not be flattened into `conversation_messages` or permanently written to model state merely because they were included in a council request. A council result should reference the exact snapshot and context manifest used, while promotion into durable external state should require a separate explicit reconstruction or curation step.

## Security and privacy implications of continuity

Provider-native history is more sensitive than ordinary in-app prompt data because it involves access to an existing account and potentially a large private archive. A future implementation must therefore add:

- OAuth or another legitimate provider authorization mechanism, with least-privilege scopes and revocation.
- Encrypted token storage or an external secret-reference mechanism; provider tokens must not be stored in `model_registry`, conversation content, or ordinary JSON metadata.
- Per-user and per-connection ownership checks on every import and reconstruction operation.
- Import deduplication and immutable source identifiers to prevent accidental cross-account mixing.
- Explicit provider terms, consent, retention, deletion, and export behavior.
- Redaction and payload-size controls for raw provider archives and reconstruction inputs.
- Audit records showing who authorized an import, which provider account was used, what history range was accessed, and which model generated each state snapshot.
- Isolation so one model’s external state cannot be automatically injected into another model’s context unless explicitly selected.

The current application has server-side OpenRouter key handling, but it has no provider-native credential vault, native-history authorization, consent ledger, or import-specific privacy controls.

## Can the core be extended without redesign?

**Yes, with explicit boundaries.** The existing relational core already provides internal user ownership, model identities, source containers, source messages, derived memory rows, embeddings, and council run/result records. It should be treated as the first-generation internal workspace layer.

The safest extension is not to rename every existing conversation into a universal abstraction. Instead, add an explicit source-origin and continuity layer that can point to existing source rows. A practical compatibility approach is:

1. Keep `conversations` and `conversation_messages` for normalized source content.
2. Add origin metadata and provider-native identity tables for imported rows.
3. Add history adapters separately from model-completion adapters.
4. Add reconstruction runs and versioned external-state snapshots.
5. Link state artifacts to many source messages, including imported messages.
6. Add council context manifests that reference state snapshots and temporary evidence.
7. Preserve existing in-app conversations as a distinct `workspace` origin.

This avoids redesigning the current source/derived principle while preventing the six concepts from collapsing into one table or one memory namespace.

## Verified current capability

Right now, Cognitive Workspace can maintain continuity only for information that a user manually creates or derives inside the application. It can associate a manually entered memory with an in-app source conversation, associate that memory with a registered model, embed it through OpenRouter, retrieve it by semantic similarity, and send a prompt to selected OpenRouter models in a council.

Right now, it cannot legitimately inspect or import a model’s existing native history from ChatGPT, Claude, Kimi, MiniMax, or another native provider. It cannot ask a model to reconstruct its own prior relationship/history state from an imported corpus. It cannot publish or select a versioned external model state snapshot. It cannot record which external state or retrieved evidence a council model received. OpenRouter model access does not provide native-platform history access.

## References

[1]: ../drizzle/schema.ts "Current Drizzle schema"
[2]: ../server/adapters.ts "Current model provider adapter and OpenRouter implementation"
[3]: ../server/routers.ts "Current workspace tRPC procedures"
[4]: ../server/db.ts "Current database helpers and ownership queries"
[5]: ../drizzle/relations.ts "Current empty Drizzle relations declaration"
[6]: ../drizzle/0001_bizarre_onslaught.sql "Current initial workspace migration"
[7]: ../drizzle/0002_slippery_callisto.sql "Current council audit-field migration"
[8]: ../server/_core/env.ts "Current server environment bindings"
[9]: ../server/openrouter.config.test.ts "Current OpenRouter configuration test"
[10]: ../server/workspace.invariants.test.ts "Current schema invariant tests"
[11]: ../client/src/App.tsx "Current application routes"
