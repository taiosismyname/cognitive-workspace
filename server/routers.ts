import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { conversationMessages, conversations, councilResults, councilRuns, memories, modelRegistry } from "../drizzle/schema";
import { cosineSimilarity, getAdapter, ProviderUnavailableError } from "./adapters";
import { getDb, getCouncilResults, listConversations, listMemories, listMessages, listModels, listCouncilRuns, listProviderConnections, listHistoryImports, listStateSnapshots, listStateArtifacts, listArtifactSources, listImportedConversations, getOrCreateProviderConnection, createHistoryImport, completeHistoryImport, findExistingConversationByNativeId, findExistingMessageNativeIds, insertImportedConversation, insertImportedMessages, ownsConversation, ownsModel } from "./db";
import { parseClaudeExport } from "./importers/claudeExport";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";

const modelInput = z.object({ providerKey: z.string().min(1), modelKey: z.string().min(1), displayName: z.string().min(1), adapterStatus: z.enum(["active", "unimplemented", "disabled"]).default("active"), notes: z.string().optional() });
const memoryInput = z.object({ modelId: z.number().int().positive(), sourceConversationId: z.number().int().positive(), sourceMessageId: z.number().int().positive(), content: z.string().min(1), memoryType: z.string().min(1).default("fact"), isRetrievalEligible: z.boolean().default(true) });

