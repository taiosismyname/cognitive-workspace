import { describe, expect, it } from "vitest";
import { autoReconstructThreshold, cronAuthorized, planSnapshot, shouldAutoReconstruct } from "./reconstruction";
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

describe("shouldAutoReconstruct", () => {
  it("never triggers when disabled (threshold 0)", () => {
    expect(shouldAutoReconstruct({ lastMessageCount: 0, currentMessageCount: 100, threshold: 0 })).toBe(false);
  });

  it("treats no prior run as a zero baseline", () => {
    expect(shouldAutoReconstruct({ lastMessageCount: null, currentMessageCount: 7, threshold: 8 })).toBe(false);
    expect(shouldAutoReconstruct({ lastMessageCount: null, currentMessageCount: 8, threshold: 8 })).toBe(true);
  });

  it("measures the delta against the last published run, not the total", () => {
    expect(shouldAutoReconstruct({ lastMessageCount: 40, currentMessageCount: 47, threshold: 8 })).toBe(false);
    expect(shouldAutoReconstruct({ lastMessageCount: 40, currentMessageCount: 48, threshold: 8 })).toBe(true);
  });
});

describe("autoReconstructThreshold", () => {
  it("defaults when unset or unparseable", () => {
    expect(autoReconstructThreshold(undefined)).toBe(8);
    expect(autoReconstructThreshold("")).toBe(8);
    expect(autoReconstructThreshold("not-a-number")).toBe(8);
  });

  it("honours an explicit value, including disable", () => {
    expect(autoReconstructThreshold("3")).toBe(3);
    expect(autoReconstructThreshold("0")).toBe(0);
  });

  it("rejects negatives and floors fractions", () => {
    expect(autoReconstructThreshold("-5")).toBe(8);
    expect(autoReconstructThreshold("4.9")).toBe(4);
  });
});

describe("cronAuthorized", () => {
  it("leaves the endpoint inert when no secret is configured", () => {
    expect(cronAuthorized("Bearer anything", undefined)).toBe(false);
    expect(cronAuthorized("Bearer anything", "")).toBe(false);
    expect(cronAuthorized("Bearer anything", "   ")).toBe(false);
  });

  it("rejects a missing or wrong token", () => {
    expect(cronAuthorized(undefined, "s3cret")).toBe(false);
    expect(cronAuthorized("", "s3cret")).toBe(false);
    expect(cronAuthorized("Bearer wrong", "s3cret")).toBe(false);
    expect(cronAuthorized("s3cret", "s3cret")).toBe(false);
  });

  it("accepts the exact bearer token", () => {
    expect(cronAuthorized("Bearer s3cret", "s3cret")).toBe(true);
    expect(cronAuthorized("bearer s3cret", "s3cret")).toBe(true);
    expect(cronAuthorized("Bearer s3cret", "s3cret\n")).toBe(true);
  });
});
