// Parser for the "entries/query" conversation archive shape inspected in
// docs/export_inspection.txt. It is deliberately a SEPARATE, named source from
// claudeExport — the two formats are not interchangeable, and the provider key
// ("entries_query") is persisted on the connection, the conversation origins,
// and the reconstruction run, so a snapshot can always be traced back to which
// importer produced its corpus. Labelling is what keeps provenance honest when
// a real Claude export later arrives as a second supported source.
//
// Root is an object with a `conversations` array (an array root is also
// accepted for convenience). Each conversation:
//   { collection_uuid, context_title, context_uuid, created_at, mode,
//     updated_at, entries: [ { answer, created_at, entry_uuid, label,
//     query, query_status } ] }
// Each entry is one query plus its answer — normalized into a user message and
// an assistant message so the rest of the pipeline sees the same shape as
// every other provider.

import { asText, parseDate, safeTitle } from "../continuity";
import type { ParseStats, ParsedConversation, ParsedMessage } from "./claudeExport";

export const ENTRIES_QUERY_SOURCE_FORMAT = "entries_query";
export const ENTRIES_QUERY_DISPLAY_LABEL = "Entries/query export";

export interface EntriesQueryEntry {
  answer?: unknown;
  created_at?: unknown;
  entry_uuid?: unknown;
  label?: unknown;
  query?: unknown;
  query_status?: unknown;
  [key: string]: unknown;
}

export interface EntriesQueryConversation {
  collection_uuid?: unknown;
  context_title?: unknown;
  context_uuid?: unknown;
  created_at?: unknown;
  entries?: EntriesQueryEntry[];
  mode?: unknown;
  updated_at?: unknown;
  [key: string]: unknown;
}

function toIso(value: unknown, fallback?: string): string {
  const date = parseDate(value);
  return date ? date.toISOString() : fallback ?? new Date(0).toISOString();
}

export function parseEntriesQueryExport(raw: unknown): { conversations: ParsedConversation[]; stats: ParseStats } {
  const asRecord = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const list: unknown[] | null = Array.isArray(raw)
    ? raw
    : asRecord && Array.isArray(asRecord.conversations)
      ? (asRecord.conversations as unknown[])
      : null;
  if (!list) {
    throw new Error("entries/query export is expected to be an array or an object with a `conversations` array");
  }

  const stats: ParseStats = {
    conversationsSeen: 0,
    conversationsEmpty: 0,
    messagesSeen: 0,
    messagesWithNoContent: 0,
    blockTypeCounts: {},
  };

  const conversations: ParsedConversation[] = (list as EntriesQueryConversation[]).map((conv, convIndex) => {
    stats.conversationsSeen += 1;
    const entries = Array.isArray(conv.entries) ? conv.entries : [];
    if (entries.length === 0) stats.conversationsEmpty += 1;

    const nativeConversationId =
      asText(conv.context_uuid).trim() || asText(conv.collection_uuid).trim() || `entries-conversation-${convIndex + 1}`;
    const conversationCreatedAt = toIso(conv.created_at);

    const messages: ParsedMessage[] = [];
    entries.forEach((entry, entryIndex) => {
      const entryUuid = asText(entry.entry_uuid).trim() || `${nativeConversationId}-entry-${entryIndex + 1}`;
      const createdAt = toIso(entry.created_at, conversationCreatedAt);
      const query = asText(entry.query).trim();
      const answer = asText(entry.answer).trim();
      const label = asText(entry.label).trim();

      // One entry is two turns. Both are recorded even when empty, mirroring
      // claudeExport's behaviour — emptiness is tracked in stats rather than
      // silently dropped, so the import counts stay auditable.
      stats.messagesSeen += 2;
      if (!query) stats.messagesWithNoContent += 1;
      if (!answer) stats.messagesWithNoContent += 1;

      messages.push({
        nativeMessageId: `${entryUuid}:query`,
        nativeParentId: null,
        role: "user",
        content: query,
        nativeCreatedAt: createdAt,
        rawPayloadJson: JSON.stringify({ entry_uuid: entry.entry_uuid, query: entry.query, label: entry.label, query_status: entry.query_status, created_at: entry.created_at }),
        hadTextContent: query.length > 0,
      });
      messages.push({
        nativeMessageId: `${entryUuid}:answer`,
        nativeParentId: `${entryUuid}:query`,
        role: "assistant",
        content: answer,
        nativeCreatedAt: createdAt,
        rawPayloadJson: JSON.stringify({ entry_uuid: entry.entry_uuid, answer: entry.answer, label: entry.label, created_at: entry.created_at }),
        hadTextContent: answer.length > 0,
      });

      if (label) stats.blockTypeCounts[label] = (stats.blockTypeCounts[label] ?? 0) + 1;
    });

    return {
      nativeConversationId,
      title: safeTitle(conv.context_title, `Imported conversation ${convIndex + 1}`),
      nativeCreatedAt: conversationCreatedAt,
      nativeUpdatedAt:
        conv.updated_at === undefined || conv.updated_at === null ? null : toIso(conv.updated_at, conversationCreatedAt),
      rawPayloadJson: JSON.stringify({
        collection_uuid: conv.collection_uuid,
        context_title: conv.context_title,
        context_uuid: conv.context_uuid,
        mode: conv.mode,
        created_at: conv.created_at,
        updated_at: conv.updated_at,
      }),
      messages,
    };
  });

  return { conversations, stats };
}
