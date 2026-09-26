import { describe, expect, it } from "vitest";
import { planSnapshot } from "./reconstruction";
import type { NormalizedStateArtifact } from "./continuity";

function artifact(citations: NormalizedStateArtifact["citations"]): NormalizedStateArtifact {
  return { artifactType: "understanding", content: { statement: "x" }, citations };
}

describe("planSnapshot", () => {
  it("starts at version 1 with no parent when there is no prior snapshot", () => {
    const plan = planSnapshot({ prior: null, artifacts: [artifact([{ conversationId: 1 }])], validConversationIds: new Set([1]) });
    expect(plan.version).toBe(1);
    expect(plan.parentSnapshotId).toBeNull();
    expect(plan.sources).toHaveLength(1);
  });

  it("increments the version and links the parent when a prior snapshot exists", () => {
    const plan = planSnapshot({ prior: { id: 42, version: 3 }, artifacts: [], validConversationIds: new Set() });
    expect(plan.version).toBe(4);
    expect(plan.parentSnapshotId).toBe(42);
  });

  it("drops citations to conversations that were not in the corpus", () => {
    const artifacts = [artifact([{ conversationId: 1 }, { conversationId: 999 }])];
    const plan = planSnapshot({ prior: null, artifacts, validConversationIds: new Set([1]) });
    expect(plan.sources.map(s => s.conversationId)).toEqual([1]);
  });

  it("maps each surviving citation back to its artifact index", () => {
    const artifacts = [artifact([{ conversationId: 1 }]), artifact([{ conversationId: 2 }, { conversationId: 3 }])];
    const plan = planSnapshot({ prior: null, artifacts, validConversationIds: new Set([1, 2, 3]) });
    expect(plan.sources.map(s => s.artifactIndex)).toEqual([0, 1, 1]);
  });

  it("preserves messageId, sourceRole and quote on citations", () => {
    const artifacts = [artifact([{ conversationId: 7, messageId: 8, sourceRole: "contradiction", quote: "no" }])];
    const plan = planSnapshot({ prior: null, artifacts, validConversationIds: new Set([7]) });
    expect(plan.sources[0]).toMatchObject({ conversationId: 7, messageId: 8, sourceRole: "contradiction", quote: "no" });
  });
});
