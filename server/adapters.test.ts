import { describe, expect, it } from "vitest";
import { cosineSimilarity, getAdapter, ProviderUnavailableError } from "./adapters";

describe("provider adapters", () => {
  it("returns a real OpenRouter adapter for the registered provider", () => {
    expect(getAdapter("openrouter").providerKey).toBe("openrouter");
  });

  it("makes unavailable providers explicit", () => {
    expect(() => getAdapter("anthropic-direct")).toThrow(ProviderUnavailableError);
  });
});

describe("semantic retrieval math", () => {
  it("ranks identical vectors at one", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBe(1);
  });

  it("returns zero for incompatible vectors", () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
  });
});

describe("nvidia adapter", () => {
  it("is registered as a real provider", () => {
    expect(getAdapter("nvidia").providerKey).toBe("nvidia");
  });

  it("fails with a clear configuration error when no key is set", async () => {
    const previous = process.env.NVIDIA_API_KEY;
    delete process.env.NVIDIA_API_KEY;
    const adapter = getAdapter("nvidia");
    await expect(adapter.complete({ modelKey: "any", messages: [{ role: "user", content: "hi" }] }))
      .rejects.toThrow(/NVIDIA is not configured/);
    await expect(adapter.listModels()).rejects.toThrow(/NVIDIA is not configured/);
    if (previous !== undefined) process.env.NVIDIA_API_KEY = previous;
  });

  it("never leaks the key into an error message", async () => {
    const previous = process.env.NVIDIA_API_KEY;
    process.env.NVIDIA_API_KEY = "nvapi-secret-value-should-never-appear";
    try {
      // Point at an invalid model so the request fails upstream; the thrown
      // message must not contain the credential.
      const adapter = getAdapter("nvidia");
      await adapter.complete({ modelKey: "\u0000invalid-model-name", messages: [{ role: "user", content: "hi" }] })
        .catch((error: Error) => {
          expect(error.message).not.toContain("nvapi-secret-value-should-never-appear");
        });
    } finally {
      if (previous === undefined) delete process.env.NVIDIA_API_KEY;
      else process.env.NVIDIA_API_KEY = previous;
    }
  });
});
