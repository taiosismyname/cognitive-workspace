import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { credentialsSchema, signupSchema } from "./localAuth";

describe("local auth input validation", () => {
  it("accepts a valid login payload and normalizes the email", () => {
    const parsed = credentialsSchema.parse({ email: "  Tai@Example.com ", password: "longenough" });
    expect(parsed.email).toBe("tai@example.com");
  });

  it("rejects a password under 8 characters", () => {
    expect(credentialsSchema.safeParse({ email: "a@b.com", password: "short" }).success).toBe(false);
  });

  it("rejects a malformed email", () => {
    expect(credentialsSchema.safeParse({ email: "not-an-email", password: "longenough" }).success).toBe(false);
  });

  it("makes name optional on signup but validates it when present", () => {
    expect(signupSchema.safeParse({ email: "a@b.com", password: "longenough" }).success).toBe(true);
    expect(signupSchema.safeParse({ email: "a@b.com", password: "longenough", name: "" }).success).toBe(false);
  });
});

describe("password hashing", () => {
  it("round-trips: a hash verifies against its own plaintext", async () => {
    const hash = await bcrypt.hash("correct horse battery staple", 12);
    expect(await bcrypt.compare("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects the wrong password against a real hash", async () => {
    const hash = await bcrypt.hash("correct horse battery staple", 12);
    expect(await bcrypt.compare("wrong password", hash)).toBe(false);
  });

  it("never stores the plaintext password in the hash output", async () => {
    const hash = await bcrypt.hash("correct horse battery staple", 12);
    expect(hash).not.toContain("correct horse battery staple");
  });
});
