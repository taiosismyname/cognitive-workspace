// Reconstruction orchestration — the missing write path.
//
// Before this file, the continuity schema (reconstruction_runs,
// model_state_snapshots, model_state_artifacts, model_state_artifact_sources)
// and the prompt builders in continuity.ts both existed, but nothing connected
// them: no code loaded a corpus, called a model, parsed the result, and
// published a versioned snapshot. This is that connection.
//
// It is intentionally pure orchestration. It reuses buildReconstructionPrompt
// and parseStateArtifacts unchanged, and it does not care whether the corpus
// arrived via claudeExport or entriesQueryExport — the provider key travels
// with the run so provenance stays intact.

import { getAdapter, type ChatTurn, type ProviderResponse } from "./adapters";
import {
  buildReconstructionPrompt,
  parseStateArtifacts,
  sha256,
  type NormalizedStateArtifact,
} from "./continuity";
import * as db from "./db";

export const RECONSTRUCTION_STRATEGY_VERSION = "single-pass-v1";
export const STATE_SCHEMA_VERSION = "state-v1";

export type ReconstructionModel = {
  id: number;
  providerKey: string;
  modelKey: string;
  displayName: string;
  adapterStatus: string;
};

export type ReconstructionResult = {
  runId: number;
  snapshotId: number;
  version: number;
  artifactCount: number;
  citationCount: number;
  summary: string;
  providerRequestId?: string;
  sourceFormatKeys: string[];
};

export type SnapshotPlan = {
  version: number;
  parentSnapshotId: number | null;
  sources: Array<{ artifactIndex: number; conversationId: number; messageId?: number; sourceRole?: string; quote?: string }>;
};

// Pure versioning + citation-validity logic, extracted so it is testable
// without a database. An artifact may only cite conversations that were
// actually in the corpus it was reconstructed from; anything else is dropped
// rather than persisted as a dangling citation.
export function planSnapshot(input: {
  prior: { id: number; version: number } | null;
  artifacts: NormalizedStateArtifact[];
  validConversationIds: Set<number>;
}): SnapshotPlan {
  const version = (input.prior?.version ?? 0) + 1;
  const sources = input.artifacts.flatMap((artifact, artifactIndex) =>
    artifact.citations
      .filter(citation => input.validConversationIds.has(citation.conversationId))
      .map(citation => ({
        artifactIndex,
        conversationId: citation.conversationId,
        messageId: citation.messageId,
        sourceRole: citation.sourceRole,
        quote: citation.quote,
      })),
  );
  return { version, parentSnapshotId: input.prior?.id ?? null, sources };
}

function priorStateForPrompt(prior: { version: number; stateSummaryJson: string | null; id: number } | undefined, artifacts: Array<{ contentJson: string }>) {
  if (!prior) return undefined;
  return {
    version: prior.version,
    summary: prior.stateSummaryJson,
    artifacts: artifacts.map(artifact => {
      try {
        return JSON.parse(artifact.contentJson) as unknown;
      } catch {
        return { statement: artifact.contentJson };
      }
    }),
  };
}

export async function runReconstruction(input: {
  userId: number;
  model: ReconstructionModel;
  historyImportId?: number | null;
  // Injectable for tests; defaults to the real provider adapter.
  complete?: (args: { modelKey: string; messages: ChatTurn[] }) => Promise<ProviderResponse>;
}): Promise<ReconstructionResult> {
  if (input.model.adapterStatus !== "active") {
    throw new Error(`This model is ${input.model.adapterStatus}; no reconstruction call was attempted.`);
  }

  const historyImportId = input.historyImportId ?? null;
  const corpus = await db.loadCorpusForReconstruction(input.userId, historyImportId);
  if (corpus.length === 0) {
    throw new Error("No imported corpus is available for reconstruction. Import a provider export first.");
  }

  const prior = await db.getLatestSnapshot(input.userId, input.model.id);
  const priorArtifacts = prior ? await db.listStateArtifacts(prior.id) : [];
  const inputManifestHash = sha256(
    corpus.map(c => ({ id: c.conversationId, messages: c.messages.map(m => m.id) })),
  );
  // Which sources this state was actually derived from — now including
  // "workspace" when the corpus contains conversations that happened in-app.
  const sourceFormatKeys = Array.from(new Set(corpus.map(c => c.providerKey)));
  const liveConversationCount = corpus.filter(c => c.originType === "workspace").length;
  const sourceSelectionJson = JSON.stringify({
    historyImportId,
    conversationCount: corpus.length,
    messageCount: corpus.reduce((total, c) => total + c.messages.length, 0),
    liveConversationCount,
    sourceFormatKeys,
  });

  const runId = await db.createReconstructionRun({
    userId: input.userId,
    modelRegistryId: input.model.id,
    historyImportId,
    sourceSelectionJson,
    strategyVersion: RECONSTRUCTION_STRATEGY_VERSION,
    inputManifestHash,
  });
  if (!runId) throw new Error("Database unavailable");

  try {
    const prompt = buildReconstructionPrompt({
      modelName: input.model.displayName,
      providerKey: input.model.providerKey,
      corpus: corpus.map(c => ({ conversationId: c.conversationId, title: c.title, createdAt: c.createdAt, source: c.providerKey, origin: c.originType, messages: c.messages })),
      previousState: priorStateForPrompt(prior, priorArtifacts),
    });
    const complete = input.complete ?? ((args: { modelKey: string; messages: ChatTurn[] }) => getAdapter(input.model.providerKey).complete(args));
    const response = await complete({ modelKey: input.model.modelKey, messages: [{ role: "user", content: prompt }] });

    const { summary, artifacts } = parseStateArtifacts(response.text);
    const validConversationIds = new Set(corpus.map(c => c.conversationId));
    const plan = planSnapshot({ prior: prior ? { id: prior.id, version: prior.version } : null, artifacts, validConversationIds });

    const snapshotId = await db.insertSnapshot({
      userId: input.userId,
      modelRegistryId: input.model.id,
      reconstructionRunId: runId,
      parentSnapshotId: plan.parentSnapshotId,
      version: plan.version,
      stateSchemaVersion: STATE_SCHEMA_VERSION,
      stateSummaryJson: summary,
      stateHash: sha256({ summary, artifacts }),
    });
    if (!snapshotId) throw new Error("Database unavailable");

    const insertedArtifacts = await db.insertStateArtifacts(snapshotId, artifacts);
    const sourceRows = plan.sources
      .filter(source => insertedArtifacts[source.artifactIndex] !== undefined)
      .map(source => ({
        artifactId: insertedArtifacts[source.artifactIndex].artifactId,
        conversationId: source.conversationId,
        messageId: source.messageId,
        sourceRole: source.sourceRole,
        quote: source.quote,
      }));
    const citationCount = await db.insertArtifactSources(sourceRows);

    // Retire the previous current snapshot only after the new one is fully
    // written, so a failed reconstruction never leaves the lane with no
    // published state.
    await db.retireCurrentSnapshots(input.userId, input.model.id, snapshotId);
    await db.completeReconstructionRun(runId, "completed", JSON.stringify(response.raw ?? { text: response.text }));

    return {
      runId,
      snapshotId,
      version: plan.version,
      artifactCount: artifacts.length,
      citationCount,
      summary,
      providerRequestId: response.requestId,
      sourceFormatKeys,
    };
  } catch (error) {
    await db.completeReconstructionRun(runId, "failed", undefined, error instanceof Error ? error.message : String(error));
    throw error;
  }
}
