import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import { sdk } from "./sdk";

// Replaces server/_core/oauth.ts for a standalone deployment. Manus's
// per-request session check (sdk.authenticateRequest, used by every
// protectedProcedure via context.ts) only ever verifies a locally-signed JWT
// and looks the user up in our own database — it doesn't call out to Manus
// unless the openId isn't found locally. So the only thing that actually
// needs replacing is how a session gets minted in the first place; this
// reuses sdk.signSession so the cookie it issues is verified by the exact
// same code path oauth.ts's sessions were.

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const signupSchema = credentialsSchema.extend({
  name: z.string().trim().min(1).max(255).optional(),
});

async function issueSession(res: Response, req: Request, user: { openId: string; name: string | null }) {
  const token = await sdk.signSession({ openId: user.openId, appId: ENV.appId, name: user.name ?? "" }, { expiresInMs: ONE_YEAR_MS });
  res.cookie(COOKIE_NAME, token, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
}

export function registerLocalAuthRoutes(app: Express) {
  app.post("/api/auth/signup", async (req: Request, res: Response) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid signup" });
      return;
    }
    const { email, password, name } = parsed.data;

    const existing = await db.getUserByEmail(email);
    if (existing) {
      res.status(409).json({ error: "An account with that email already exists" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await db.createLocalUser({ openId: randomUUID(), email, name: name ?? email.split("@")[0], passwordHash });
    if (!user) {
      res.status(503).json({ error: "Database unavailable" });
      return;
    }

    await issueSession(res, req, user);
    res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name } });
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const parsed = credentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid login" });
      return;
    }
    const { email, password } = parsed.data;

    const user = await db.getUserByEmail(email);
    // Deliberately identical error for "no such user" and "wrong password" —
    // distinguishing them lets an attacker enumerate registered emails.
    const invalid = () => res.status(401).json({ error: "Invalid email or password" });
    if (!user || !user.passwordHash) {
      invalid();
      return;
    }
    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      invalid();
      return;
    }

    await db.upsertUser({ openId: user.openId, lastSignedIn: new Date() });
    await issueSession(res, req, user);
    res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name } });
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(req), path: "/" });
    res.json({ ok: true });
  });
}
