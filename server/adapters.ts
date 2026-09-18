import { ENV } from "./_core/env";

export type AdapterStatus = "active" | "unimplemented" | "disabled";

export type ProviderModel = {
  providerKey: string;
  modelKey: string;
  displayName: string;
  adapterStatus: AdapterStatus;
  capabilities: Record<string, unknown>;
  notes?: string;
};

export type ChatTurn = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ProviderResponse = {
  text: string;
  requestId?: string;
  raw?: unknown;
};

export interface ModelProviderAdapter {
  readonly providerKey: string;
  listModels(): Promise<ProviderModel[]>;
  complete(input: { modelKey: string; messages: ChatTurn[] }): Promise<ProviderResponse>;
  embed(input: { modelKey: string; input: string }): Promise<number[]>;
}

export class ProviderUnavailableError extends Error {
  constructor(public readonly providerKey: string, message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

function requireOpenRouterKey() {
  if (!ENV.openRouterApiKey) {
    throw new ProviderUnavailableError("openrouter", "OpenRouter is not configured. Add OPENROUTER_API_KEY to enable live calls.");
  }
  return ENV.openRouterApiKey;
}

async function openRouterRequest(path: string, body?: unknown) {
  const key = requireOpenRouterKey();
  const response = await fetch(`https://openrouter.ai/api/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://cognitive-workspace.manus.space",
      "X-Title": "Cognitive Workspace",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error?.message === "string" ? payload.error.message : `OpenRouter request failed with ${response.status}`;
    throw new Error(message);
  }
  return payload as Record<string, any>;
}

export class OpenRouterAdapter implements ModelProviderAdapter {
  readonly providerKey = "openrouter";

  async listModels(): Promise<ProviderModel[]> {
    const payload = await openRouterRequest("models");
    return (payload.data ?? []).map((model: any) => ({
      providerKey: this.providerKey,
      modelKey: String(model.id),
      displayName: String(model.name ?? model.id),
      adapterStatus: "active" as const,
      capabilities: {
        contextLength: model.context_length,
        inputModalities: model.architecture?.input_modalities,
        outputModalities: model.architecture?.output_modalities,
        pricing: model.pricing,
      },
      notes: "Live model metadata from OpenRouter.",
    }));
  }

  async complete(input: { modelKey: string; messages: ChatTurn[] }): Promise<ProviderResponse> {
    const payload = await openRouterRequest("chat/completions", {
      model: input.modelKey,
      messages: input.messages,
    });
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("OpenRouter returned no text content.");
    }
    return { text: content, requestId: payload.id, raw: payload };
  }

  async embed(input: { modelKey: string; input: string }): Promise<number[]> {
    const payload = await openRouterRequest("embeddings", {
      model: input.modelKey,
      input: input.input,
    });
    const embedding = payload.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error("OpenRouter returned no embedding vector.");
    }
    return embedding.map(Number);
  }
}

export const unimplementedProviders: ProviderModel[] = [
  {
    providerKey: "anthropic-direct",
    modelKey: "*",
    displayName: "Anthropic direct",
    adapterStatus: "unimplemented",
    capabilities: {},
    notes: "Adapter boundary reserved; no direct Anthropic integration is implemented in this release.",
  },
  {
    providerKey: "google-direct",
    modelKey: "*",
    displayName: "Google direct",
    adapterStatus: "unimplemented",
    capabilities: {},
    notes: "Adapter boundary reserved; no direct Google integration is implemented in this release.",
  },
];

const adapters: Record<string, ModelProviderAdapter> = {
  openrouter: new OpenRouterAdapter(),
};

export function getAdapter(providerKey: string): ModelProviderAdapter {
  const adapter = adapters[providerKey];
  if (!adapter) {
    throw new ProviderUnavailableError(providerKey, `The ${providerKey} adapter is explicitly unimplemented.`);
  }
  return adapter;
}

export function cosineSimilarity(a: number[], b: number[]) {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
}
