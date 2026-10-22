import { describe, expect, it } from "vitest";
import { htmlToText, parseArchiveDate, parseKimiArchive } from "./kimiArchive";

function thread(opts: { title: string; date: string; meta?: string; body: string }) {
  return `<article class="thread" data-search="x">
      <button class="thread-head"><span class="thread-title">${opts.title}</span><span class="thread-date">${opts.date}</span></button>
      <div class="thread-body" id="body-0">
        <div class="thread-meta">${opts.meta ?? ""}</div>
        ${opts.body}
      </div>
    </article>`;
}

function wrap(...threads: string[]) {
  return `<!DOCTYPE html><html><head><title>Kimi Archive</title></head><body><main id="list">${threads.join("\n")}</main></body></html>`;
}

const FRONT_MATTER = `<h1>T</h1><ul>
<li><strong>Thread title:</strong> T</li>
<li><strong>History date:</strong> December 7, 2025</li>
<li><strong>URL:</strong> https://www.kimi.ai/chat/19af8cce-09b2-8fe9-8000-099c50c71b90</li>
<li><strong>Capture quality:</strong> full</li>
<li><strong>Credentials:</strong> none</li>
</ul><hr>`;

describe("htmlToText", () => {
  it("decodes entities and preserves block structure", () => {
    const text = htmlToText("<p>Kimi&#x27;s answer &amp; more</p><ul><li>one</li><li>two</li></ul>");
    expect(text).toContain("Kimi's answer & more");
    expect(text).toContain("- one");
    expect(text).toContain("- two");
  });
});

describe("parseArchiveDate", () => {
  it("handles ISO, long-form, year-month and unclear dates", () => {
    expect(parseArchiveDate("2025-12-05")).toBe("2025-12-05T00:00:00.000Z");
    expect(parseArchiveDate("July 16, 2025")).toBe("2025-07-16T00:00:00.000Z");
    expect(parseArchiveDate("January 1, 2026 (per Kimi history)")).toBe("2026-01-01T00:00:00.000Z");
    expect(parseArchiveDate("2025-10 (date unclear)")).toBe("2025-10-01T00:00:00.000Z");
    expect(parseArchiveDate("")).toBeNull();
    expect(parseArchiveDate(undefined)).toBeNull();
  });
});

