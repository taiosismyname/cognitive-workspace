// Shared persistence for file-based history imports. Both parsers
// (claudeExport, entriesQueryExport) produce the same ParsedConversation[]
// shape, so the write path is identical — only the provider key/label differ,
// and that key is what keeps the two sources distinguishable in provenance.

import * as db from "../db";
import type { ParsedConversation } from "./claudeExport";

export type PersistedImport = {
  historyImportId: number;
  conversationsImported: number;
  messagesImported: number;
  duplicatesSkipped: number;
};

export async function persistParsedImport(input: {
  userId: number;
  providerKey: string;
  displayLabel: string;
  sourceFileName: string;
  conversationsSeen: number;
  parsed: ParsedConversation[];
}): Promise<PersistedImport> {
  const connection = await db.getOrCreateProviderConnection(input.userId, input.providerKey, input.displayLabel);
  if (!connection) throw new Error("Database unavailable");
  const historyImport = await db.createHistoryImport(input.userId, connection.id, input.sourceFileName);
  if (!historyImport) throw new Error("Database unavailable");

  let conversationsImported = 0;
  let messagesImported = 0;
  let duplicatesSkipped = 0;

  try {
    for (const conv of input.parsed) {
      let conversationId = await db.findExistingConversationByNativeId(connection.id, conv.nativeConversationId);
      if (conversationId) {
        duplicatesSkipped += 1;
      } else {
        conversationId = await db.insertImportedConversation(input.userId, connection.id, historyImport.id, input.providerKey, conv);
        conversationsImported += 1;
      }
      if (!conversationId) continue;

      const existingMessageIds = await db.findExistingMessageNativeIds(conversationId);
      const newMessages = conv.messages.filter(m => !existingMessageIds.has(m.nativeMessageId));
      duplicatesSkipped += conv.messages.length - newMessages.length;
      messagesImported += await db.insertImportedMessages(conversationId, historyImport.id, newMessages);
    }
    await db.completeHistoryImport(
      historyImport.id,
      { conversationsDiscovered: input.conversationsSeen, conversationsImported, messagesImported, duplicatesSkipped },
      "completed",
    );
  } catch (error) {
    await db.completeHistoryImport(
      historyImport.id,
      { conversationsDiscovered: input.conversationsSeen, conversationsImported, messagesImported, duplicatesSkipped },
      "failed",
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }

  return { historyImportId: historyImport.id, conversationsImported, messagesImported, duplicatesSkipped };
}
