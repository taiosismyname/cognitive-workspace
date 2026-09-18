import { describe, expect, it } from "vitest";
import { buildContinuitySystemMessage, buildConversationAnalysisPrompt, buildSynthesisPrompt, extractJsonObject, parseStateArtifacts, rawConversationSchema, shouldAnalyzeConversation, sha256 } from "./continuity";
import { conversationOrigins, modelStateArtifactSources, modelStateSnapshots, providerConnections, reconstructionRuns } from "../drizzle/schema";

describe("provider history continuity contracts", () => {
  it("accepts the supplied provider-neutral conversation shape", () => {
    const result = rawConversationSchema.safeParse({ context_uuid: "native-1", context_title: "Thread", entries: [{ entry_uuid: "entry-1", query: "hello", answer: "world" }], mode: "COPILOT" });
    expect(result.success).toBe(true);
  });

  it("does not publish a state without model-authored artifacts", () => {
    expect(() => parseStateArtifacts(JSON.stringify({ summary: "empty", artifacts: [] }))).toThrow(/no state artifacts/i);
  });

  it("parses fenced JSON and preserves source citations", () => {
    const state = parseStateArtifacts("```json\n" + JSON.stringify({ summary: "continuity", artifacts: [{ type: "open_loop", content: { title: "Follow up" }, sourceCitations: [{ conversationId: 12, messageId: 34, quote: "exact" }] }] }) + "\n```");
    expect(state.artifacts[0]?.artifactType).toBe("open_loop");
    expect(state.artifacts[0]?.citations[0]).toMatchObject({ conversationId: 12, messageId: 34, quote: "exact" });
  });

  it("builds model-specific context that refuses unprovided memory", () => {
    expect(buildContinuitySystemMessage("Lane A", undefined)).toContain("No published external continuity state");
    expect(buildContinuitySystemMessage("Lane A", { id: 7, version: 2, summary: "summary", artifacts: [] })).toContain("version 2");
  });

  it("hashes stable manifests deterministically", () => {
    expect(sha256({ b: 2, a: 1 })).toBe(sha256({ a: 1, b: 2 }));
  });
});

describe("continuity schema invariants", () => {
  it("keeps provider access separate from model identity", () => {
    expect(providerConnections.userId.notNull).toBe(true);
    expect(providerConnections.providerKey.notNull).toBe(true);
    expect(reconstructionRuns.modelRegistryId.notNull).toBe(true);
  });

  it("keeps imported source identity and artifact evidence explicit", () => {
    expect(conversationOrigins.nativeConversationId).toBeDefined();
    expect(modelStateArtifactSources.conversationId.notNull).toBe(true);
    expect(modelStateArtifactSources.messageId).toBeDefined();
    expect(modelStateSnapshots.parentSnapshotId).toBeDefined();
  });
});

describe("per-conversation analysis", () => {
  const thin = { conversationId: 1, title: "quick check", createdAt: "2025-01-01", messages: [{ id: 1, role: "user", content: "hi" }, { id: 2, role: "assistant", content: "hello!" }] };
  const substantial = { conversationId: 2, title: "architecture discussion", createdAt: "2025-01-02", messages: [{ id: 3, role: "user", content: "Let's design the provenance model for imported conversation history so every claim traces back to a real source message." }] };

  it("skips conversations with no message long enough to be worth analyzing", () => {
    expect(shouldAnalyzeConversation(thin)).toBe(false);
    expect(shouldAnalyzeConversation(substantial)).toBe(true);
  });

  it("skips empty conversations outright", () => {
    expect(shouldAnalyzeConversation({ conversationId: 3, title: null, createdAt: "2025-01-01", messages: [] })).toBe(false);
  });

  it("scopes the per-conversation prompt to only that conversation's id", () => {
    const prompt = buildConversationAnalysisPrompt({ modelName: "Lane A", providerKey: "claude", conversation: substantial });
    expect(prompt).toContain('"conversationId": 2');
    expect(prompt).toContain("in isolation");
    expect(prompt).toContain("possible_error");
  });

  it("produces output parseable by the same parser as the original reconstruction prompt", () => {
    const raw = JSON.stringify({
      summary: "discussed provenance design",
      artifacts: [{ type: "decision", content: { title: "Provenance model" }, confidence: "high", sourceCitations: [{ conversationId: 2, messageId: 3, quote: "provenance model" }] }],
    });
    const parsed = parseStateArtifacts(raw);
    expect(parsed.artifacts[0]?.citations[0]).toMatchObject({ conversationId: 2, messageId: 3 });
  });

  it("builds a synthesis prompt that only carries forward citations already present in the source artifacts", () => {
    const artifacts = [{ artifactType: "decision", content: { title: "x" }, citations: [{ conversationId: 2, messageId: 3 }] }];
    const prompt = buildSynthesisPrompt({ modelName: "Lane A", providerKey: "claude", clusterLabel: "provenance design", artifacts });
    expect(prompt).toContain("provenance design");
    expect(prompt).toContain('"conversationId":2');
  });
});
