import { randomUUID } from "node:crypto";
import postgres from "postgres";
import pino from "pino";
import type { Logger } from "pino";
import {
  postgresAdapter,
  postgresAuthAdmission,
  postgresAuthStore,
} from "@aircastle/adapter-postgres";
import { createAircastle } from "@aircastle/core";
import type { AuthLimits, AuthStore, ProtectedDestination } from "@aircastle/core";
import { expect } from "vite-plus/test";
import { cmsErrorReporter, createApp } from "../../../app.ts";
import { createDevelopmentInbox } from "../../development-inbox/index.ts";
import type { DevelopmentInbox, EmailMessage } from "../../development-inbox/index.ts";
import { authErrorReporter, createAuthEventLogger, createLocalAuth } from "../index.ts";
import type { AuthEvent, LocalAuthRuntime } from "../index.ts";

export const start = Date.UTC(2026, 0, 1);
export const browserOrigin = "http://localhost:43121";
export const limits = {
  email: { fiveMinutes: 1_000, oneHour: 1_000 },
  ip: { fiveMinutes: 1_000, oneHour: 1_000 },
  global: { fiveMinutes: 1_000, oneHour: 1_000 },
};

export async function withAuth(
  run: (fixture: AuthFixture) => Promise<void>,
  options: {
    limits?: AuthLimits;
    logger?: Logger;
    maxRequestBytes?: number;
    /** Wraps each runtime's store, for tests that observe or fault storage. */
    storage?: (store: AuthStore) => AuthStore;
    /** Wraps each runtime's inbox, for tests that observe or fault message capture. */
    inbox?: (inbox: DevelopmentInbox) => DevelopmentInbox;
    browserOrigin?: string;
  } = {},
) {
  const origin = options.browserOrigin ?? browserOrigin;
  const url = process.env.AIRCASTLE_DATABASE_URL;
  if (!url) throw new Error("Run through vp run db:test");
  const namespace = `auth_${randomUUID().replaceAll("-", "")}`;
  const sql = postgres(url, { max: 5, onnotice: () => {} });
  const content = postgresAdapter({ url, namespace });
  const runtimes: LocalAuthRuntime[] = [];
  const stores: AuthStore[] = [];
  let now = start;
  const events: AuthEvent[] = [];
  const logs: string[] = [];
  const logger = options.logger ?? pino({ level: "info" }, { write: (line) => logs.push(line) });
  const logAuthEvent = createAuthEventLogger(logger);
  try {
    const cms = await createAircastle({ database: content, report: cmsErrorReporter(logger) });
    expect((await sql`SELECT 1 AS connected`)[0]?.connected).toBe(1);
    const open = async (initialEmail?: string, storageUrl = url) => {
      const storage = await postgresAuthStore({ url: storageUrl, namespace });
      stores.push(storage);
      const admission = await postgresAuthAdmission({
        url,
        namespace,
        limits: options.limits ?? limits,
        clock: () => now,
      });
      const inbox = createDevelopmentInbox();
      const auth = await createLocalAuth({
        config: {
          mode: "development",
          browserOrigin: origin,
          limits: options.limits ?? limits,
          ...(initialEmail === undefined ? {} : { initialEmail }),
        },
        storage: options.storage?.(storage) ?? storage,
        admission,
        clock: () => now,
        inbox: options.inbox?.(inbox) ?? inbox,
        emit: (event) => {
          events.push(event);
          logAuthEvent(event);
        },
        report: authErrorReporter(logger),
      });
      runtimes.push({
        handle: (request, peer) => auth.handle(request, peer),
        close: async () => {
          await auth.close();
          await admission.close();
        },
      });
      const app = createApp({
        logger,
        cms,
        auth,
        ...(options.maxRequestBytes === undefined
          ? {}
          : { maxRequestBytes: options.maxRequestBytes }),
      });
      const request = async (
        path: string,
        body?: unknown,
        cookie?: string,
        headers: RequestInit["headers"] = {},
        peerAddress = "127.0.0.1",
      ) => {
        const supplied = new Headers(headers);
        if (!supplied.has("host")) supplied.set("host", new URL(origin).host);
        if (!supplied.has("origin")) supplied.set("origin", origin);
        if (cookie) supplied.set("cookie", cookie);
        if (body !== undefined) supplied.set("content-type", "application/json");
        return app.request(
          `${origin}/api${path}`,
          {
            method: body === undefined ? "GET" : "POST",
            headers: supplied,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          },
          { peerAddress },
        );
      };
      return { request, inbox, storage, app, auth, origin };
    };
    await run({
      sql,
      namespace,
      url,
      content,
      cms,
      open,
      events,
      logs,
      at: (milliseconds) => {
        now = start + milliseconds;
      },
    });
  } finally {
    await Promise.allSettled(runtimes.map((runtime) => runtime.close()));
    await Promise.allSettled(stores.map((store) => store.close()));
    await content.close();
    await sql`DROP SCHEMA IF EXISTS ${sql(namespace)} CASCADE`;
    await sql.end();
  }
}

