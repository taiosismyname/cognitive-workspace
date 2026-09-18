import { describe, expect, it } from "vitest";
import { parseClaudeExport } from "./claudeExport";

// Synthetic fixture — shaped to match a real export's structure and quirks
// (mixed top-level text/content, tool-only messages, empty conversations),
// without using anyone's actual conversation content.
const fixture = [
  {
    uuid: "conv-1",
    name: "A normal conversation",
    summary: "",
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:05:00.000Z",
    account: { uuid: "acct-1" },
    chat_messages: [
      {
        uuid: "msg-1",
        text: "hello",
        content: [{ type: "text", text: "hello", start_timestamp: "", stop_timestamp: "", flags: {}, citations: [] }],
        sender: "human",
        created_at: "2025-01-01T00:00:00.000Z",
        parent_message_uuid: "00000000-0000-4000-8000-000000000000",
      },
      {
        uuid: "msg-2",
        text: "",
        content: [
          { type: "tool_use", type_: "tool_use", name: "search", input: {}, id: "t1" },
          { type: "text", text: "hi there", start_timestamp: "", stop_timestamp: "", flags: {}, citations: [] },
        ],
        sender: "assistant",
        created_at: "2025-01-01T00:00:05.000Z",
        parent_message_uuid: "msg-1",
      },
      {
        uuid: "msg-3",
        text: "",
        content: [{ type: "tool_result", content: [], is_error: false }],
        sender: "assistant",
        created_at: "2025-01-01T00:00:06.000Z",
        parent_message_uuid: "msg-2",
      },
    ],
  },
  {
    uuid: "conv-2",
    name: "",
    summary: "",
    created_at: "2025-02-01T00:00:00.000Z",
    updated_at: "2025-02-01T00:00:00.000Z",
    account: { uuid: "acct-1" },
    chat_messages: [],
  },
];

describe("parseClaudeExport", () => {
  it("parses conversations and messages with correct counts", () => {
    const { conversations, stats } = parseClaudeExport(fixture);
    expect(conversations).toHaveLength(2);
    expect(stats.conversationsSeen).toBe(2);
    expect(stats.conversationsEmpty).toBe(1);
    expect(stats.messagesSeen).toBe(3);
  });

  it("falls back to content blocks when a tool-only message has no top-level text", () => {
    const { conversations } = parseClaudeExport(fixture);
    const assistantMsg = conversations[0].messages[1];
    expect(assistantMsg.content).toBe("hi there");
    expect(assistantMsg.hadTextContent).toBe(true);
  });

  it("produces empty content (not a crash) for messages with no text-bearing blocks", () => {
    const { conversations, stats } = parseClaudeExport(fixture);
    const toolResultOnlyMsg = conversations[0].messages[2];
    expect(toolResultOnlyMsg.content).toBe("");
    expect(toolResultOnlyMsg.hadTextContent).toBe(false);
    expect(stats.messagesWithNoContent).toBe(1);
  });

  it("gives an untitled conversation a null title rather than an empty string", () => {
    const { conversations } = parseClaudeExport(fixture);
    expect(conversations[1].title).toBeNull();
  });

  it("normalizes the placeholder root parent id to null", () => {
    const { conversations } = parseClaudeExport(fixture);
    expect(conversations[0].messages[0].nativeParentId).toBeNull();
    expect(conversations[0].messages[1].nativeParentId).toBe("msg-1");
  });

  it("maps sender to role", () => {
    const { conversations } = parseClaudeExport(fixture);
    expect(conversations[0].messages[0].role).toBe("user");
    expect(conversations[0].messages[1].role).toBe("assistant");
  });

  it("rejects a non-array root instead of failing silently", () => {
    expect(() => parseClaudeExport({ not: "an array" })).toThrow();
  });
});
