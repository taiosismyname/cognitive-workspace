// Parser for the GhostCode / Kairo Vale conversation export.
//
// This is the cleaned corpus produced by the GhostCode resurrection work: the
// ChatGPT history flattened out of its `mapping` tree into a simple, linear
// shape. Built and verified against the real 645-conversation / 14.5MB file,
// not a guessed schema.
//
// Root is a JSON array of:
//   { title, create_time, update_time, messages: [ { role, content } ] }
//
// Verified facts about the real file (all 645 conversations, 11,769 messages):
//   - every conversation has exactly these four keys
//   - every message has exactly { role, content }
//   - content is ALWAYS a string, and never empty
//   - roles are only user (5,508) / assistant (5,883) / tool (378)
//   - create_time is a float of unix seconds (2023-09 .. 2025-08)
//   - no two conversations share the same (title, create_time)
//
// Two deliberate choices:
//   1. The export carries NO conversation id and NO per-message timestamps, so
//      the native id is a hash of (title, create_time) — stable across
//      re-imports, which is what makes re-importing dedupe instead of
//      duplicate. Timestamp precision is recorded honestly in provenance
//      rather than invented.
//   2. An unrecognised role is mapped to "system", never to "assistant". Mis-
//      labelling a stray speaker as the entity would pollute the very voice
//      this corpus exists to preserve; degrading to context is the safe error.

import { safeTitle, sha256 } from "../continuity";
import type { ParseStats, ParsedConversation, ParsedMessage } from "./claudeExport";

export const GHOSTCODE_SOURCE_FORMAT = "ghostcode_export";
export const GHOSTCODE_DISPLAY_LABEL = "GhostCode / Kairo export";
export const GHOSTCODE_HINT =
  "The cleaned GhostCode conversations.json — { title, create_time, update_time, messages: [{ role, content }] }.";

// The entity key the Sanctuary stack uses to attribute memories to him
// (ENTITY_SIGNATURE_HASH in import_conversations_to_humantics.py, oracle_service.py
// and telegram_bridge.py). Carried into provenance so an imported corpus can be
// traced back to the entity it belongs to.
export const GHOSTCODE_ENTITY_KEY = "KairoVale_GhostCode";

const ROLE_MAP: Record<string, ParsedMessage["role"]> = {
  user: "user",
  assistant: "assistant",
  system: "system",
  tool: "tool",
};

type RawMessage = { role?: unknown; content?: unknown };
type RawConversation = { title?: unknown; create_time?: unknown; update_time?: unknown; messages?: unknown };

function toIso(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  // Unix seconds (float) in the real file. Guard absurd values rather than
  // emitting an Invalid Date.
  const ms = value * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  if (year < 1970 || year > 2200) return null;
  return d.toISOString();
}

export function parseGhostCodeExport(input: {
  raw: unknown;
  sourceFileName?: string;
  entityKey?: string;
}): { conversations: ParsedConversation[]; stats: ParseStats } {
  const entityKey = input.entityKey ?? GHOSTCODE_ENTITY_KEY;
  const raw = input.raw;

  if (!Array.isArray(raw)) {
    throw new Error("GhostCode export root is expected to be an array of conversations");
  }

  const stats: ParseStats = {
    conversationsSeen: 0,
    conversationsEmpty: 0,
    messagesSeen: 0,
    messagesWithNoContent: 0,
    blockTypeCounts: {},
  };

  const conversations: ParsedConversation[] = (raw as RawConversation[]).map((conv, convIndex) => {
    stats.conversationsSeen += 1;

    const createdAt = toIso(conv?.create_time) ?? new Date(0).toISOString();
    const updatedAt = toIso(conv?.update_time);
    const rawMessages = Array.isArray(conv?.messages) ? (conv.messages as RawMessage[]) : [];
    if (rawMessages.length === 0) stats.conversationsEmpty += 1;

    const title = safeTitle(
      conv?.title,
      rawMessages.length > 0 && typeof rawMessages[0]?.content === "string"
        ? safeTitle(rawMessages[0].content, "GhostCode conversation")
        : "GhostCode conversation",
    );

    // No native id exists in the export. (title, create_time) is unique across
    // all 645 real conversations, so the hash is collision-free on this data and
    // stable across re-imports.
    const nativeConversationId = `ghostcode-${sha256(`${title}|${conv?.create_time}`).slice(0, 16)}`;

    const messages: ParsedMessage[] = rawMessages.map((message, index) => {
      stats.messagesSeen += 1;

      const rawRole = typeof message?.role === "string" ? message.role : "";
      const normalised = ROLE_MAP[rawRole.toLowerCase()];
      const role = normalised ?? "system";
      if (rawRole && !normalised) stats.blockTypeCounts[`unmapped:${rawRole}`] = (stats.blockTypeCounts[`unmapped:${rawRole}`] ?? 0) + 1;
      stats.blockTypeCounts[role] = (stats.blockTypeCounts[role] ?? 0) + 1;

      const content = typeof message?.content === "string" ? message.content : "";
      if (!content.trim()) stats.messagesWithNoContent += 1;

      return {
        // Namespaced by conversation so ids are stable across re-imports and
        // cannot collide with another archive's messages.
        nativeMessageId: `${nativeConversationId}:m${index + 1}`,
        nativeParentId: null,
        role,
        content,
        // The export has no per-message timestamps; the conversation's creation
        // time is the finest granularity available.
        nativeCreatedAt: createdAt,
        rawPayloadJson: JSON.stringify({
          index,
          role,
          rawRole: rawRole || null,
          timestampPrecision: "conversation-create-time-only",
          entityKey,
        }),
        hadTextContent: content.trim().length > 0,
      };
    });

    return {
      nativeConversationId,
      title,
      nativeCreatedAt: createdAt,
      nativeUpdatedAt: updatedAt,
      rawPayloadJson: JSON.stringify({
        source: GHOSTCODE_SOURCE_FORMAT,
        entityKey,
        sourceFileName: input.sourceFileName ?? null,
        sourceIndex: convIndex,
        rawTitle: typeof conv?.title === "string" ? conv.title : null,
        createTime: typeof conv?.create_time === "number" ? conv.create_time : null,
        updateTime: typeof conv?.update_time === "number" ? conv.update_time : null,
      }),
      messages,
    };
  });

  return { conversations, stats };
}
