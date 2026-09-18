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
