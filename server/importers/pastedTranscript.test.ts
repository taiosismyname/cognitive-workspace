import { describe, expect, it } from "vitest";
import { parsePastedTranscript } from "./pastedTranscript";

describe("parsePastedTranscript", () => {
  it("splits a simple User/Assistant transcript into turns", () => {
    const { conversations, stats } = parsePastedTranscript({
      text: "User: What is continuity?\nAssistant: It means carrying your own prior state forward.\nUser: And how?\nAssistant: By reconstructing from your history.",
    });
    const conv = conversations[0];
    expect(conv.messages).toHaveLength(4);
    expect(conv.messages.map(m => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(conv.messages[0].content).toBe("What is continuity?");
    expect(stats.messagesSeen).toBe(4);
  });

  it("accepts markdown emphasis and headings on the role label", () => {
    const { conversations } = parsePastedTranscript({ text: "**User:** hello\n### Assistant: **hi**\n> Human: again" });
    expect(conversations[0].messages.map(m => m.role)).toEqual(["user", "assistant", "user"]);
    expect(conversations[0].messages[1].content).toBe("**hi**");
  });

  it("treats prose containing a colon as content, not a new turn", () => {
    const { conversations } = parsePastedTranscript({ text: "User: Note: this stays in the same turn.\nAssistant: Agreed." });
    expect(conversations[0].messages).toHaveLength(2);
    expect(conversations[0].messages[0].content).toContain("Note: this stays in the same turn.");
  });

  it("preserves multi-line content within a turn", () => {
    const { conversations } = parsePastedTranscript({ text: "User: line one\nline two\n\nline three\nAssistant: ok" });
    expect(conversations[0].messages[0].content).toBe("line one\nline two\n\nline three");
  });

  it("maps alternate and system labels", () => {
    const { conversations } = parsePastedTranscript({ text: "System: be terse\nHuman: hi\nChatGPT: hello\nMe: bye\nClaude: later" });
    expect(conversations[0].messages.map(m => m.role)).toEqual(["system", "user", "assistant", "user", "assistant"]);
  });

  it("is stable: identical text yields the same native conversation id (so re-pasting dedupes)", () => {
    const text = "User: remember this\nAssistant: remembered";
    const a = parsePastedTranscript({ text });
    const b = parsePastedTranscript({ text });
    expect(a.conversations[0].nativeConversationId).toBe(b.conversations[0].nativeConversationId);
    expect(a.conversations[0].messages[0].nativeMessageId).toBe(b.conversations[0].messages[0].nativeMessageId);
  });

  it("gives different text a different id", () => {
    const a = parsePastedTranscript({ text: "User: one" });
    const b = parsePastedTranscript({ text: "User: two" });
    expect(a.conversations[0].nativeConversationId).not.toBe(b.conversations[0].nativeConversationId);
  });

  it("derives a title from the first user turn, or uses the supplied title", () => {
    expect(parsePastedTranscript({ text: "User: How do we price this?\nAssistant: Carefully." }).conversations[0].title).toBe("How do we price this?");
    expect(parsePastedTranscript({ text: "User: x", title: "Explicit title" }).conversations[0].title).toBe("Explicit title");
  });

  it("throws a clear error when there are no labelled turns", () => {
    expect(() => parsePastedTranscript({ text: "just some unstructured prose with no labels" })).toThrow(/No labelled turns/);
  });

  it("ignores preamble before the first label", () => {
    const { conversations } = parsePastedTranscript({ text: "Exported from somewhere\nDate: 2026\n\nUser: hi\nAssistant: hello" });
    expect(conversations[0].messages).toHaveLength(2);
  });
});
