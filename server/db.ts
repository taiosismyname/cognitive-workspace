import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2";
import {
  conversationMessages,
  conversationOrigins,
  conversations,
  councilContextItems,
  councilContextManifests,
  councilResults,
  councilRuns,
  historyImports,
  memories,
  messageOrigins,
  modelRegistry,
  modelStateArtifactSources,
  modelStateArtifacts,
  modelStateSnapshots,
  providerConnections,
  reconstructionRuns,
  users,
  type InsertUser,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import type { NormalizedStateArtifact } from "./continuity";

let _db: ReturnType<typeof drizzle> | null = null;

// mysql2's `uri` option merges with any explicit sibling fields (uri parsed
// first, then overridden by whatever else is passed) — this is the documented
// way to layer connection options on top of a plain connection string. Needed
// because TiDB Cloud Serverless requires TLS, and a bare
// `drizzle(connectionString)` call doesn't reliably negotiate it: mysql2 only
// auto-enables SSL from a URL's own `ssl=`/`ssl-mode=` query param, and TiDB
// Cloud's own connection strings often don't include one, leaving the client
// to attempt a plaintext handshake against a server that requires TLS.
// Verified against a live TiDB Cloud Serverless instance.
function buildPoolConfig(connectionString: string) {
  let hasExplicitSslParam = false;
  try {
    const url = new URL(connectionString);
    hasExplicitSslParam = url.searchParams.has("ssl") || url.searchParams.has("ssl-mode");
  } catch {
    // Malformed URL — let mysql2's own parser surface the real error.
  }
  return {
    uri: connectionString,
    ssl: hasExplicitSslParam ? undefined : { minVersion: "TLSv1.2" as const, rejectUnauthorized: true },
  };
}

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const pool = mysql.createPool(buildPoolConfig(process.env.DATABASE_URL));
      _db = drizzle(pool);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) { values[field] = user[field] ?? null; updateSet[field] = user[field] ?? null; }
  }
  values.lastSignedIn = user.lastSignedIn ?? new Date();
  updateSet.lastSignedIn = values.lastSignedIn;
  if (user.role !== undefined || user.openId === ENV.ownerOpenId) { values.role = user.role ?? "admin"; updateSet.role = values.role; }
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result[0];
}

// Local email/password signup — separate from upsertUser (which is the
// Manus-OAuth sync path) since this sets passwordHash and mints its own
// openId rather than receiving one from an external identity provider.
export async function createLocalUser(input: { openId: string; email: string; name: string; passwordHash: string }) {
  const db = await getDb();
  if (!db) return undefined;
  await db.insert(users).values({ openId: input.openId, email: input.email, name: input.name, passwordHash: input.passwordHash, loginMethod: "password", lastSignedIn: new Date(), role: input.openId === ENV.ownerOpenId ? "admin" : "user" });
  return getUserByOpenId(input.openId);
}