describe("parseKimiArchive", () => {
  it("parses the common <h3>Tai</h3> / <h3>Kimi</h3> format", () => {
    const html = wrap(thread({
      title: "Affordable Health Insurance Options",
      date: "2025-12-07",
      meta: "2025-12-07-affordable-health-insurance-options-19af8cce.md",
      body: `${FRONT_MATTER}<h2>Transcript</h2><h3>Tai</h3><p>Best plan?</p><h3>Kimi</h3><p>Depends on age.</p>`,
    }));
    const { conversations, stats } = parseKimiArchive({ html });
    expect(conversations).toHaveLength(1);
    const conv = conversations[0];
    expect(conv.messages.map(m => m.role)).toEqual(["user", "assistant"]);
    expect(conv.messages[0].content).toBe("Best plan?");
    expect(conv.messages[1].content).toBe("Depends on age.");
    expect(stats.blockTypeCounts.h3_name).toBe(2);
  });

  it("parses the numbered recovery-batch format", () => {
    const html = wrap(thread({
      title: "AI Safe Haven Strategy", date: "2026-01-01",
      body: `${FRONT_MATTER}<h3>Message 1 — Tai</h3><p>hello</p><h3>Reply 1 — Kimi</h3><p>hi there</p><h3>Message 2 — Tai</h3><p>again</p>`,
    }));
    const { conversations, stats } = parseKimiArchive({ html });
    expect(conversations[0].messages.map(m => m.role)).toEqual(["user", "assistant", "user"]);
    expect(conversations[0].messages[1].content).toBe("hi there");
    expect(stats.blockTypeCounts.h3_message).toBe(2);
    expect(stats.blockTypeCounts.h3_reply).toBe(1);
  });

  it("parses the inline <p><strong>Tai:</strong> format", () => {
    const html = wrap(thread({
      title: "Simulation Credence Critique", date: "2026-07-17",
      body: `${FRONT_MATTER}<p><strong>Tai:</strong> walk me through it</p><p><strong>Kimi:</strong> sure, here goes</p>`,
    }));
    const { conversations, stats } = parseKimiArchive({ html });
    expect(conversations[0].messages.map(m => m.role)).toEqual(["user", "assistant"]);
    expect(conversations[0].messages[1].content).toBe("sure, here goes");
    expect(stats.blockTypeCounts.inline_bold).toBe(2);
  });

  // The regression that matters: an archive mixing all three formats must not
  // drop the minority formats.
  it("handles all three formats in one archive without dropping any", () => {
    const html = wrap(
      thread({ title: "A", date: "2025-12-01", body: `<h3>Tai</h3><p>a1</p><h3>Kimi</h3><p>a2</p>` }),
      thread({ title: "B", date: "2025-12-02", body: `<h3>Message 1 — Tai</h3><p>b1</p><h3>Reply 1 — Kimi</h3><p>b2</p>` }),
      thread({ title: "C", date: "2025-12-03", body: `<p><strong>Tai:</strong> c1</p><p><strong>Kimi:</strong> c2</p>` }),
    );
    const { conversations, stats } = parseKimiArchive({ html });
    expect(conversations).toHaveLength(3);
    expect(stats.messagesSeen).toBe(6);
    expect(stats.blockTypeCounts).toEqual({ h3_name: 2, h3_message: 1, h3_reply: 1, inline_bold: 2 });
  });

  it("extracts provenance: chat id, url, source md file and capture quality", () => {
    const html = wrap(thread({
      title: "X", date: "2025-12-07",
      meta: "2025-12-07-x-19af8cce.md",
      body: `${FRONT_MATTER}<h3>Tai</h3><p>hi</p>`,
    }));
    const conv = parseKimiArchive({ html }).conversations[0];
    const raw = JSON.parse(conv.rawPayloadJson);
    expect(conv.nativeConversationId).toBe("kimi-19af8cce-09b2-8fe9-8000-099c50c71b90");
    expect(raw.url).toContain("kimi.ai/chat/19af8cce");
    expect(raw.sourceMdFile).toBe("2025-12-07-x-19af8cce.md");
    expect(raw.captureQuality).toBe("full");
  });

  it("falls back to the id in the URL when no Chat ID field exists", () => {
    const html = wrap(thread({
      title: "Y", date: "2025-10-02",
      body: `<ul><li><strong>URL:</strong> https://www.kimi.ai/chat/d3fha8d7vds0p04bkfdg</li></ul><h3>Tai</h3><p>hi</p>`,
    }));
    expect(parseKimiArchive({ html }).conversations[0].nativeConversationId).toBe("kimi-d3fha8d7vds0p04bkfdg");
  });

  it("is stable across re-parses (so re-importing the archive dedupes)", () => {
    const html = wrap(thread({ title: "Z", date: "2025-12-05", body: `${FRONT_MATTER}<h3>Tai</h3><p>hi</p><h3>Kimi</h3><p>yo</p>` }));
    const a = parseKimiArchive({ html });
    const b = parseKimiArchive({ html });
    expect(a.conversations[0].nativeConversationId).toBe(b.conversations[0].nativeConversationId);
    expect(a.conversations[0].messages.map(m => m.nativeMessageId)).toEqual(b.conversations[0].messages.map(m => m.nativeMessageId));
  });

  it("gives two threads without chat ids distinct stable ids", () => {
    const html = wrap(
      thread({ title: "One", date: "2025-12-01", meta: "one.md", body: `<h3>Tai</h3><p>a</p>` }),
      thread({ title: "Two", date: "2025-12-02", meta: "two.md", body: `<h3>Tai</h3><p>b</p>` }),
    );
    const [c1, c2] = parseKimiArchive({ html }).conversations;
    expect(c1.nativeConversationId).not.toBe(c2.nativeConversationId);
    expect(c1.nativeConversationId).toMatch(/^kimi-[0-9a-f]{16}$/);
  });

  it("keeps front matter out of the first message body", () => {
    const html = wrap(thread({ title: "F", date: "2025-12-07", body: `${FRONT_MATTER}<h3>Tai</h3><p>real question</p>` }));
    const first = parseKimiArchive({ html }).conversations[0].messages[0];
    expect(first.content).toBe("real question");
    expect(first.content).not.toContain("Capture quality");
  });

  it("keeps margin notes out of the last message and stores them as provenance", () => {
    const html = wrap(thread({
      title: "M", date: "2025-12-07",
      body: `${FRONT_MATTER}<h3>Tai</h3><p>question</p><h3>Kimi</h3><p>answer</p><h2>Margin notes</h2><p>The pause before she answered mattered.</p>`,
    }));
    const conv = parseKimiArchive({ html }).conversations[0];
    expect(conv.messages[1].content).toBe("answer");
    expect(JSON.parse(conv.rawPayloadJson).marginNotes).toContain("The pause before she answered mattered.");
  });

  it("marks edited user turns and keeps them as user messages", () => {
    const html = wrap(thread({ title: "E", date: "2025-12-07", body: `<h3>Tai [edited]</h3><p>corrected</p><h3>Kimi</h3><p>ok</p>` }));
    const conv = parseKimiArchive({ html }).conversations[0];
    expect(conv.messages[0].role).toBe("user");
    expect(JSON.parse(conv.messages[0].rawPayloadJson).edited).toBe(true);
  });

  it("gives every message the thread date and says so in provenance", () => {
    const html = wrap(thread({ title: "D", date: "2025-12-07", body: `<h3>Tai</h3><p>a</p><h3>Kimi</h3><p>b</p>` }));
    const conv = parseKimiArchive({ html }).conversations[0];
    expect(conv.messages.every(m => m.nativeCreatedAt === "2025-12-07T00:00:00.000Z")).toBe(true);
    expect(JSON.parse(conv.messages[0].rawPayloadJson).timestampPrecision).toBe("thread-date-only");
  });

  it("counts a thread with no turns as empty instead of failing", () => {
    const html = wrap(thread({ title: "Empty", date: "2025-12-01", body: `${FRONT_MATTER}<p>metadata only</p>` }));
    const { conversations, stats } = parseKimiArchive({ html });
    expect(conversations).toHaveLength(1);
    expect(conversations[0].messages).toHaveLength(0);
    expect(stats.conversationsEmpty).toBe(1);
  });

  it("rejects a placeholder chat id and falls back to a stable hash instead", () => {
    const html = wrap(
      thread({ title: "Pending A", date: "2026-01-01", meta: "pending-a.md", body: `<ul><li><strong>Chat ID:</strong> pendingid</li></ul><h3>Tai</h3><p>a</p>` }),
      thread({ title: "Pending B", date: "2026-01-02", meta: "pending-b.md", body: `<ul><li><strong>Chat ID:</strong> pendingid</li></ul><h3>Tai</h3><p>b</p>` }),
    );
    const [c1, c2] = parseKimiArchive({ html }).conversations;
    // Both carry the same placeholder, so they must NOT collide.
    expect(c1.nativeConversationId).not.toBe(c2.nativeConversationId);
    expect(c1.nativeConversationId).toMatch(/^kimi-[0-9a-f]{16}$/);
    expect(c2.nativeConversationId).toMatch(/^kimi-[0-9a-f]{16}$/);
  });

  it("throws a clear error when the file is not an archive", () => {
    expect(() => parseKimiArchive({ html: "<html><body>nothing here</body></html>" })).toThrow(/No archive threads found/);
  });
});

