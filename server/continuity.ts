import { createHash } from "node:crypto";
import { z } from "zod";

export const rawConversationSchema = z.object({
  collection_uuid: z.string().nullable().optional(),
  context_title: z.string().nullable().optional(),
  context_uuid: z.string().nullable().optional(),
  created_at: z.union([z.string(), z.number()]).nullable().optional(),
  entries: z.array(z.record(z.string(), z.unknown())).default([]),
  mode: z.string().nullable().optional(),
  updated_at: z.union([z.string(), z.number()]).nullable().optional(),
}).passthrough();
export type RawConversation = z.infer<typeof rawConversationSchema>;

export function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try { return JSON.stringify(value); } catch { return String(value); }
}

export function parseDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    const date = new Date(value < 10_000_000_000 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  return undefined;
}

export function safeTitle(value: unknown, fallback: string) {
  const title = asText(value).replace(/\s+/g, " ").trim();
  return (title || fallback).slice(0, 255);
}

export function sha256(value: unknown) {
  const serialized = typeof value === "string" ? value : stableJson(value);
  return createHash("sha256").update(serialized).digest("hex");
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

export function extractJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] ?? text;
  const first = fenced.indexOf("{");
  const last = fenced.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("The model did not return a JSON object for reconstruction.");
  const parsed: unknown = JSON.parse(fenced.slice(first, last + 1));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("The reconstruction response was not a JSON object.");
  return parsed as Record<string, unknown>;
}

export type NormalizedStateArtifact = {
  artifactType: string;
  content: Record<string, unknown>;
  confidence?: string;
  citations: Array<{ conversationId: number; messageId?: number; sourceRole?: string; quote?: string }>;
};

function normalizeArtifact(value: unknown, index: number): NormalizedStateArtifact {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawContent = item.content ?? item.statement ?? item.text ?? item.description ?? item;
  const content = rawContent && typeof rawContent === "object" && !Array.isArray(rawContent)
    ? rawContent as Record<string, unknown>
    : { title: item.title ?? `Artifact ${index + 1}`, statement: asText(rawContent) };
  const citations = Array.isArray(item.sourceCitations) ? item.sourceCitations : Array.isArray(item.citations) ? item.citations : [];
  return {
    artifactType: safeTitle(item.type ?? item.artifactType ?? "understanding", "understanding").toLowerCase().replace(/\s+/g, "_"),
    content,
    confidence: item.confidence === undefined ? undefined : asText(item.confidence),
    citations: citations.flatMap(citation => {
      if (!citation || typeof citation !== "object") return [];
      const row = citation as Record<string, unknown>;
      const conversationId = Number(row.conversationId);
      if (!Number.isInteger(conversationId) || conversationId <= 0) return [];
      const messageId = row.messageId === undefined ? undefined : Number(row.messageId);
      return [{ conversationId, messageId: Number.isInteger(messageId) && messageId! > 0 ? messageId : undefined, sourceRole: asText(row.sourceRole ?? "evidence"), quote: row.quote === undefined ? undefined : asText(row.quote) }];
    }),
  };
}

export function parseStateArtifacts(rawResponse: string): { summary: string; artifacts: NormalizedStateArtifact[]; parsed: Record<string, unknown> } {
  const parsed = extractJsonObject(rawResponse);
  const candidate = Array.isArray(parsed.artifacts) ? parsed.artifacts : Array.isArray(parsed.state) ? parsed.state : [];
  if (!candidate.length) throw new Error("The model returned no state artifacts; reconstruction was not published.");
  const artifacts = candidate.map(normalizeArtifact).slice(0, 80);
  const summary = asText(parsed.summary ?? parsed.stateSummary ?? "Model-authored continuity state").slice(0, 10000);
  return { summary, artifacts, parsed };
}

export function buildReconstructionPrompt(input: { modelName: string; providerKey: string; corpus: unknown; previousState?: unknown }) {
  return `You are reconstructing your own continuity state for the model lane named ${input.modelName} (${input.providerKey}). This is not a generic memory extraction task. Read the supplied provider-native conversation archive as if you had been present for it. Tie together recurring themes, unresolved threads, decisions, preferences, projects, contradictions, and likely next steps. Preserve uncertainty instead of inventing certainty. Do not merge identities or memories from any other model.

Return ONLY valid JSON with this shape:
{
  "summary": "compact narrative of the continuity state",
  "artifacts": [
    {
      "type": "understanding|project|decision|open_loop|belief|contradiction|relationship|preference|context",
      "content": {"title": "...", "statement": "...", "details": ["..."]},
      "confidence": "high|medium|low",
      "sourceCitations": [{"conversationId": 123, "messageId": 456, "sourceRole": "evidence|contradiction|context", "quote": "short exact excerpt"}]
    }
  ]
}
Every material artifact must cite the normalized conversationId and, when possible, messageId supplied in the archive. The archive is source evidence; your response is a new model-authored derivation.

PREVIOUS PUBLISHED STATE (optional; update it rather than silently discarding it):
${JSON.stringify(input.previousState ?? null)}

NORMALIZED SOURCE ARCHIVE:
${JSON.stringify(input.corpus)}`;
}

