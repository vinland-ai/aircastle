import type { AuthAdmissionStore, AuthLimits, AuthStore, ReportError } from "@aircastle/core";
import type { AuthEvent } from "./diagnostics.ts";
import { developmentAuth } from "./runtime.ts";
import { failed, succeeded } from "./responses.ts";
import type { DevelopmentInbox } from "../development-inbox/index.ts";

export { authErrorReporter, createAuthEventLogger } from "./diagnostics.ts";
export type { AuthEvent } from "./diagnostics.ts";

export type LocalAuthConfig =
  | { mode: "disabled" }
  | {
      mode: "development";
      browserOrigin: string;
      initialEmail?: string;
      limits: AuthLimits;
    };

export interface LocalAuthRuntime {
  handle: (request: Request, peer: { address: string | undefined }) => Promise<Response>;
  close: () => Promise<void>;
}

export type LocalAuthOptions =
  | { config: { mode: "disabled" } }
  | {
      config: Extract<LocalAuthConfig, { mode: "development" }>;
      storage: AuthStore;
      admission: AuthAdmissionStore;
      clock?: () => number;
      inbox?: DevelopmentInbox;
      emit: (event: AuthEvent) => void;
      /** Receives the summary of an unexpected error raised outside a request, such as in background reconciliation. */
      report: ReportError;
    };

export async function createLocalAuth(options: LocalAuthOptions): Promise<LocalAuthRuntime> {
  if (!("storage" in options))
    return {
      handle: async (request) => {
        const url = new URL(request.url);
        return request.method === "GET" && url.pathname === "/api/auth/state"
          ? succeeded({ kind: "disabled" })
          : failed({ kind: "not-found" });
      },
      close: async () => {},
    };
  return developmentAuth(options);
}
