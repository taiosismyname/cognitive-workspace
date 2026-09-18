import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildConversationAnalysisPrompt, parseStateArtifacts } from "./continuity";

// These tests never touch the real network and never need a real API key —
// global.fetch is replaced with a mock in every test. ENV.openRouterApiKey is
// computed once, at module-evaluation time, from process.env — so changing
// process.env after the fact does nothing unless the module is re-imported
// fresh. vi.resetModules() + a dynamic import() in each test is what makes
// the env change actually take effect; a static top-of-file import would
// silently test against whatever ENV was on the very first import.

describe("OpenRouter adapter — mocked HTTP", () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    vi.resetModules();
    process.env.OPENROUTER_API_KEY = "test-key-not-real";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.OPENROUTER_API_KEY = originalKey;
    vi.resetModules();
  });

  it("sends the expected URL, method, auth header, and body for a chat completion", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "gen-1", choices: [{ message: { content: "hello back" } }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { getAdapter } = await import("./adapters");
    const result = await getAdapter("openrouter").complete({ modelKey: "anthropic/claude-3.5", messages: [{ role: "user", content: "hi" }] });

    expect(result).toMatchObject({ text: "hello back", requestId: "gen-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer test-key-not-real");
    expect(JSON.parse(options.body)).toEqual({ model: "anthropic/claude-3.5", messages: [{ role: "user", content: "hi" }] });
  });

  it("throws a clear error instead of returning empty text", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: {} }] }) }) as unknown as typeof fetch;
    const { getAdapter } = await import("./adapters");
    await expect(getAdapter("openrouter").complete({ modelKey: "x", messages: [] })).rejects.toThrow(/no text content/i);
  });

  it("surfaces OpenRouter's own error message on a non-ok response, e.g. insufficient credits", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 402, json: async () => ({ error: { message: "Insufficient credits" } }) }) as unknown as typeof fetch;
    const { getAdapter } = await import("./adapters");
    await expect(getAdapter("openrouter").complete({ modelKey: "x", messages: [] })).rejects.toThrow("Insufficient credits");
  });

  it("refuses to call out at all when no key is configured — fetch is never invoked", async () => {
    vi.resetModules();
    process.env.OPENROUTER_API_KEY = "";
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { getAdapter, ProviderUnavailableError } = await import("./adapters");
    await expect(getAdapter("openrouter").complete({ modelKey: "x", messages: [] })).rejects.toBeInstanceOf(ProviderUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests and parses an embedding vector", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }) }) as unknown as typeof fetch;
    const { getAdapter } = await import("./adapters");
    const vector = await getAdapter("openrouter").embed({ modelKey: "text-embedding-3-small", input: "test" });
    expect(vector).toEqual([0.1, 0.2, 0.3]);
  });

  it("runs the full pipeline — build prompt, call the (mocked) model, parse the response — end to end", async () => {
    const conversation = {
      conversationId: 42,
      title: "provenance design",
      createdAt: "2025-01-01",
      messages: [{ id: 100, role: "user", content: "Every claim needs to cite the message it came from." }],
    };
    const prompt = buildConversationAnalysisPrompt({ modelName: "Lane A", providerKey: "claude", conversation });

    const mockModelReply = JSON.stringify({
      summary: "Discussed requiring citations for every claim.",
      artifacts: [{ type: "decision", content: { title: "Require citations" }, confidence: "high", sourceCitations: [{ conversationId: 42, messageId: 100, quote: "cite the message" }] }],
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "gen-2", choices: [{ message: { content: mockModelReply } }] }),
    }) as unknown as typeof fetch;

    const { getAdapter } = await import("./adapters");
    const response = await getAdapter("openrouter").complete({ modelKey: "anthropic/claude-3.5", messages: [{ role: "user", content: prompt }] });
    const { artifacts } = parseStateArtifacts(response.text);

    expect(artifacts[0]?.artifactType).toBe("decision");
    expect(artifacts[0]?.citations[0]).toMatchObject({ conversationId: 42, messageId: 100 });
  });
});