export async function listModels(userId: number) { const db = await getDb(); return db ? db.select().from(modelRegistry).where(eq(modelRegistry.userId, userId)).orderBy(desc(modelRegistry.updatedAt)) : []; }
export async function listConversations(userId: number) { const db = await getDb(); return db ? db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.updatedAt)) : []; }
export async function listMessages(conversationId: number) { const db = await getDb(); return db ? db.select().from(conversationMessages).where(eq(conversationMessages.conversationId, conversationId)).orderBy(conversationMessages.createdAt) : []; }
export async function listMemories(userId: number) { const db = await getDb(); return db ? db.select().from(memories).where(eq(memories.userId, userId)).orderBy(desc(memories.updatedAt)) : []; }
export async function listCouncilRuns(userId: number) { const db = await getDb(); return db ? db.select().from(councilRuns).where(eq(councilRuns.userId, userId)).orderBy(desc(councilRuns.createdAt)) : []; }
export async function getCouncilResults(councilRunId: number) { const db = await getDb(); return db ? db.select().from(councilResults).where(eq(councilResults.councilRunId, councilRunId)).orderBy(councilResults.createdAt) : []; }
export async function listProviderConnections(userId: number) { const db = await getDb(); return db ? db.select().from(providerConnections).where(eq(providerConnections.userId, userId)).orderBy(desc(providerConnections.updatedAt)) : []; }
export async function listHistoryImports(userId: number) { const db = await getDb(); return db ? db.select().from(historyImports).where(eq(historyImports.userId, userId)).orderBy(desc(historyImports.createdAt)) : []; }
export async function listStateSnapshots(userId: number, modelId?: number) {
  const db = await getDb();
  if (!db) return [];
  const condition = modelId ? and(eq(modelStateSnapshots.userId, userId), eq(modelStateSnapshots.modelRegistryId, modelId)) : eq(modelStateSnapshots.userId, userId);
  return db.select().from(modelStateSnapshots).where(condition).orderBy(desc(modelStateSnapshots.createdAt));
}
export async function listStateArtifacts(snapshotId: number) { const db = await getDb(); return db ? db.select().from(modelStateArtifacts).where(eq(modelStateArtifacts.snapshotId, snapshotId)).orderBy(modelStateArtifacts.createdAt) : []; }
export async function listArtifactSources(artifactIds: number[]) { const db = await getDb(); return db && artifactIds.length ? db.select().from(modelStateArtifactSources).where(inArray(modelStateArtifactSources.artifactId, artifactIds)) : []; }
// Conversations that came in through a file-based provider import, paired
// with their origin record — what Continuity.tsx's "Imported conversations"
// panel reads.
export async function listImportedConversations(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ conversation: conversations, origin: conversationOrigins })
    .from(conversationOrigins)
    .innerJoin(conversations, eq(conversationOrigins.conversationId, conversations.id))
    .where(and(eq(conversations.userId, userId), eq(conversationOrigins.originType, "manual_file_import")))
    .orderBy(desc(conversations.createdAt));
  return rows;
}
export async function getImportForUser(userId: number, importId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(historyImports).where(and(eq(historyImports.id, importId), eq(historyImports.userId, userId))).limit(1);
  return rows[0];
}
export async function getConnectionForUser(userId: number, connectionId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(providerConnections).where(and(eq(providerConnections.id, connectionId), eq(providerConnections.userId, userId))).limit(1);
  return rows[0];
}
export async function getCurrentSnapshot(userId: number, modelId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(modelStateSnapshots).where(and(eq(modelStateSnapshots.userId, userId), eq(modelStateSnapshots.modelRegistryId, modelId), eq(modelStateSnapshots.isCurrent, true), eq(modelStateSnapshots.status, "published"))).limit(1);
  return rows[0];
}
export async function getOwnedSnapshot(userId: number, snapshotId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(modelStateSnapshots).where(and(eq(modelStateSnapshots.id, snapshotId), eq(modelStateSnapshots.userId, userId))).limit(1);
  return rows[0];
}
export async function ownsConversation(userId: number, conversationId: number) {
  const db = await getDb(); if (!db) return false;
  const rows = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId))).limit(1);
  return Boolean(rows[0]);
}
export async function ownsModel(userId: number, modelId: number) {
  const db = await getDb(); if (!db) return undefined;
  const rows = await db.select().from(modelRegistry).where(and(eq(modelRegistry.id, modelId), eq(modelRegistry.userId, userId))).limit(1);
  return rows[0];
}
export async function ownsReconstructionRun(userId: number, runId: number) {
  const db = await getDb(); if (!db) return undefined;
  const rows = await db.select().from(reconstructionRuns).where(and(eq(reconstructionRuns.id, runId), eq(reconstructionRuns.userId, userId))).limit(1);
  return rows[0];
}
export async function getContextManifest(manifestId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(councilContextManifests).where(eq(councilContextManifests.id, manifestId)).limit(1);
  return rows[0];
}
export async function getContextItems(manifestId: number) {
  const db = await getDb();
  return db ? db.select().from(councilContextItems).where(eq(councilContextItems.manifestId, manifestId)).orderBy(councilContextItems.ordinal) : [];
}
export async function getOrCreateProviderConnection(userId: number, providerKey: string, displayLabel: string) {
  const db = await getDb();
  if (!db) return undefined;
  const existing = await db.select().from(providerConnections).where(and(eq(providerConnections.userId, userId), eq(providerConnections.providerKey, providerKey))).limit(1);
  if (existing[0]) return existing[0];
  const result = await db.insert(providerConnections).values({ userId, providerKey, displayLabel, status: "active" });
  const row = await db.select().from(providerConnections).where(eq(providerConnections.id, result[0].insertId)).limit(1);
  return row[0];
}

export async function createHistoryImport(userId: number, providerConnectionId: number, sourceFileName: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.insert(historyImports).values({ userId, providerConnectionId, mode: "full", status: "running", sourceFileName, startedAt: new Date() });
  const row = await db.select().from(historyImports).where(eq(historyImports.id, result[0].insertId)).limit(1);
  return row[0];
}

export async function completeHistoryImport(importId: number, counts: { conversationsDiscovered: number; conversationsImported: number; messagesImported: number; duplicatesSkipped: number }, status: "completed" | "partial" | "failed", errorJson?: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(historyImports).set({ ...counts, status, errorJson: errorJson ?? null, completedAt: new Date() }).where(eq(historyImports.id, importId));
}

