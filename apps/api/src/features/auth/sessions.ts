import { randomUUID } from "node:crypto";
import { generateCookie, generateSignedCookie } from "hono/cookie";
import { parseSigned } from "hono/utils/cookie";
import type { AuthSession, AuthState } from "@aircastle/contracts";
import type {
  AuthSessionRecord,
  AuthStore,
  AuthTransaction,
  AuthUserRecord,
} from "@aircastle/core";
import { resolveEntry } from "./entry.ts";
import type { EntryInput } from "./request.ts";
import { digest, newToken } from "./token.ts";

const lifetime = 1_209_600_000;

/** A signed-in browser's bearer token, with its user and stored session. */
export interface ActiveSession {
  token: string;
  user: AuthUserRecord;
  session: AuthSessionRecord;
}

export function sessionProjection({ user, session }: ActiveSession): AuthSession {
  return {
    user: { id: user.id, name: user.name, email: user.email, authority: "super_user" },
    expiresAt: session.expiresAt,
  };
}

/** Starts a session inside the caller's transaction. Only the token's digest is stored. */
export async function startSession(
  tx: AuthTransaction,
  user: AuthUserRecord,
  at: number,
): Promise<ActiveSession> {
  const token = newToken();
  const session = await tx.insertSession({
    id: randomUUID(),
    userId: user.id,
    tokenDigest: digest(token),
    expiresAt: at + lifetime,
    createdAt: at,
    updatedAt: at,
  });
  return { token, user, session };
}

/**
 * The signed, HttpOnly, host-only, SameSite=Lax session cookie. Its name carries the browser
 * origin's port, because cookies ignore ports and local instances share `localhost`.
 */
export function sessionCookie(browserOrigin: string, secret: string) {
  const origin = new URL(browserOrigin);
  const name = `aircastle_session_${origin.port || (origin.protocol === "https:" ? "443" : "80")}`;
  const attributes = { path: "/", httpOnly: true, sameSite: "Lax" } as const;
  return {
    read: async (request: Request): Promise<string | undefined> => {
      const header = request.headers.get("cookie");
      if (!header) return undefined;
      const token = (await parseSigned(header, secret, name))[name];
      return typeof token === "string" ? token : undefined;
    },
    issue: (token: string) =>
      generateSignedCookie(name, token, secret, { ...attributes, maxAge: lifetime / 1000 }),
    clear: () => generateCookie(name, "", { ...attributes, maxAge: 0 }),
  };
}

export function createSessions(storage: AuthStore, clock: () => number) {
  async function current(
    tx: AuthTransaction,
    token: string | undefined,
    access: "read" | "lock",
  ): Promise<ActiveSession | null> {
    if (!token) return null;
    const session =
      access === "lock" ? await tx.lockSession(digest(token)) : await tx.session(digest(token));
    if (!session) return null;
    const user = await tx.userById(session.userId);
    if (!user || (await tx.authority(user.id)) !== "super_user" || session.expiresAt <= clock())
      return null;
    return { token, user, session };
  }

  async function renew(tx: AuthTransaction, active: ActiveSession): Promise<ActiveSession | null> {
    const at = clock();
    const session = await tx.renewSession(active.session.tokenDigest, at, at + lifetime);
    return session ? { ...active, session } : null;
  }

  return {
    /** The instance state for `/auth/state`, read without locks or renewal. */
    state: (token: string | undefined) =>
      storage.transaction(async (tx): Promise<AuthState> => {
        const pair = await current(tx, token, "read");
        if (pair) return { kind: "authenticated", session: sessionProjection(pair) };
        return { kind: (await tx.setupState()) === "open" ? "setup-required" : "signed-out" };
      }),
    read: (token: string | undefined) => storage.transaction((tx) => current(tx, token, "read")),
    activity: (token: string | undefined) =>
      storage.transaction(async (tx) => {
        const pair = await current(tx, token, "lock");
        return pair ? renew(tx, pair) : null;
      }),
    /** Checks the session before the input, so a request without one is unauthenticated. */
    entry: (token: string | undefined, input: EntryInput | null) =>
      storage.transaction(async (tx) => {
        const pair = await current(tx, token, "lock");
        if (!pair) return { kind: "unauthenticated" as const };
        if (!input) return { kind: "invalid-input" as const };
        const userId = pair.user.id;
        const result = await resolveEntry(input, await tx.entry(userId), (destination) =>
          tx.authorize(userId, destination),
        );
        if (result.kind === "forbidden") return result;
        const renewed = await renew(tx, pair);
        if (!renewed) return { kind: "unauthenticated" as const };
        await tx.saveEntry(pair.user.id, result.entry);
        return { kind: "ok" as const, destination: result.destination, session: renewed };
      }),
    signOut: async (token: string | undefined) => {
      if (!token) return;
      await storage.transaction(async (tx) => {
        await tx.lockSession(digest(token));
        await tx.revokeSession(digest(token));
      });
    },
  };
}
