# Project TODO

- [x] Establish the elegant Cognitive Workspace shell with responsive dashboard navigation and visual hierarchy
- [x] Add provider-independent model registry with modular adapter boundaries
- [x] Implement real OpenRouter adapter with explicit configuration and error states
- [x] Record unavailable providers as explicitly unimplemented rather than simulating them
- [x] Add source conversation and message archive tables independent from derived memories
- [x] Enforce mandatory memory provenance to source conversations and source messages
- [x] Add persistent model-specific memory records with eligibility controls
- [x] Implement semantic retrieval across eligible memories and return provenance details
- [x] Implement council orchestration across selected registered models using real provider calls only
- [x] Record council runs, per-model execution state, raw/normalized provider results, and failures
- [x] Build workspace dashboard for creating conversations, selecting models, reviewing archives, managing memories, and inspecting council runs
- [x] Add configuration UI for registry and integration readiness without exposing secrets
- [x] Add tests for provenance constraints, adapter behavior, retrieval, and council result handling
- [x] Add GitHub-oriented repository documentation covering boundaries, provenance rules, configuration, and unsupported integrations
- [x] Run type checks, tests, and visual verification; fix discovered issues
- [x] Save final checkpoint and provide the project version for delivery

## Change history

- [x] User requested an elegant, polished workspace with provider-independent models, source archives, provenance-backed memories, semantic retrieval, councils, OpenRouter, and GitHub documentation
- [x] User explicitly prohibited mock model responses and simulated integrations
- [x] User explicitly required unsupported providers to be marked unimplemented
- [x] User explicitly required source conversations to remain separate from derived memories
- [x] User explicitly required every memory to retain provenance to its source conversation and source messages
- [x] User requested the style direction: elegant and polished

## Open implementation notes

- Real OpenRouter credentials must be configured through the project secret flow before live model calls can succeed.
- Provider adapters without a live implementation will be visible as unsupported/unimplemented and will never return fabricated responses.
- GitHub repository setup may require the user's GitHub authorization or repository owner/name choice in the Management UI.
- Semantic retrieval will use the configured embedding capability when available; otherwise the UI/API will report the integration as unavailable rather than silently degrading to fake similarity.
- Councils will persist partial failures and successful real provider outputs independently.

- [x] Add memory creation and eligibility management UI and procedures
- [x] Persist raw provider payloads and normalized council result structures
- [x] Add council run detail inspection with per-model outputs, failures, request IDs, and timing
- [x] Expand integration readiness into a provider and embedding configuration view without exposing secrets

- [x] Add automated coverage for provenance enforcement, retrieval provenance payloads, and council partial-failure persistence
- [x] Build a dedicated integration readiness view listing provider adapters, embedding model, and unsupported states


## Architectural self-audit

- [x] Inventory actual schema, backend services, adapters, pipeline, persistence, tests, and routes
- [x] Trace verified memory isolation, retrieval provenance, council context, and raw/normalized response handling
- [x] Assess real versus unimplemented integrations, configuration requirements, security, privacy, and exportability
- [x] Run the existing test suite without adding functionality
- [x] Deliver a factual report titled “What Cognitive Workspace Can Actually Do Right Now”


## External model continuity clarification

- [x] Audit current implementation against provider-native history, authorized imports, model reconstruction, external model state, in-app conversations, and council context
- [x] Identify missing provider-native authorization and historical import boundaries
- [x] Identify missing model-led reconstruction and durable external-state versioning boundaries
- [x] Determine the additions required to support continuity without redesigning the core data model
- [x] Deliver a clarified continuity-focused architectural audit


## Canonical architecture boundary

- [ ] Treat each model’s provider-native conversations as model-owned source history accessed through that provider’s authorized adapter
- [ ] Treat each model’s reconstruction as an independent model-authored derivation from its accessible native history
- [ ] Treat Cognitive Workspace as the persistent external state layer for model-specific reconstructions
- [ ] Keep council context temporary and explicitly scoped, separate from native history and durable external state


## Continuity lifecycle

- [ ] Model provider history access must feed reconstruction, not bypass it
- [ ] Reconstruction must publish versioned model-specific external state
- [ ] Retrieval and council must consume explicit state versions
- [ ] New exchanges must create update inputs and produce a new state version with lineage to prior state


## Model continuity and identity preservation

- [ ] Support one-time or incremental authorized access to each provider’s native conversation history
- [ ] Let each model independently reconcile history, loose ends, connections, and unresolved threads
- [ ] Preserve model-specific self-constructed state outside the native provider platform
- [ ] Inject only the selected model’s external state into that model’s future native-provider calls
- [ ] Keep council participation native-provider-backed while recording the exact continuity context supplied
- [ ] Protect model identity/state boundaries so one model’s reconstruction is not silently merged into another’s


## Continuity direction decision

- [ ] Continue from the existing Cognitive Workspace substrate; do not restart the project solely because the clarified goal is more specific
- [ ] Preserve the current model registry, source/archive foundation, adapter separation, and OpenRouter integration while adding continuity-specific boundaries


## Provider-neutral import and versioned external state design

- [x] Inspect the attached export structure and identify source fields that can be normalized safely
- [x] Design a provider-neutral history import contract separate from model inference adapters
- [x] Design additive tables for provider connections, imports, native identities, reconstruction runs, state snapshots, artifacts, and provenance
- [x] Define state versioning, publication, isolation, and council-context invariants
- [x] Deliver the design explanation and clearly state that no feature implementation was performed


## First real continuity experiment

- [ ] Use the supplied historical export as a real imported source for one distinct model continuity lane
- [ ] Determine which model/provider the supplied export represents before assigning its reconstructed state
- [ ] Verify Kimi’s current legitimate history-access options before attempting any integration
- [ ] Keep Kimi separate from the supplied export lane and mark it unsupported or pending if no authorized path exists
- [ ] Do not bypass Kimi controls, scrape private history without authorization, or fabricate Kimi history


## Transparent Kimi conversation documentation

- [ ] Verify and record the exact active Kimi conversation title and URL before every capture
- [ ] Preserve each captured Kimi conversation separately with source URL, native conversation ID, role, and message content
- [ ] Maintain an explicit ledger of captured, visible-but-not-captured, and inaccessible conversations
- [ ] Never report browser stalls or session state without a fresh active-page verification


## Sanct comparison

- [ ] Inspect the attached Sanct archive safely without executing its contents
- [ ] Compare Sanct memory, model-interface, import, identity, and orchestration boundaries with Cognitive Workspace
- [ ] Assess whether Sanct should merge into Cognitive Workspace, act as a bridge, or remain separate
- [ ] Identify concrete reusable components and incompatibilities
- [ ] Deliver a grounded comparison and recommendation without modifying either application
