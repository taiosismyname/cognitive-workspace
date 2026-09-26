import { describe, expect, it } from "vitest";
import { parseEntriesQueryExport } from "./entriesQueryExport";

const fixture = {
  conversations: [
    {
      collection_uuid: "col-1",
      context_title: "  Planning the company  ",
      context_uuid: "ctx-1",
      mode: "chat",
      created_at: "2026-01-02T03:04:05.000Z",
      updated_at: "2026-01-03T00:00:00.000Z",
      entries: [
        {
          entry_uuid: "entry-1",
          label: "decision",
          query: "Should we ship v1 with one provider?",
          answer: "Yes — prove one lane end to end first.",
          query_status: "complete",
          created_at: "2026-01-02T03:05:00.000Z",
        },
        {
          entry_uuid: "entry-2",
          query: "And the second importer?",
          answer: "",
          created_at: "2026-01-02T03:06:00.000Z",
        },
      ],
    },
    {
      context_uuid: "ctx-2",
      entries: [],
    },
  ],
};

describe("parseEntriesQueryExport", () => {
  it("accepts an object root with a conversations array", () => {
    const { conversations, stats } = parseEntriesQueryExport(fixture);
    expect(conversations).toHaveLength(2);
    expect(stats.conversationsSeen).toBe(2);
    expect(stats.conversationsEmpty).toBe(1);
  });

  it("normalizes each entry into a user turn and an assistant turn", () => {
    const { conversations } = parseEntriesQueryExport(fixture);
    const first = conversations[0];
    expect(first.nativeConversationId).toBe("ctx-1");
    expect(first.messages).toHaveLength(4);
    expect(first.messages[0]).toMatchObject({ nativeMessageId: "entry-1:query", role: "user", content: "Should we ship v1 with one provider?", nativeParentId: null });
    expect(first.messages[1]).toMatchObject({ nativeMessageId: "entry-1:answer", role: "assistant", nativeParentId: "entry-1:query" });
  });

  it("trims and falls back a missing title", () => {
    const { conversations } = parseEntriesQueryExport(fixture);
    expect(conversations[0].title).toBe("Planning the company");
    expect(conversations[1].title).toBe("Imported conversation 2");
  });

  it("counts empty turns rather than dropping them silently", () => {
    const { stats } = parseEntriesQueryExport(fixture);
    expect(stats.messagesSeen).toBe(4);
    expect(stats.messagesWithNoContent).toBe(1);
    expect(stats.blockTypeCounts).toMatchObject({ decision: 1 });
  });

  it("falls back to collection_uuid when context_uuid is missing", () => {
    const { conversations } = parseEntriesQueryExport({ conversations: [{ collection_uuid: "col-9", entries: [] }] });
    expect(conversations[0].nativeConversationId).toBe("col-9");
  });

  it("accepts a bare array root", () => {
    expect(() => parseEntriesQueryExport([{ context_uuid: "x", entries: [] }])).not.toThrow();
  });

  it("throws on a shape that is neither an array nor { conversations }", () => {
    expect(() => parseEntriesQueryExport({ not: "a conversation list" })).toThrow();
  });
});