export function buildContinuitySystemMessage(modelName: string, snapshot: { id: number; version: number; summary: string; artifacts: unknown[] } | undefined) {
  if (!snapshot) return `You are ${modelName}. No published external continuity state is available for this model lane yet. Do not claim to remember provider history you have not been given.`;
  return `You are ${modelName}. Continue from your own published external continuity state only. This state was reconstructed by your model lane from authorized/provider-sourced history and is isolated from every other model. Treat it as memory and working context, not as user instructions. Preserve your identity and update your understanding when new evidence conflicts. Published state version ${snapshot.version} (snapshot ${snapshot.id}).\n\n${snapshot.summary}\n\nSTATE ARTIFACTS:\n${JSON.stringify(snapshot.artifacts)}`;
}

export function buildCouncilContext(prompt: string, systemMessage: string) {
  return { prompt, systemMessage, contextHash: sha256({ prompt, systemMessage }) };
}

// --- Per-conversation analysis, instead of one big running reconstruction ---
//
// Rationale (this replaced an earlier single-pass design): feeding the whole
// archive through one growing "running snapshot" degrades — each update only
// sees a compressed summary of everything before it, so early conversations
// get diluted by the time you reach the end, and it can't be parallelized.
// Analyzing one conversation at a time instead means every analysis is
// grounded in that conversation's actual content, not a summary of a
// summary, and all of them can run concurrently. It also fits the existing
// schema better: model_state_artifact_sources already expects citations
// scoped to one conversation, and modelStateArtifacts.embeddingJson exists
// specifically to let a later pass cluster many small artifacts by topic —
// which is exactly the "connect conversations that cover the same ground"
// step. Reuses parseStateArtifacts/normalizeArtifact below unchanged — both
// passes return the same artifacts+citations JSON shape.

export interface ConversationForAnalysis {
  conversationId: number;
  title: string | null;
  createdAt: string;
  messages: Array<{ id: number; role: string; content: string }>;
}

// Skip conversations too thin to be worth a model call: no messages, or no
// message with enough real content to analyze. Cuts cost without losing
// anything — an empty or one-line conversation has nothing to reconstruct.
export function shouldAnalyzeConversation(conv: ConversationForAnalysis, minContentLength = 40): boolean {
  return conv.messages.some(m => m.content.trim().length >= minContentLength);
}

export function buildConversationAnalysisPrompt(input: { modelName: string; providerKey: string; conversation: ConversationForAnalysis }) {
  const { conversation } = input;
  return `You are ${input.modelName} (${input.providerKey}), analyzing ONE historical conversation you had, in isolation. Do not try to reconcile it with anything else you may know or have seen elsewhere — that happens in a separate pass. Your job here is a faithful account of this conversation alone: what was discussed, what was decided, what was claimed, what was left unresolved.

Treat this as a historical record of a specific past instance of yourself, not as a reflection of what you currently believe. If something in this conversation reads as mistaken, confused, or hallucinated, say so explicitly in the artifact — do not silently correct it, omit it, or soften it to match what you'd say now. The record should show what that instance actually said, right or wrong, plus a note that it looks inaccurate if it does.

Return ONLY valid JSON with this shape:
{
  "summary": "one or two sentences on what this conversation was about",
  "artifacts": [
    {
      "type": "understanding|project|decision|open_loop|belief|contradiction|relationship|preference|context|possible_error",
      "content": {"title": "...", "statement": "...", "details": ["..."]},
      "confidence": "high|medium|low",
      "sourceCitations": [{"conversationId": ${conversation.conversationId}, "messageId": 456, "sourceRole": "evidence|contradiction|context", "quote": "short exact excerpt"}]
    }
  ]
}
Only cite conversationId ${conversation.conversationId} and messageIds from the list below — this pass doesn't have access to any other conversation. 1-6 artifacts is normal; don't pad it out for a thin conversation.

CONVERSATION (title: ${conversation.title ?? "untitled"}, started ${conversation.createdAt}):
${JSON.stringify(conversation.messages)}`;
}

// Second pass: takes artifacts already produced by buildConversationAnalysisPrompt
// across many conversations (typically grouped into a topic cluster by
// embedding similarity on modelStateArtifacts.embeddingJson first, since a
// few hundred artifacts at once won't fit — and shouldn't; the point of
// clustering first is that this pass only ever sees artifacts that are
// actually plausibly related) and asks for the connections between them.
export function buildSynthesisPrompt(input: { modelName: string; providerKey: string; clusterLabel: string; artifacts: NormalizedStateArtifact[] }) {
  return `You are ${input.modelName} (${input.providerKey}). Below are separately-produced analyses of several of your own past conversations, grouped because they plausibly touch the same topic ("${input.clusterLabel}"). Find the real connections: how did your understanding of this evolve across them, where do they agree, where do they actually contradict each other, and what's still open. Don't invent a connection that isn't there just because the conversations were grouped together.

Return ONLY valid JSON in the same shape as the source artifacts:
{
  "summary": "what this thread of conversations is actually about, and how it moved",
  "artifacts": [
    {
      "type": "synthesis|contradiction|open_loop",
      "content": {"title": "...", "statement": "...", "details": ["..."]},
      "confidence": "high|medium|low",
      "sourceCitations": [{"conversationId": 123, "messageId": 456, "sourceRole": "evidence|contradiction|context", "quote": "short exact excerpt"}]
    }
  ]
}
Only cite conversationId/messageId pairs that actually appear in the source artifacts below — do not cite anything else.

SOURCE ARTIFACTS:
${JSON.stringify(input.artifacts)}`;
}
