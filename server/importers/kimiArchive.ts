// Parser for the Kimi archive browser export — a self-contained HTML file
// produced by archiving kimi.ai threads one by one. Built and verified against
// a real 402-thread / 5.1MB archive, not a guessed shape.
//
// Each thread is an <article class="thread"> containing:
//   - a <span class="thread-title"> and <span class="thread-date">
//   - a <div class="thread-meta"> holding the source .md filename
//   - a front-matter <ul> of labelled fields (URL, Chat ID, Account, Archived,
//     Attachments, Images, Credentials, Capture quality, ...)
//   - the transcript itself, then an optional <h2>Margin notes</h2> section
//
// THREE real turn formats exist in the same file, and a parser that handles
// only the common one silently drops content from 71 of 402 threads:
//   1. <h3>Tai</h3> / <h3>Kimi</h3>                      (328 threads)
//   2. <h3>Message 12 — Tai</h3> / <h3>Reply 3 — Kimi</h3> (7 threads, recovery batches)
//   3. <p><strong>Tai:</strong> ...                        (64 threads)
// All three are handled here, and stats.blockTypeCounts reports the mix so a
// future export that drops one format is visible rather than silent.
//
// The archive carries no per-message timestamps — only a thread date — so every
// message in a thread shares the thread's date. That limitation is preserved
// honestly in rawPayloadJson rather than invented.

import { safeTitle, sha256 } from "../continuity";
import type { ParseStats, ParsedConversation, ParsedMessage } from "./claudeExport";

export const KIMI_ARCHIVE_SOURCE_FORMAT = "kimi_archive";
export const KIMI_ARCHIVE_DISPLAY_LABEL = "Kimi archive";
export const KIMI_ARCHIVE_HINT =
  "A Kimi archive browser HTML file. Every thread becomes a conversation; Tai/Kimi turns are imported as user/assistant messages.";

const SPEAKER_ROLE: Record<string, "user" | "assistant"> = { Tai: "user", Kimi: "assistant" };

// Matches a turn marker in any of the three formats. Group 1/2 = Message|Reply
// and its ordinal, 3 = h3 speaker, 4 = the "[edited]" suffix, 5 = inline speaker.
const TURN_RE =
  /<h3[^>]*>\s*(?:(Message|Reply)\s*(\d+)\s*[—–-]\s*)?(Tai|Kimi)(\s*\[edited\])?\s*<\/h3>|<p>\s*<strong>\s*(Tai|Kimi)\s*:\s*<\/strong>/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–",
  hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, code: string) => {
    if (NAMED_ENTITIES[code] !== undefined) return NAMED_ENTITIES[code];
    if (code[0] === "#") {
      const isHex = code[1] === "x" || code[1] === "X";
      const n = parseInt(isHex ? code.slice(2) : code.slice(1), isHex ? 16 : 10);
      if (Number.isFinite(n) && n > 0 && n <= 0x10ffff) return String.fromCodePoint(n);
    }
    return whole;
  });
}

