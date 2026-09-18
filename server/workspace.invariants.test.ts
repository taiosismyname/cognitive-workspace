import { describe, expect, it } from "vitest";
import { councilResults, memories } from "../drizzle/schema";

describe("workspace persistence invariants", () => {
  it("keeps memory provenance fields mandatory in the Drizzle model", () => {
    expect(memories.sourceConversationId.notNull).toBe(true);
    expect(memories.sourceMessageId.notNull).toBe(true);
    expect(memories.modelRegistryId.notNull).toBe(true);
  });

  it("exposes explicit retrieval eligibility for derived memories", () => {
    expect(memories.isRetrievalEligible).toBeDefined();
  });

  it("keeps council results auditable beyond normalized text", () => {
    expect(councilResults.rawProviderPayload).toBeDefined();
    expect(councilResults.normalizedResult).toBeDefined();
    expect(councilResults.providerRequestId).toBeDefined();
    expect(councilResults.latencyMs).toBeDefined();
  });
});