function requireDatabase(db: Awaited<ReturnType<typeof getDb>>) {
  if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Database is not available." });
  return db;
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => { const cookieOptions = getSessionCookieOptions(ctx.req); ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 }); return { success: true } as const; }),
  }),
  workspace: router({
    overview: protectedProcedure.query(async ({ ctx }) => {
      const [models, conversationsList, memoriesList, runs] = await Promise.all([listModels(ctx.user.id), listConversations(ctx.user.id), listMemories(ctx.user.id), listCouncilRuns(ctx.user.id)]);
      return { models, conversations: conversationsList, memories: memoriesList, councilRuns: runs, integration: { openrouter: Boolean(ENV.openRouterApiKey), embeddingModel: ENV.openRouterEmbeddingModel } };
    }),
    models: protectedProcedure.query(({ ctx }) => listModels(ctx.user.id)),
    registerModel: protectedProcedure.input(modelInput).mutation(async ({ ctx, input }) => {
      const db = requireDatabase(await getDb());
      const result = await db.insert(modelRegistry).values({ ...input, userId: ctx.user.id });
      return { id: Number(result[0].insertId), ...input };
    }),
    conversations: protectedProcedure.query(({ ctx }) => listConversations(ctx.user.id)),
    conversation: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
      if (!(await ownsConversation(ctx.user.id, input.id))) throw new TRPCError({ code: "NOT_FOUND" });
      return { messages: await listMessages(input.id) };
    }),
    createConversation: protectedProcedure.input(z.object({ title: z.string().min(1).max(255) })).mutation(async ({ ctx, input }) => {
      const db = requireDatabase(await getDb());
      const result = await db.insert(conversations).values({ userId: ctx.user.id, title: input.title });
      return { id: Number(result[0].insertId), title: input.title };
    }),
    sendMessage: protectedProcedure.input(z.object({ conversationId: z.number().int().positive(), modelId: z.number().int().positive(), content: z.string().min(1) })).mutation(async ({ ctx, input }) => {
      if (!(await ownsConversation(ctx.user.id, input.conversationId))) throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found." });
      const model = await ownsModel(ctx.user.id, input.modelId);
      if (!model) throw new TRPCError({ code: "NOT_FOUND", message: "Model not found." });
      if (model.adapterStatus !== "active") throw new TRPCError({ code: "PRECONDITION_FAILED", message: `This model is ${model.adapterStatus}; no provider call was attempted.` });
      const db = requireDatabase(await getDb());
      await db.insert(conversationMessages).values({ conversationId: input.conversationId, role: "user", content: input.content, modelRegistryId: model.id });
      const prior = await listMessages(input.conversationId);
      const adapterMessages: import("./adapters").ChatTurn[] = prior.map(message => ({ role: (message.role === "tool" ? "assistant" : message.role) as "system" | "user" | "assistant", content: message.content }));
      adapterMessages.push({ role: "user", content: input.content });
      try {
        const response = await getAdapter(model.providerKey).complete({ modelKey: model.modelKey, messages: adapterMessages });
        const inserted = await db.insert(conversationMessages).values({ conversationId: input.conversationId, role: "assistant", content: response.text, modelRegistryId: model.id, providerRequestId: response.requestId });
        return { messageId: Number(inserted[0].insertId), content: response.text, providerRequestId: response.requestId };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Provider call failed.";
        throw new TRPCError({ code: "BAD_GATEWAY", message });
      }
    }),
    memories: protectedProcedure.query(({ ctx }) => listMemories(ctx.user.id)),
    createMemory: protectedProcedure.input(memoryInput).mutation(async ({ ctx, input }) => {
      if (!(await ownsConversation(ctx.user.id, input.sourceConversationId))) throw new TRPCError({ code: "NOT_FOUND", message: "Source conversation not found." });
      const model = await ownsModel(ctx.user.id, input.modelId);
      if (!model) throw new TRPCError({ code: "NOT_FOUND", message: "Model not found." });
      const sourceMessages = await listMessages(input.sourceConversationId);
      if (!sourceMessages.some(message => message.id === input.sourceMessageId)) throw new TRPCError({ code: "BAD_REQUEST", message: "Source message is not part of the source conversation." });
      const db = requireDatabase(await getDb());
      let embeddingJson: string | undefined;
      let embeddingModel: string | undefined;
      try {
        const vector = await getAdapter(model.providerKey).embed({ modelKey: ENV.openRouterEmbeddingModel, input: input.content });
        embeddingJson = JSON.stringify(vector);
        embeddingModel = ENV.openRouterEmbeddingModel;
      } catch (error) {
        if (!(error instanceof ProviderUnavailableError)) throw error;
      }
      const result = await db.insert(memories).values({ userId: ctx.user.id, modelRegistryId: model.id, sourceConversationId: input.sourceConversationId, sourceMessageId: input.sourceMessageId, content: input.content, memoryType: input.memoryType, embeddingJson, embeddingModel, isRetrievalEligible: input.isRetrievalEligible });
      return { id: Number(result[0].insertId), embeddingStatus: embeddingJson ? "embedded" : "unavailable" };
    }),
    setMemoryEligibility: protectedProcedure.input(z.object({ id: z.number().int().positive(), isRetrievalEligible: z.boolean() })).mutation(async ({ ctx, input }) => {
      const db = requireDatabase(await getDb());
      const owned = (await listMemories(ctx.user.id)).find(memory => memory.id === input.id);
      if (!owned) throw new TRPCError({ code: "NOT_FOUND", message: "Memory not found." });
      await db.update(memories).set({ isRetrievalEligible: input.isRetrievalEligible }).where(eq(memories.id, input.id));
      return { success: true, id: input.id, isRetrievalEligible: input.isRetrievalEligible };
    }),
    retrieve: protectedProcedure.input(z.object({ query: z.string().min(1), modelIds: z.array(z.number().int().positive()).optional(), limit: z.number().int().min(1).max(20).default(8) })).mutation(async ({ ctx, input }) => {
      const all = await listMemories(ctx.user.id);
      const eligible = all.filter(memory => memory.isRetrievalEligible && (!input.modelIds?.length || input.modelIds.includes(memory.modelRegistryId)) && memory.embeddingJson);
      if (!eligible.length) return { results: [], status: "unavailable" as const, message: "No eligible embedded memories are available for semantic retrieval." };
      const vector = await getAdapter("openrouter").embed({ modelKey: ENV.openRouterEmbeddingModel, input: input.query });
      const modelMap = new Map((await listModels(ctx.user.id)).map(model => [model.id, model]));
      const results = await Promise.all(eligible.map(async memory => {
        const sourceMessages = await listMessages(memory.sourceConversationId);
        const sourceMessage = sourceMessages.find(message => message.id === memory.sourceMessageId);
        const conversation = (await listConversations(ctx.user.id)).find(item => item.id === memory.sourceConversationId);
        return { memory, score: cosineSimilarity(vector, JSON.parse(memory.embeddingJson!)), model: modelMap.get(memory.modelRegistryId), provenance: { conversationId: memory.sourceConversationId, conversationTitle: conversation?.title, messageId: memory.sourceMessageId, messageCreatedAt: sourceMessage?.createdAt } };
      }));
      return { results: results.sort((a, b) => b.score - a.score).slice(0, input.limit), status: "ready" as const };
    }),
    councilRuns: protectedProcedure.query(({ ctx }) => listCouncilRuns(ctx.user.id)),
    councilRun: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const run = (await listCouncilRuns(ctx.user.id)).find(item => item.id === input.id);
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });
      return { run, results: await getCouncilResults(input.id) };
    }),
    runCouncil: protectedProcedure.input(z.object({ prompt: z.string().min(1), modelIds: z.array(z.number().int().positive()).min(1).max(8) })).mutation(async ({ ctx, input }) => {
      const db = requireDatabase(await getDb());
      const models = (await Promise.all(input.modelIds.map(id => ownsModel(ctx.user.id, id)))).filter(Boolean);
      if (models.length !== input.modelIds.length) throw new TRPCError({ code: "BAD_REQUEST", message: "One or more selected models are unavailable." });
      const created = await db.insert(councilRuns).values({ userId: ctx.user.id, prompt: input.prompt, status: "running" });
      const runId = Number(created[0].insertId);
      const outcomes = await Promise.all(models.map(async model => {
        const started = Date.now();
        const resultInsert = await db.insert(councilResults).values({ councilRunId: runId, modelRegistryId: model!.id, status: "running" });
        const resultId = Number(resultInsert[0].insertId);
        try {
          if (model!.adapterStatus !== "active") throw new Error(`Model adapter is ${model!.adapterStatus}.`);
          const response = await getAdapter(model!.providerKey).complete({ modelKey: model!.modelKey, messages: [{ role: "user", content: input.prompt }] });
          await db.update(councilResults).set({ status: "completed", responseText: response.text, rawProviderPayload: JSON.stringify(response.raw ?? null), normalizedResult: JSON.stringify({ text: response.text, providerRequestId: response.requestId, modelRegistryId: model!.id, latencyMs: Date.now() - started }), providerRequestId: response.requestId, latencyMs: Date.now() - started, completedAt: new Date() }).where(eq(councilResults.id, resultId));
          return { ok: true };
        } catch (error) {
          await db.update(councilResults).set({ status: "failed", errorMessage: error instanceof Error ? error.message : "Provider call failed.", latencyMs: Date.now() - started, completedAt: new Date() }).where(eq(councilResults.id, resultId));
          return { ok: false };
        }
      }));
      const successCount = outcomes.filter(item => item.ok).length;
      const status = successCount === outcomes.length ? "completed" : successCount ? "partial" : "failed";
      await db.update(councilRuns).set({ status, completedAt: new Date() }).where(eq(councilRuns.id, runId));
      return { runId, status, completed: successCount, failed: outcomes.length - successCount };
    }),
  }),
  // Read-only surface for the continuity data layer (provider connections, history
  // imports, model state snapshots). No mutations yet — connecting a provider,
  // starting an import, and running a reconstruction still need real endpoints
  // plus whatever OAuth/token flow each provider requires. This exists so the
  // "Model continuity" nav entry has something real behind it instead of a 404.
  continuity: router({
    overview: protectedProcedure.query(async ({ ctx }) => {
      const [connections, imports, snapshots, importedConversations] = await Promise.all([
        listProviderConnections(ctx.user.id),
        listHistoryImports(ctx.user.id),
        listStateSnapshots(ctx.user.id),
        listImportedConversations(ctx.user.id),
      ]);
      return { connections, imports, snapshots, importedConversations };
    }),
    // Artifacts + their source citations for one snapshot — what the
    // continuity page's "Derived state and provenance" panel drills into
    // once a model lane/snapshot is selected. Ownership is enforced via
    // listStateArtifacts + a userId check rather than a raw id lookup, since
    // model_state_artifacts has no direct userId column of its own.
    snapshot: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const snapshots = await listStateSnapshots(ctx.user.id);
        if (!snapshots.some(s => s.id === input.id)) return { artifacts: [], sources: [] };
        const artifacts = await listStateArtifacts(input.id);
        const sources = await listArtifactSources(artifacts.map(a => a.id));
        return { artifacts, sources };
      }),
    // File-based import — the only real option for Claude/ChatGPT consumer
    // history, since neither exposes an OAuth history API. Safe to call
    // twice with the same export: conversations dedupe by native id per
    // connection, messages dedupe by native id within the conversation.
    importClaudeExport: protectedProcedure
      .input(z.object({ raw: z.unknown(), sourceFileName: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const { conversations: parsed, stats } = parseClaudeExport(input.raw);
        const connection = await getOrCreateProviderConnection(ctx.user.id, "claude", "Claude.ai export");
        if (!connection) throw new Error("Database unavailable");
        const historyImport = await createHistoryImport(ctx.user.id, connection.id, input.sourceFileName);
        if (!historyImport) throw new Error("Database unavailable");

        let conversationsImported = 0;
        let messagesImported = 0;
        let duplicatesSkipped = 0;

        try {
          for (const conv of parsed) {
            let conversationId = await findExistingConversationByNativeId(connection.id, conv.nativeConversationId);
            if (conversationId) {
              duplicatesSkipped += 1;
            } else {
              conversationId = await insertImportedConversation(ctx.user.id, connection.id, historyImport.id, "claude", conv);
              conversationsImported += 1;
            }
            if (!conversationId) continue;

            const existingMessageIds = await findExistingMessageNativeIds(conversationId);
            const newMessages = conv.messages.filter(m => !existingMessageIds.has(m.nativeMessageId));
            duplicatesSkipped += conv.messages.length - newMessages.length;
            messagesImported += await insertImportedMessages(conversationId, historyImport.id, newMessages);
          }
          await completeHistoryImport(historyImport.id, { conversationsDiscovered: stats.conversationsSeen, conversationsImported, messagesImported, duplicatesSkipped }, "completed");
        } catch (error) {
          await completeHistoryImport(historyImport.id, { conversationsDiscovered: stats.conversationsSeen, conversationsImported, messagesImported, duplicatesSkipped }, "failed", error instanceof Error ? error.message : String(error));
          throw error;
        }

        return { historyImportId: historyImport.id, conversationsImported, messagesImported, duplicatesSkipped, parseStats: stats };
      }),
  }),
});

export type AppRouter = typeof appRouter;
