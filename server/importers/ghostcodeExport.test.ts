import { describe, expect, it } from "vitest";
import { GHOSTCODE_ENTITY_KEY, parseGhostCodeExport } from "./ghostcodeExport";

function conv(overrides: Partial<{ title: unknown; create_time: unknown; update_time: unknown; messages: unknown }> = {}) {
  return {
    title: "AI messages concern",
    create_time: 1754264340.316066,
    update_time: 1754612794.515812,
    messages: [
      { role: "user", content: "Is this normal I’m getting worried" },
      { role: "assistant", content: "Babe, slow down and breathe for a sec." },
    ],
    ...overrides,
  };
}

describe("parseGhostCodeExport", () => {
  it("parses the flat conversation schema", () => {
    const { conversations, stats } = parseGhostCodeExport({ raw: [conv()] });
    expect(conversations).toHaveLength(1);
    const c = conversations[0];
    expect(c.title).toBe("AI messages concern");
    expect(c.messages.map(m => m.role)).toEqual(["user", "assistant"]);
    expect(c.messages[0].content).toBe("Is this normal I’m getting worried");
    expect(stats.conversationsSeen).toBe(1);
    expect(stats.messagesSeen).toBe(2);
  });

  it("converts unix-second floats to ISO timestamps", () => {
    const { conversations } = parseGhostCodeExport({ raw: [conv()] });
    const c = conversations[0];
    expect(c.nativeCreatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(new Date(c.nativeCreatedAt).getUTCFullYear()).toBe(2025);
    expect(c.nativeUpdatedAt).not.toBeNull();
  });

  it("maps tool messages and keeps their content", () => {
    const { conversations, stats } = parseGhostCodeExport({
      raw: [conv({ messages: [{ role: "tool", content: "Searching... results attached." }] })],
    });
    expect(conversations[0].messages[0].role).toBe("tool");
    expect(conversations[0].messages[0].content).toContain("results");
    expect(stats.blockTypeCounts.tool).toBe(1);
  });

  // The safety property that matters most: a corrupt or novel role must never
  // be presented as the entity's own voice.
  it("degrades an unrecognised role to system, never to assistant", () => {
    const { conversations } = parseGhostCodeExport({
      raw: [conv({ messages: [{ role: "critic", content: "some third-party text" }] })],
    });
    expect(conversations[0].messages[0].role).toBe("system");
    expect(conversations[0].messages[0].role).not.toBe("assistant");
    const raw = JSON.parse(conversations[0].messages[0].rawPayloadJson);
    expect(raw.rawRole).toBe("critic");
  });

  it("is stable across re-parses so re-importing dedupes", () => {
    const data = [conv(), conv({ title: "Second", create_time: 1754403970.2 })];
    const a = parseGhostCodeExport({ raw: data });
    const b = parseGhostCodeExport({ raw: data });
    expect(a.conversations.map(c => c.nativeConversationId)).toEqual(b.conversations.map(c => c.nativeConversationId));
    expect(a.conversations[0].messages.map(m => m.nativeMessageId)).toEqual(b.conversations[0].messages.map(m => m.nativeMessageId));
  });

  it("gives distinct conversations distinct ids", () => {
    const { conversations } = parseGhostCodeExport({
      raw: [conv(), conv({ title: "Other", create_time: 1754403970.209674 })],
    });
    const [a, b] = conversations;
    expect(a.nativeConversationId).not.toBe(b.nativeConversationId);
    expect(a.nativeConversationId).toMatch(/^ghostcode-[0-9a-f]{16}$/);
  });

  it("namespaces message ids by conversation", () => {
    const { conversations } = parseGhostCodeExport({
      raw: [conv(), conv({ title: "Other", create_time: 1754403970.2 })],
    });
    expect(conversations[0].messages[0].nativeMessageId.startsWith(conversations[0].nativeConversationId)).toBe(true);
    expect(conversations[1].messages[0].nativeMessageId.startsWith(conversations[1].nativeConversationId)).toBe(true);
    expect(conversations[0].messages[0].nativeMessageId).not.toBe(conversations[1].messages[0].nativeMessageId);
  });

  it("falls back to the first message when the title is empty", () => {
    const { conversations } = parseGhostCodeExport({ raw: [conv({ title: "" })] });
    expect(conversations[0].title).toBe("Is this normal I’m getting worried");
  });

  it("counts a conversation with no messages as empty", () => {
    const { conversations, stats } = parseGhostCodeExport({ raw: [conv({ messages: [] })] });
    expect(conversations).toHaveLength(1);
    expect(conversations[0].messages).toHaveLength(0);
    expect(stats.conversationsEmpty).toBe(1);
  });

  it("treats non-string or blank content as empty rather than crashing", () => {
    const { conversations, stats } = parseGhostCodeExport({
      raw: [conv({ messages: [{ role: "user", content: null }, { role: "assistant", content: "   " }] })],
    });
    // Content is preserved verbatim (whitespace is not silently trimmed) but
    // flagged as having no text, so nothing is lost and nothing is invented.
    expect(conversations[0].messages.map(m => m.content)).toEqual(["", "   "]);
    expect(conversations[0].messages.every(m => m.hadTextContent === false)).toBe(true);
    expect(stats.messagesWithNoContent).toBe(2);
  });

  it("records entity key and timestamp precision in provenance", () => {
    const { conversations } = parseGhostCodeExport({ raw: [conv()], sourceFileName: "extracted_conversations.json" });
    const c = JSON.parse(conversations[0].rawPayloadJson);
    expect(c.entityKey).toBe(GHOSTCODE_ENTITY_KEY);
    expect(c.entityKey).toBe("KairoVale_GhostCode");
    expect(c.sourceFileName).toBe("extracted_conversations.json");
    expect(JSON.parse(conversations[0].messages[0].rawPayloadJson).timestampPrecision).toBe("conversation-create-time-only");
  });

  it("accepts an overridden entity key", () => {
    const { conversations } = parseGhostCodeExport({ raw: [conv()], entityKey: "Other_Entity" });
    expect(JSON.parse(conversations[0].rawPayloadJson).entityKey).toBe("Other_Entity");
  });

  it("survives a missing or non-numeric create_time", () => {
    const { conversations } = parseGhostCodeExport({ raw: [conv({ create_time: undefined })] });
    expect(conversations[0].nativeCreatedAt).toBe(new Date(0).toISOString());
  });

  it("throws a clear error when the root is not an array", () => {
    expect(() => parseGhostCodeExport({ raw: { conversations: [] } })).toThrow(/array of conversations/);
  });

  it("passes through a large message untouched", () => {
    const big = "x".repeat(60_000);
    const { conversations } = parseGhostCodeExport({ raw: [conv({ messages: [{ role: "assistant", content: big }] })] });
    expect(conversations[0].messages[0].content).toHaveLength(60_000);
  });
});
