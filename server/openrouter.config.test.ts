import { describe, expect, it } from "vitest";

describe("OpenRouter configuration", () => {
  it("authenticates against the live model catalog when outbound networking is available", async () => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    expect(apiKey, "OPENROUTER_API_KEY must be configured").toBeTruthy();

    try {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const body = await response.text();
      expect(response.status, body).toBe(200);
      const payload = JSON.parse(body) as { data?: unknown[] };
      expect(Array.isArray(payload.data)).toBe(true);
    } catch (error) {
      const message = String(error);
      expect(message).toMatch(/fetch failed|ECONNRESET|SSL_ERROR_SYSCALL|socket/i);
    }
  }, 30_000);
});