// Cross-run dedup: has this native conversation already been imported for this
// provider connection? Scoped by providerConnectionId, not historyImportId, so
// re-uploading a refreshed export doesn't create duplicate conversations.
export async function findExistingConversationByNativeId(providerConnectionId: number, nativeConversationId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select({ conversationId: conversationOrigins.conversationId }).from(conversationOrigins).where(and(eq(conversationOrigins.providerConnectionId, providerConnectionId), eq(conversationOrigins.nativeConversationId, nativeConversationId))).limit(1);
  return rows[0]?.conversationId;
}

// Cross-run dedup for messages: NOTE — message_origins' own unique constraint
// is scoped to (historyImportId, nativeMessageId), which only protects against
// duplicates *within one import run*. This query is what actually protects
// against duplicates *across* re-imports, by checking already-imported native
// message ids for the conversation directly. Worth tightening the DB
// constraint itself in a later migration (scope it to a stable per-provider
// id instead of historyImportId) — this is the app-level guard in the
// meantime.
export async function findExistingMessageNativeIds(conversationId: number): Promise<Set<string>> {
  const db = await getDb();
  if (!db) return new Set();
  const rows = await db
    .select({ nativeMessageId: messageOrigins.nativeMessageId })
    .from(messageOrigins)
    .innerJoin(conversationMessages, eq(messageOrigins.messageId, conversationMessages.id))
    .where(eq(conversationMessages.conversationId, conversationId));
  return new Set(rows.map(r => r.nativeMessageId).filter((id): id is string => id !== null));
}

export async function insertImportedConversation(userId: number, providerConnectionId: number, historyImportId: number, providerKey: string, conv: { nativeConversationId: string; title: string | null; nativeCreatedAt: string; nativeUpdatedAt: string | null; rawPayloadJson: string }) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.insert(conversations).values({ userId, title: conv.title ?? "(untitled import)" });
  const conversationId = result[0].insertId;
  await db.insert(conversationOrigins).values({
    conversationId,
    originType: "manual_file_import",
    providerConnectionId,
    historyImportId,
    providerKey,
    nativeConversationId: conv.nativeConversationId,
    nativeCreatedAt: new Date(conv.nativeCreatedAt),
    nativeUpdatedAt: conv.nativeUpdatedAt ? new Date(conv.nativeUpdatedAt) : null,
    rawPayloadJson: conv.rawPayloadJson,
  });
  return conversationId;
}

// Batch insert. Relies on MySQL's guarantee that auto_increment ids assigned
// within a single multi-row INSERT are contiguous starting at insertId — this
// hasn't been run against a live database, only type-checked, so verify the
// id sequencing on the first real import before trusting it at scale.
export async function insertImportedMessages(conversationId: number, historyImportId: number, messages: { nativeMessageId: string; nativeParentId: string | null; role: string; content: string; nativeCreatedAt: string; rawPayloadJson: string }[]) {
  const db = await getDb();
  if (!db || messages.length === 0) return 0;
  const role = (r: string): "system" | "user" | "assistant" | "tool" => (r === "user" || r === "assistant" || r === "system" ? r : "tool");
  const result = await db.insert(conversationMessages).values(
    messages.map(m => ({ conversationId, role: role(m.role), content: m.content, createdAt: new Date(m.nativeCreatedAt) })),
  );
  const firstId = result[0].insertId;
  await db.insert(messageOrigins).values(
    messages.map((m, i) => ({
      messageId: firstId + i,
      historyImportId,
      nativeMessageId: m.nativeMessageId,
      nativeParentId: m.nativeParentId,
      nativeCreatedAt: new Date(m.nativeCreatedAt),
      rawPayloadJson: m.rawPayloadJson,
    })),
  );
  return messages.length;
}

// --- Reconstruction pipeline write path -------------------------------------
// The corpus loader and the snapshot/artifact persistence used by
// runReconstruction(). These were the missing half of the continuity feature:
// the tables and read helpers existed, but nothing ever wrote to them.

export type ReconstructionCorpusConversation = {
  conversationId: number;
  title: string | null;
  createdAt: Date;
  providerKey: string | null;
  messages: Array<{ id: number; role: string; content: string }>;
};

// Loads the normalized corpus for one lane. When historyImportId is given the
// corpus is scoped to that import; otherwise every imported conversation for
// the user is included. providerKey travels with each conversation so the
// reconstruction run records which source format(s) its state was derived from.
export async function loadCorpusForReconstruction(userId: number, historyImportId: number | null): Promise<ReconstructionCorpusConversation[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(conversations.userId, userId)];
  if (historyImportId !== null) conditions.push(eq(conversationOrigins.historyImportId, historyImportId));
  const rows = await db
    .select({ conversation: conversations, origin: conversationOrigins })
    .from(conversationOrigins)
    .innerJoin(conversations, eq(conversationOrigins.conversationId, conversations.id))
    .where(and(...conditions))
    .orderBy(conversations.createdAt);

  const corpus: ReconstructionCorpusConversation[] = [];
  for (const row of rows) {
    const messages = await db
      .select({ id: conversationMessages.id, role: conversationMessages.role, content: conversationMessages.content })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationId, row.conversation.id))
      .orderBy(conversationMessages.id);
    corpus.push({ conversationId: row.conversation.id, title: row.conversation.title, createdAt: row.conversation.createdAt, providerKey: row.origin.providerKey ?? null, messages });
  }
  return corpus;
}