export interface AuthFixture {
  sql: ReturnType<typeof postgres>;
  namespace: string;
  url: string;
  content: ReturnType<typeof postgresAdapter>;
  cms: Awaited<ReturnType<typeof createAircastle>>;
  open: (
    initialEmail?: string,
    storageUrl?: string,
  ) => Promise<{
    request: (
      path: string,
      body?: unknown,
      cookie?: string,
      headers?: RequestInit["headers"],
      peerAddress?: string,
    ) => Promise<Response>;
    inbox: DevelopmentInbox;
    storage: AuthStore;
    app: ReturnType<typeof createApp>;
    auth: LocalAuthRuntime;
    /** The browser origin this runtime serves. */
    origin: string;
  }>;
  events: AuthEvent[];
  logs: string[];
  at: (milliseconds: number) => void;
}

export type AuthServer = Awaited<ReturnType<AuthFixture["open"]>>;

/** The link a captured email carries, and the token in it. */
export function readCapturedLink(message: EmailMessage) {
  const link = message.text.match(/https?:\/\/[^\s<>]+/u)?.[0];
  expect(link).toBeDefined();
  if (!link) throw new Error("Captured email must contain the actionable link");
  const token = new URL(link).searchParams.get("token");
  expect(token).toBeTruthy();
  if (!token) throw new Error("Captured link must contain a token");
  return { link, token };
}

/**
 * Requests a link that must be issued, and reads it from the one message the request published.
 * Issuance sets no cookie, and the message goes to the normalized email with the purpose's
 * subject and a link to the purpose's page on the browser origin.
 */
async function issueLink(
  server: AuthServer,
  purpose: "setup" | "sign-in",
  body: { email: string; name?: string; returnTo?: ProtectedDestination },
) {
  const before = new Set(server.inbox.list().map(({ mail }) => mail.messageId));
  const response = await server.request(`/auth/${purpose}`, body);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    kind: "ok",
    value: { confirmation: purpose === "setup" ? "setup-inbox" : "sign-in-inbox" },
  });
  expect(response.headers.get("set-cookie")).toBeNull();
  const published = server.inbox.list().filter(({ mail }) => !before.has(mail.messageId));
  expect(published).toHaveLength(1);
  const message = published[0]?.mail;
  if (!message) throw new Error("Successful issuance must publish a readable email");
  expect(message.to).toEqual([body.email.trim().toLowerCase()]);
  expect(message.subject).toBe(
    purpose === "setup" ? "Create your Aircastle account" : "Sign in to Aircastle",
  );
  const { link, token } = readCapturedLink(message);
  const url = new URL(link);
  expect(url.origin).toBe(new URL(server.origin).origin);
  expect(url.pathname).toBe(`/${purpose}`);
  return { purpose, token, link, message, response };
}

export function issueSetupLink(
  server: AuthServer,
  input: { name?: string; email?: string; returnTo?: ProtectedDestination } = {},
) {
  const { name = "Alex", email = "alex@example.test", returnTo } = input;
  return issueLink(server, "setup", {
    name,
    email,
    ...(returnTo === undefined ? {} : { returnTo }),
  });
}

export function issueSignInLink(
  server: AuthServer,
  input: { email?: string; returnTo?: ProtectedDestination } = {},
) {
  const { email = "alex@example.test", returnTo } = input;
  return issueLink(server, "sign-in", { email, ...(returnTo === undefined ? {} : { returnTo }) });
}

/** The session cookie a successful confirmation sets, as a `name=value` pair. */
export function confirmedCookie(response: Response) {
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toBeTruthy();
  if (!cookie) throw new Error("Successful confirmation must establish a browser session");
  return cookie;
}

export async function claim(server: AuthServer) {
  const link = await issueSetupLink(server);
  const response = await server.request("/auth/confirm", {
    purpose: link.purpose,
    token: link.token,
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    kind: "ok",
    value: { destination: { kind: "dashboard" } },
  });
  const setCookie = response.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  if (!setCookie) throw new Error("Successful confirmation must set a browser cookie");
  return { cookie: confirmedCookie(response), setCookie, link };
}

export async function signIn(server: AuthServer, email = "alex@example.test") {
  const { token } = await issueSignInLink(server, { email });
  const response = await server.request("/auth/confirm", { purpose: "sign-in", token });
  expect(response.status).toBe(200);
  return { cookie: confirmedCookie(response), token };
}

/** User and session counts read straight from the namespace's tables. */
export async function credentialCounts(sql: AuthFixture["sql"], namespace: string) {
  const [counts] = await sql<{ users: number; sessions: number }[]>`
    SELECT
      (SELECT count(*)::integer FROM ${sql(namespace)}.auth_users) AS users,
      (SELECT count(*)::integer FROM ${sql(namespace)}.auth_sessions) AS sessions`;
  if (!counts) throw new Error("Independent durable credential counts must return a row");
  return counts;
}

/** Issues a link for a purpose and returns the body that redeems it. */
export async function pendingLink(
  server: AuthServer,
  purpose: "setup" | "sign-in",
  returnTo?: ProtectedDestination,
) {
  const input = returnTo === undefined ? {} : { returnTo };
  const { token } =
    purpose === "setup"
      ? await issueSetupLink(server, input)
      : await issueSignInLink(server, input);
  return { purpose, token };
}
