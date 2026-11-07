import { AuthStorageError } from "@aircastle/core";
import { createDevelopmentInbox } from "../development-inbox/index.ts";
import { createCredentials } from "./credentials.ts";
import { boundedEvents, storageUnavailable } from "./diagnostics.ts";
import { createSessions, sessionCookie, sessionProjection } from "./sessions.ts";
import { jsonBody, parseAccount, parseEntry, parseLink } from "./request.ts";
import { failed, succeeded } from "./responses.ts";
import type { LocalAuthOptions, LocalAuthRuntime } from "./index.ts";

const openMessageRoute = "/api/development-inbox/messages/:id/open";

/** Every method and path the development runtime answers. Anything else is 404 before the Host and Origin checks. */
export const dispatched = [
  { method: "GET", path: "/api/auth/state" },
  { method: "GET", path: "/api/auth/session" },
  { method: "GET", path: "/api/development-inbox/messages" },
  { method: "POST", path: "/api/auth/setup" },
  { method: "POST", path: "/api/auth/sign-in" },
  { method: "POST", path: "/api/auth/confirm" },
  { method: "POST", path: "/api/auth/confirm/preview" },
  { method: "POST", path: "/api/auth/sign-out" },
  { method: "POST", path: "/api/auth/activity" },
  { method: "POST", path: "/api/auth/entry" },
  { method: "POST", path: openMessageRoute },
] as const;

export async function developmentAuth(
  options: Extract<LocalAuthOptions, { storage: unknown }>,
): Promise<LocalAuthRuntime> {
  const { storage, admission, config } = options;
  const clock = options.clock ?? Date.now;
  const emit = boundedEvents((event) => options.emit(event), clock);
  const inbox = options.inbox ?? createDevelopmentInbox();
  const credentials = createCredentials({
    storage,
    inbox,
    clock,
    emit,
    report: options.report,
    origin: config.browserOrigin,
    ...(config.initialEmail === undefined ? {} : { initialEmail: config.initialEmail }),
  });
  const sessions = createSessions(storage, clock);
  const cookie = sessionCookie(config.browserOrigin, await storage.signingSecret());
  const origin = new URL(config.browserOrigin);

  async function respond(
    request: Request,
    path: string,
    peer: { address: string | undefined },
    openMessage: string | undefined,
  ): Promise<Response> {
    if (path === "/api/development-inbox/messages") return succeeded(inbox.list());
    if (openMessage !== undefined) {
      let messageId: string;
      try {
        messageId = decodeURIComponent(openMessage);
      } catch (error) {
        if (!(error instanceof URIError)) throw error;
        return failed({ kind: "not-found" });
      }
      const entry = inbox.open(messageId);
      return entry ? succeeded(entry) : failed({ kind: "not-found" });
    }
    const token = await cookie.read(request);
    if (path === "/api/auth/state") return succeeded(await sessions.state(token));
    if (path === "/api/auth/session") {
      const active = await sessions.read(token);
      return active ? succeeded(sessionProjection(active)) : failed({ kind: "unauthenticated" });
    }
    if (path === "/api/auth/sign-out") {
      await sessions.signOut(token);
      return succeeded({ destination: "/sign-in" }, { "Set-Cookie": cookie.clear() });
    }
    if (path === "/api/auth/activity") {
      const active = await sessions.activity(token);
      if (!active) return failed({ kind: "unauthenticated" });
      return succeeded(sessionProjection(active), {
        "Set-Cookie": await cookie.issue(active.token),
      });
    }
    const body = await jsonBody(request);
    if (path === "/api/auth/entry") {
      const result = await sessions.entry(token, parseEntry(body));
      if (result.kind !== "ok") return failed(result);
      return succeeded(
        { destination: result.destination, session: sessionProjection(result.session) },
        { "Set-Cookie": await cookie.issue(result.session.token) },
      );
    }
    if (path === "/api/auth/confirm") {
      const result = await credentials.confirm(parseLink(body));
      if (result.kind === "failure") return failed(result.failure);
      return succeeded(
        { destination: result.destination },
        { "Set-Cookie": await cookie.issue(result.token) },
      );
    }
    if (path === "/api/auth/confirm/preview") {
      const result = await credentials.preview(parseLink(body));
      if (result.kind === "failure") return failed(result.failure);
      return succeeded({ email: result.email, purpose: result.purpose });
    }
    if (!peer.address) return failed({ kind: "forbidden" });
    const purpose = path === "/api/auth/setup" ? "setup" : "sign-in";
    const parsed = parseAccount(body, purpose);
    const admitted = await admission.admit({
      source: peer.address,
      ...(parsed.kind === "valid" ? { email: parsed.value.email } : {}),
    });
    if (admitted.kind === "throttled") {
      emit({ kind: "request-blocked", scopes: admitted.scopes });
      return failed(
        { kind: "throttled", retryAt: admitted.retryAt },
        {
          "Retry-After": String(Math.max(0, Math.ceil((admitted.retryAt - clock()) / 1000))),
        },
      );
    }
    if (parsed.kind === "invalid-input") return failed(parsed);
    const result = await credentials.issue(parsed.value);
    if (result.kind !== "issued") return failed(result);
    return succeeded({ confirmation: purpose === "setup" ? "setup-inbox" : "sign-in-inbox" });
  }

  return {
    handle: async (request, peer) => {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;
      const openMessage =
        method === "POST"
          ? /^\/api\/development-inbox\/messages\/([^/]+)\/open$/.exec(path)?.[1]
          : undefined;
      const route = openMessage === undefined ? path : openMessageRoute;
      if (!dispatched.some((entry) => entry.method === method && entry.path === route))
        return failed({ kind: "not-found" });
      if (
        (request.headers.get("host") ?? url.host) !== origin.host ||
        (request.headers.has("origin") && request.headers.get("origin") !== origin.origin) ||
        (method === "POST" && request.headers.get("origin") !== origin.origin)
      )
        return failed({ kind: "forbidden" });
      try {
        return await respond(request, path, peer, openMessage);
      } catch (error) {
        if (!(error instanceof AuthStorageError)) throw error;
        emit(storageUnavailable(error));
        return failed({ kind: "temporary-failure" });
      }
    },
    close: () => credentials.close(),
  };
}