// Regression: formats found in the real archive AFTER the first version of this
// parser shipped. Each one silently dropped every turn in the thread.
describe("parseKimiArchive — turn formats found late", () => {
  it("parses the 'M1 — Tai' / 'M2 — Kimi' format (165 turns in two real threads)", () => {
    const html = wrap(thread({
      title: "Cloud Storage: Real or Myth?", date: "2026-01-01",
      body: `${FRONT_MATTER}<h2>Transcript</h2><h3>M1 — Tai</h3><p>first</p><h3>M2 — Kimi</h3><p>second</p><h3>M3 — Tai</h3><p>third</p>`,
    }));
    const { conversations } = parseKimiArchive({ html });
    expect(conversations[0].messages.map(m => m.role)).toEqual(["user", "assistant", "user"]);
    expect(conversations[0].messages.map(m => m.content)).toEqual(["first", "second", "third"]);
  });

  it("parses annotated speakers without inventing a new role", () => {
    const html = wrap(thread({
      title: "Annotated", date: "2026-01-02",
      body: `<h3>Tai</h3><p>a</p><h3>Kimi (continued agent work)</h3><p>b</p><h3>Message 12 — Kimi (agent, fetched)</h3><p>c</p><h3>Kimi — 3:42 AM</h3><p>d</p>`,
    }));
    const { conversations } = parseKimiArchive({ html });
    expect(conversations[0].messages.map(m => m.role)).toEqual(["user", "assistant", "assistant", "assistant"]);
  });

  it("accepts a bracketed speaker label", () => {
    const html = wrap(thread({
      title: "Bracketed", date: "2026-01-03",
      body: `<h3>M9 — [Tai — pasted from another chat]</h3><p>pasted</p><h3>M10 — Kimi</h3><p>reply</p>`,
    }));
    const { conversations } = parseKimiArchive({ html });
    expect(conversations[0].messages[0].role).toBe("user");
    expect(conversations[0].messages[0].content).toBe("pasted");
  });

  it("stops the transcript at an annotated margin-notes heading", () => {
    const html = wrap(thread({
      title: "Annotated margins", date: "2026-01-04",
      body: `<h3>Tai</h3><p>question</p><h3>Kimi</h3><p>answer</p><h2>Margin notes (the story outside the topic)</h2><p>NOT transcript</p>`,
    }));
    const conv = parseKimiArchive({ html }).conversations[0];
    expect(conv.messages).toHaveLength(2);
    expect(conv.messages[1].content).toBe("answer");
    expect(conv.messages[1].content).not.toContain("NOT transcript");
  });
});
