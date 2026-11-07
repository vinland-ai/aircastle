import { AuthStorageError } from "@aircastle/core";
import type { AuthAdmissionStore, AuthLimits, AuthStore, ReportError } from "@aircastle/core";
import type { DevelopmentInbox } from "../development-inbox/index.ts";
import { createCredentials } from "./credentials.ts";
import { boundedEvents, storageUnavailable } from "./diagnostics.ts";
import type { AuthEvent } from "./diagnostics.ts";
import { createSessions, sessionCookie, sessionProjection } from "./sessions.ts";
import { fromBrowserOrigin, matchRoute } from "./dispatch.ts";
import type { AuthRoute } from "./dispatch.ts";
import { jsonBody, parseAccount, parseEntry, parseLink } from "./request.ts";
import { failed, succeeded } from "./responses.ts";

export interface LocalAuthRuntime {
  handle: (request: Request, peer: { address: string | undefined }) => Promise<Response>;
  close: () => Promise<void>;
}

export interface DevelopmentAuthOptions {
  config: { mode: "development"; browserOrigin: string; initialEmail?: string; limits: AuthLimits };
  storage: AuthStore;
  admission: AuthAdmissionStore;
  clock?: () => number;
  inbox: DevelopmentInbox;
  emit: (event: AuthEvent) => void;
  /** Receives the summary of an unexpected error raised outside a request, such as in background reconciliation. */
  report: ReportError;
}

type Call = { request: Request; peer: { address: string | undefined }; id: string | undefined };

export async function developmentAuth(options: DevelopmentAuthOptions): Promise<LocalAuthRuntime> {
  const { storage, admission, config, inbox } = options;
  const clock = options.clock ?? Date.now;
  const emit = boundedEvents((event) => options.emit(event), clock);
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

  const requestLink =
    (purpose: "setup" | "sign-in") =>
    async ({ request, peer }: Call): Promise<Response> => {
      const body = await jsonBody(request);
      if (!peer.address) return failed({ kind: "forbidden" });
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
    };

  const handlers: Record<AuthRoute, (call: Call) => Promise<Response>> = {
    "GET /api/auth/state": async ({ request }) =>
      succeeded(await sessions.state(await cookie.read(request))),
    "GET /api/auth/session": async ({ request }) => {
      const active = await sessions.read(await cookie.read(request));
      return active ? succeeded(sessionProjection(active)) : failed({ kind: "unauthenticated" });
    },
    "GET /api/development-inbox/messages": async () => succeeded(inbox.list()),
    "POST /api/development-inbox/messages/:id/open": async ({ id }) => {
      const messageId = decodedId(id);
      const entry = messageId === undefined ? undefined : inbox.open(messageId);
      return entry ? succeeded(entry) : failed({ kind: "not-found" });
    },
    "POST /api/auth/setup": requestLink("setup"),
    "POST /api/auth/sign-in": requestLink("sign-in"),
    "POST /api/auth/confirm": async ({ request }) => {
      const result = await credentials.confirm(parseLink(await jsonBody(request)));
      if (result.kind === "failure") return failed(result.failure);
      return succeeded(
        { destination: result.destination },
        { "Set-Cookie": await cookie.issue(result.token) },
      );
    },
    "POST /api/auth/confirm/preview": async ({ request }) => {
      const result = await credentials.preview(parseLink(await jsonBody(request)));
      if (result.kind === "failure") return failed(result.failure);
      return succeeded({ email: result.email, purpose: result.purpose });
    },
    "POST /api/auth/sign-out": async ({ request }) => {
      await sessions.signOut(await cookie.read(request));
      return succeeded({ destination: "/sign-in" }, { "Set-Cookie": cookie.clear() });
    },
    "POST /api/auth/activity": async ({ request }) => {
      const active = await sessions.activity(await cookie.read(request));
      if (!active) return failed({ kind: "unauthenticated" });
      return succeeded(sessionProjection(active), {
        "Set-Cookie": await cookie.issue(active.token),
      });
    },
    "POST /api/auth/entry": async ({ request }) => {
      const token = await cookie.read(request);
      const result = await sessions.entry(token, parseEntry(await jsonBody(request)));
      if (result.kind !== "ok") return failed(result);
      return succeeded(
        { destination: result.destination, session: sessionProjection(result.session) },
        { "Set-Cookie": await cookie.issue(result.session.token) },
      );
    },
  };

  return {
    handle: async (request, peer) => {
      const match = matchRoute(request.method, new URL(request.url).pathname);
      if (!match) return failed({ kind: "not-found" });
      if (!fromBrowserOrigin(request, origin)) return failed({ kind: "forbidden" });
      try {
        return await handlers[match.route]({ request, peer, id: match.id });
      } catch (error) {
        if (!(error instanceof AuthStorageError)) throw error;
        emit(storageUnavailable(error));
        return failed({ kind: "temporary-failure" });
      }
    },
    close: () => credentials.close(),
  };
}

/** The decoded message id, or undefined when it is missing or not valid percent-encoding. */
function decodedId(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch (error) {
    if (!(error instanceof URIError)) throw error;
    return undefined;
  }
}