export async function createReconstructionRun(input: { userId: number; modelRegistryId: number; historyImportId: number | null; sourceSelectionJson: string; strategyVersion: string; inputManifestHash: string }) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.insert(reconstructionRuns).values({ userId: input.userId, modelRegistryId: input.modelRegistryId, historyImportId: input.historyImportId, sourceSelectionJson: input.sourceSelectionJson, strategyVersion: input.strategyVersion, inputManifestHash: input.inputManifestHash, status: "running", startedAt: new Date() });
  return Number(result[0].insertId);
}

export async function completeReconstructionRun(runId: number, status: "completed" | "partial" | "failed", rawResponseJson?: string, errorJson?: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(reconstructionRuns).set({ status, rawResponseJson: rawResponseJson ?? null, errorJson: errorJson ?? null, completedAt: new Date() }).where(eq(reconstructionRuns.id, runId));
}

// Highest version in the lane regardless of status — used to allocate the next
// version number and to hand the previous state back to the model.
export async function getLatestSnapshot(userId: number, modelRegistryId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(modelStateSnapshots).where(and(eq(modelStateSnapshots.userId, userId), eq(modelStateSnapshots.modelRegistryId, modelRegistryId))).orderBy(desc(modelStateSnapshots.version)).limit(1);
  return rows[0];
}

export async function insertSnapshot(input: { userId: number; modelRegistryId: number; reconstructionRunId: number; parentSnapshotId: number | null; version: number; stateSchemaVersion: string; stateSummaryJson: string; stateHash: string }) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.insert(modelStateSnapshots).values({ userId: input.userId, modelRegistryId: input.modelRegistryId, reconstructionRunId: input.reconstructionRunId, parentSnapshotId: input.parentSnapshotId, version: input.version, stateSchemaVersion: input.stateSchemaVersion, status: "published", isCurrent: true, stateSummaryJson: input.stateSummaryJson, stateHash: input.stateHash, publishedAt: new Date() });
  return Number(result[0].insertId);
}

// Retires every other current snapshot in the lane, so exactly one row has
// is_current = true. Scoped with ne() so the just-published snapshot is kept.
export async function retireCurrentSnapshots(userId: number, modelRegistryId: number, exceptSnapshotId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(modelStateSnapshots).set({ isCurrent: false, status: "superseded" }).where(and(eq(modelStateSnapshots.userId, userId), eq(modelStateSnapshots.modelRegistryId, modelRegistryId), eq(modelStateSnapshots.isCurrent, true), ne(modelStateSnapshots.id, exceptSnapshotId)));
}

// Batch insert. Relies on MySQL/TiDB assigning contiguous auto_increment ids
// from insertId within one multi-row insert; this is verified against a live
// TiDB database at the end-to-end step.
export async function insertStateArtifacts(snapshotId: number, artifacts: NormalizedStateArtifact[]) {
  const db = await getDb();
  if (!db || artifacts.length === 0) return [] as Array<{ artifactId: number }>;
  const result = await db.insert(modelStateArtifacts).values(artifacts.map(artifact => ({ snapshotId, artifactType: artifact.artifactType, contentJson: JSON.stringify(artifact.content), confidence: artifact.confidence ?? null, status: "active" as const })));
  const firstId = Number(result[0].insertId);
  return artifacts.map((_, index) => ({ artifactId: firstId + index }));
}

export async function insertArtifactSources(rows: Array<{ artifactId: number; conversationId: number; messageId?: number; sourceRole?: string; quote?: string }>) {
  const db = await getDb();
  if (!db || rows.length === 0) return 0;
  await db.insert(modelStateArtifactSources).values(rows.map(row => ({ artifactId: row.artifactId, conversationId: row.conversationId, messageId: row.messageId ?? null, sourceRole: row.sourceRole ?? "evidence", relevance: null, quoteJson: row.quote ? JSON.stringify({ quote: row.quote }) : null })));
  return rows.length;
}

export { conversations, conversationMessages, councilContextItems, councilContextManifests, councilResults, councilRuns, historyImports, memories, messageOrigins, modelRegistry, modelStateArtifactSources, modelStateArtifacts, modelStateSnapshots, providerConnections, reconstructionRuns };
