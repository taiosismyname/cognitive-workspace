// Parser for Claude.ai's account data export (Settings -> Export data).
// Built and verified against a real 622-conversation / 52MB export, not a
// guessed schema — see server/importers/claudeExport.test.ts for the shape
// this was validated against.
//
// Export root is a JSON array of conversations:
//   { uuid, name, summary, created_at, updated_at, account: { uuid },
//     chat_messages: [ { uuid, text, content: Block[], sender, created_at,
//       updated_at, attachments, files, parent_message_uuid } ] }
//
// Two real quirks this accounts for, found by inspecting the actual file:
//   1. The top-level `text` field is a convenience mirror of the `content`
//      blocks' text, and is only ever non-empty when `content` is too — but
//      165 of ~6900 messages in the sample had `content` set and empty
//      top-level `text` (tool-only/thinking-only turns), so we fall back to
//      joining the `content` blocks rather than trusting `text` alone.
//   2. `content` blocks come in six real types: text, tool_use, tool_result,
//      thinking, voice_note, token_budget. Only `text` and `voice_note` carry
//      a `.text` field; the rest are kept in full in the raw payload for
//      provenance but don't contribute to the flattened message content.

export interface ClaudeExportBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface ClaudeExportMessage {
  uuid: string;
  text?: string;
  content?: ClaudeExportBlock[];
  sender: "human" | "assistant" | string;
  created_at: string;
  updated_at?: string;
  parent_message_uuid?: string;
  attachments?: unknown[];
  files?: unknown[];
}

export interface ClaudeExportConversation {
  uuid: string;
  name?: string;
  summary?: string;
  created_at: string;
  updated_at?: string;
  account?: { uuid: string };
  chat_messages: ClaudeExportMessage[];
}

export interface ParsedMessage {
  nativeMessageId: string;
  nativeParentId: string | null;
  role: "user" | "assistant" | "tool";
  content: string;
  nativeCreatedAt: string;
  rawPayloadJson: string;
  hadTextContent: boolean;
}

export interface ParsedConversation {
  nativeConversationId: string;
  title: string | null;
  nativeCreatedAt: string;
  nativeUpdatedAt: string | null;
  rawPayloadJson: string;
  messages: ParsedMessage[];
}

export interface ParseStats {
  conversationsSeen: number;
  conversationsEmpty: number;
  messagesSeen: number;
  messagesWithNoContent: number;
  blockTypeCounts: Record<string, number>;
}

function flattenContent(msg: ClaudeExportMessage): { content: string; hadTextContent: boolean } {
  const blocks = msg.content ?? [];
  const textPieces = blocks
    .filter(b => (b.type === "text" || b.type === "voice_note") && typeof b.text === "string" && b.text.length > 0)
    .map(b => b.text as string);

  if (textPieces.length > 0) {
    return { content: textPieces.join("\n\n"), hadTextContent: true };
  }
  if (msg.text) {
    return { content: msg.text, hadTextContent: true };
  }
  return { content: "", hadTextContent: false };
}

function mapRole(sender: string): "user" | "assistant" | "tool" {
  if (sender === "human") return "user";
  if (sender === "assistant") return "assistant";
  return "tool";
}

export function parseClaudeExport(raw: unknown): { conversations: ParsedConversation[]; stats: ParseStats } {
  if (!Array.isArray(raw)) {
    throw new Error("Claude export root is expected to be an array of conversations");
  }

  const stats: ParseStats = {
    conversationsSeen: 0,
    conversationsEmpty: 0,
    messagesSeen: 0,
    messagesWithNoContent: 0,
    blockTypeCounts: {},
  };

  const conversations: ParsedConversation[] = (raw as ClaudeExportConversation[]).map(conv => {
    stats.conversationsSeen += 1;
    const chatMessages = conv.chat_messages ?? [];
    if (chatMessages.length === 0) stats.conversationsEmpty += 1;

    const messages: ParsedMessage[] = chatMessages.map(msg => {
      stats.messagesSeen += 1;
      for (const block of msg.content ?? []) {
        stats.blockTypeCounts[block.type] = (stats.blockTypeCounts[block.type] ?? 0) + 1;
      }
      const { content, hadTextContent } = flattenContent(msg);
      if (!hadTextContent) stats.messagesWithNoContent += 1;

      return {
        nativeMessageId: msg.uuid,
        nativeParentId: msg.parent_message_uuid && msg.parent_message_uuid !== "00000000-0000-4000-8000-000000000000" ? msg.parent_message_uuid : null,
        role: mapRole(msg.sender),
        content,
        nativeCreatedAt: msg.created_at,
        rawPayloadJson: JSON.stringify(msg),
        hadTextContent,
      };
    });

    return {
      nativeConversationId: conv.uuid,
      title: conv.name && conv.name.length > 0 ? conv.name : null,
      nativeCreatedAt: conv.created_at,
      nativeUpdatedAt: conv.updated_at ?? null,
      rawPayloadJson: JSON.stringify({ uuid: conv.uuid, name: conv.name, summary: conv.summary, account: conv.account }),
      messages,
    };
  });

  return { conversations, stats };
}