// HTML -> readable text. Block-level boundaries become newlines so that lists,
// headings and paragraphs inside a reply survive as structure instead of
// collapsing into one run-on line.
export function htmlToText(html: string): string {
  let out = html;
  out = out.replace(/<br\s*\/?>/gi, "\n");
  out = out.replace(/<li[^>]*>/gi, "\n- ");
  out = out.replace(/<\/(p|div|li|h[1-6]|tr|blockquote|pre)>/gi, "\n");
  out = out.replace(/<\/td>/gi, " | ");
  out = out.replace(/<hr\s*\/?>/gi, "\n---\n");
  out = out.replace(/<[^>]+>/g, "");
  out = decodeEntities(out);
  out = out.replace(/[ \t]+\n/g, "\n");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

// The archive writes dates three ways: "2025-12-05", "July 16, 2025", and
// sometimes with a trailing qualifier like "(per Kimi history)". A missing or
// unclear date ("2025-10 (date unclear)") degrades to the 1st of that month
// rather than being dropped.
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function parseArchiveDate(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;

  const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const ym = raw.match(/(\d{4})-(\d{2})\b/);
  if (ym) {
    const d = new Date(Date.UTC(Number(ym[1]), Number(ym[2]) - 1, 1));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const long = raw.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (long) {
    const month = MONTHS.indexOf(long[1].toLowerCase());
    if (month >= 0) {
      const d = new Date(Date.UTC(Number(long[3]), month, Number(long[2])));
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  const yearOnly = raw.match(/\b(\d{4})\b/);
  if (yearOnly) {
    const d = new Date(Date.UTC(Number(yearOnly[1]), 0, 1));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

// Some threads were archived before their chat id was known and carry a
// placeholder like "pendingid" in the Chat ID field. Such a value must NOT be
// used as a native id: it is not unique, so two pending threads would collapse
// into one conversation on import. Rejected ids fall back to the meta-file hash.
const PLACEHOLDER_CHAT_ID = /^(pending|unknown|none|n\/?a|tbd|todo|missing|unset)/i;

function usableChatId(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (v.length < 8) return null;
  if (PLACEHOLDER_CHAT_ID.test(v)) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(v)) return null;
  return v;
}

type FrontMatter = Record<string, string>;

function extractFrontMatter(body: string): FrontMatter {
  const fields: FrontMatter = {};
  const re = /<li>\s*<strong>([^<]+?):<\/strong>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const key = decodeEntities(m[1]).trim();
    const value = htmlToText(m[2]).replace(/\s+/g, " ").trim();
    if (key && value && fields[key] === undefined) fields[key] = value;
  }
  return fields;
}

type Turn = { role: "user" | "assistant"; content: string; format: string; ordinal: number | null; edited: boolean };

// Splits the transcript region into turns, preserving order and supporting all
// three marker formats. Content before the first marker is front matter and is
// deliberately excluded from message bodies.
function extractTurns(body: string): Turn[] {
  // Narrow to the transcript region when the section headings exist.
  let start = 0;
  const transcriptH2 = body.search(/<h2[^>]*>\s*Transcript\s*<\/h2>/i);
  if (transcriptH2 >= 0) start = transcriptH2;
  let end = body.length;
  const marginH2 = body.search(/<h2[^>]*>\s*Margin notes\s*<\/h2>/i);
  if (marginH2 >= 0) end = marginH2;
  const region = body.slice(start, end);

  const turns: Turn[] = [];
  TURN_RE.lastIndex = 0;
  const marks: Array<{ index: number; end: number; speaker: string; format: string; ordinal: number | null; edited: boolean }> = [];
  let m: RegExpExecArray | null;
  while ((m = TURN_RE.exec(region)) !== null) {
    const speaker = m[3] ?? m[5];
    if (!speaker) continue;
    const role = SPEAKER_ROLE[speaker];
    if (!role) continue;
    const format = m[5] ? "inline_bold" : m[1] ? "h3_numbered" : "h3_name";
    marks.push({
      index: m.index,
      end: m.index + m[0].length,
      speaker,
      format,
      ordinal: m[2] ? Number(m[2]) : null,
      edited: Boolean(m[4]),
    });
  }

  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    const next = marks[i + 1];
    const content = htmlToText(region.slice(mark.end, next ? next.index : region.length));
    turns.push({
      role: SPEAKER_ROLE[mark.speaker],
      content,
      format: mark.format,
      ordinal: mark.ordinal,
      edited: mark.edited,
    });
  }
  return turns;
}

export function parseKimiArchive(input: { html: string; sourceFileName?: string }): { conversations: ParsedConversation[]; stats: ParseStats } {
  const html = input.html ?? "";
  const stats: ParseStats = {
    conversationsSeen: 0,
    conversationsEmpty: 0,
    messagesSeen: 0,
    messagesWithNoContent: 0,
    blockTypeCounts: {},
  };

  const articles = html.match(/<article class="thread"[\s\S]*?<\/article>/gi) ?? [];
  if (articles.length === 0) {
    throw new Error("No archive threads found. Expected an <article class=\"thread\"> per conversation — is this a Kimi archive browser file?");
  }

  const conversations: ParsedConversation[] = [];

  for (const article of articles) {
    stats.conversationsSeen += 1;

    const titleSpan = article.match(/<span class="thread-title">([\s\S]*?)<\/span>/i);
    const dateSpan = article.match(/<span class="thread-date">([\s\S]*?)<\/span>/i);
    const metaDiv = article.match(/<div class="thread-meta">([\s\S]*?)<\/div>/i);
    const bodyMatch = article.match(/<div class="thread-body"[^>]*>([\s\S]*?)<\/div>\s*<\/article>/i);

    const metaFile = metaDiv ? decodeEntities(metaDiv[1]).trim() : null;
    const rawTitle = titleSpan ? htmlToText(titleSpan[1]) : "";
    const body = bodyMatch ? bodyMatch[1] : "";

    const fields = extractFrontMatter(body);
    const h1 = body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const title = safeTitle(rawTitle || (h1 ? htmlToText(h1[1]) : ""), fields["Thread title"] || "Kimi thread");

    const isoDate =
      parseArchiveDate(dateSpan ? htmlToText(dateSpan[1]) : null) ??
      parseArchiveDate(fields["History date"]) ??
      parseArchiveDate(fields["Date (history page)"]) ??
      parseArchiveDate(fields["Date"]) ??
      new Date().toISOString();

    // Prefer the true native id (chat id, else the id embedded in the URL) and
    // fall back to a hash of the source filename so re-importing the same
    // archive de-duplicates instead of duplicating.
    const url = fields["URL"] ?? null;
    const urlChatId = url && url.includes("/chat/") ? url.split("/chat/")[1]?.split(/[?&#\s]/)[0] ?? null : null;
    const chatId = usableChatId(fields["Chat ID"]) ?? usableChatId(urlChatId);
    const nativeConversationId = chatId
      ? `kimi-${chatId}`
      : `kimi-${sha256(metaFile || `${title}|${isoDate}`).slice(0, 16)}`;

    const marginNotesMatch = body.match(/<h2[^>]*>\s*Margin notes\s*<\/h2>([\s\S]*)$/i);
    const marginNotes = marginNotesMatch ? htmlToText(marginNotesMatch[1]) : null;

    const turns = extractTurns(body);
    if (turns.length === 0) stats.conversationsEmpty += 1;

    const messages: ParsedMessage[] = turns.map((turn, index) => {
      stats.messagesSeen += 1;
      stats.blockTypeCounts[turn.format] = (stats.blockTypeCounts[turn.format] ?? 0) + 1;
      if (!turn.content) stats.messagesWithNoContent += 1;
      return {
        // Namespaced so ids stay stable across re-imports and cannot collide
        // with another archive's message ids.
        nativeMessageId: `${nativeConversationId}:m${index + 1}`,
        nativeParentId: null,
        role: turn.role,
        content: turn.content,
        // The archive has no per-message timestamps; the thread date is the
        // finest granularity available and is used for every message.
        nativeCreatedAt: isoDate,
        rawPayloadJson: JSON.stringify({
          speaker: turn.role === "user" ? "Tai" : "Kimi",
          format: turn.format,
          ordinal: turn.ordinal,
          edited: turn.edited,
          timestampPrecision: "thread-date-only",
        }),
        hadTextContent: turn.content.length > 0,
      };
    });

    conversations.push({
      nativeConversationId,
      title,
      nativeCreatedAt: isoDate,
      nativeUpdatedAt: null,
      rawPayloadJson: JSON.stringify({
        source: KIMI_ARCHIVE_SOURCE_FORMAT,
        archiveFileName: input.sourceFileName ?? null,
        sourceMdFile: metaFile,
        url,
        chatId,
        captureQuality: fields["Capture quality"] ?? null,
        credentials: fields["Credentials"] ?? null,
        attachments: fields["Attachments"] ?? null,
        images: fields["Images"] ?? null,
        archived: fields["Archived"] ?? null,
        account: fields["Account"] ?? null,
        marginNotes,
      }),
      messages,
    });
  }

  return { conversations, stats };
}
