// Parser for transcripts pasted directly by the user.
//
// This is the import path for providers that expose NO history export: you copy
// a conversation out of another product's UI and paste it here. Because the
// input is free-form text rather than a documented JSON schema, the contract is
// deliberately simple and explicit: each turn starts with a role label followed
// by a colon, e.g. "User: ..." / "Assistant: ...". Content continues until the
// next labelled line.
//
// The conversation's native id is a hash of the pasted text, so re-pasting the
// same transcript de-duplicates against the existing import instead of creating
// a duplicate conversation — the same guarantee the other importers have.

import { safeTitle, sha256 } from "../continuity";
import type { ParseStats, ParsedConversation, ParsedMessage } from "./claudeExport";

export const PASTED_TRANSCRIPT_SOURCE_FORMAT = "pasted_transcript";
export const PASTED_TRANSCRIPT_DISPLAY_LABEL = "Pasted transcript";
export const PASTED_TRANSCRIPT_HINT =
  "Start each turn with a role label and a colon — “User:” or “Assistant:” (also accepts Human / AI / Claude / ChatGPT / Gemini / System). Content continues until the next label.";

const USER_LABELS = new Set(["user", "human", "me", "you", "prompt", "q"]);
const ASSISTANT_LABELS = new Set(["assistant", "ai", "model", "claude", "chatgpt", "gpt", "gemini", "bot", "response", "answer", "a"]);
const SYSTEM_LABELS = new Set(["system", "developer", "instruction"]);

type ParsedRole = "user" | "assistant" | "system";

function classify(label: string): ParsedRole | null {
  const key = label.trim().toLowerCase().replace(/\s+/g, " ");
  if (USER_LABELS.has(key)) return "user";
  if (ASSISTANT_LABELS.has(key)) return "assistant";
  if (SYSTEM_LABELS.has(key)) return "system";
  return null;
}

// Finds a leading role label on a line, tolerating markdown emphasis, headings,
// and blockquote markers ("**User:**", "### Assistant:", "> User:"). Returns
// null for any line that is not a new turn, so ordinary prose containing a colon
// ("Note: ...") is treated as content, not as a role.
function turnLabel(line: string): { role: ParsedRole; rest: string } | null {
  const candidate = line.replace(/^\s*[>#]+\s*/, "");
  const match = candidate.match(/^([*_`]{0,2})([A-Za-z][A-Za-z0-9 ._-]{0,28}?)([*_`]{0,2})\s*:\s*(.*)$/);
  if (!match) return null;
  const role = classify(match[2]);
  if (!role) return null;
  return { role, rest: match[4] };
}

export function parsePastedTranscript(input: { text: string; title?: string; createdAt?: string }): { conversations: ParsedConversation[]; stats: ParseStats } {
  const text = (input.text ?? "").replace(/\r\n?/g, "\n");
  const stats: ParseStats = { conversationsSeen: 1, conversationsEmpty: 0, messagesSeen: 0, messagesWithNoContent: 0, blockTypeCounts: {} };

  const messages: ParsedMessage[] = [];
  let current: { role: ParsedRole; content: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const content = current.content.join("\n").trim();
    stats.messagesSeen += 1;
    if (!content) stats.messagesWithNoContent += 1;
    stats.blockTypeCounts[current.role] = (stats.blockTypeCounts[current.role] ?? 0) + 1;
    messages.push({
      nativeMessageId: `m${messages.length + 1}`,
      nativeParentId: null,
      role: current.role,
      content,
      nativeCreatedAt: input.createdAt ?? new Date().toISOString(),
      rawPayloadJson: JSON.stringify({ role: current.role, content }),
      hadTextContent: content.length > 0,
    });
    current = null;
  };

  for (const line of text.split("\n")) {
    const turn = turnLabel(line);
    if (turn) {
      flush();
      current = { role: turn.role, content: turn.rest ? [turn.rest] : [] };
    } else if (current) {
      current.content.push(line);
    }
    // Lines before the first label (preamble/headers) are intentionally ignored.
  }
  flush();

  if (messages.length === 0) {
    throw new Error("No labelled turns found. Start each turn with a role and a colon, e.g. 'User:' or 'Assistant:'.");
  }
  if (!messages.some(m => m.content.length > 0)) stats.conversationsEmpty = 1;

  const digest = sha256(text.trim());
  const nativeConversationId = `paste-${digest.slice(0, 16)}`;
  const firstUser = messages.find(m => m.role === "user" && m.content.length > 0);
  const title = safeTitle(input.title, firstUser ? safeTitle(firstUser.content, "Pasted transcript") : "Pasted transcript");

  // Message ids are namespaced by the conversation digest so they stay stable
  // across re-imports and cannot collide with another pasted transcript.
  const namespaced = messages.map(message => ({ ...message, nativeMessageId: `${nativeConversationId}:${message.nativeMessageId}` }));

  return {
    conversations: [{
      nativeConversationId,
      title,
      nativeCreatedAt: input.createdAt ?? new Date().toISOString(),
      nativeUpdatedAt: null,
      rawPayloadJson: JSON.stringify({ source: PASTED_TRANSCRIPT_SOURCE_FORMAT, title: input.title ?? null, digest }),
      messages: namespaced,
    }],
    stats,
  };
}
