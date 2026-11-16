import type { AuthState } from "@aircastle/contracts";
import { developmentAuth } from "./runtime.ts";
import type { DevelopmentAuthOptions, LocalAuthRuntime } from "./runtime.ts";
import { failed, succeeded } from "./responses.ts";

export { authErrorReporter, createAuthEventLogger } from "./diagnostics.ts";
export type { AuthEvent } from "./diagnostics.ts";
export type { LocalAuthRuntime } from "./runtime.ts";

export type LocalAuthConfig = { mode: "disabled" } | DevelopmentAuthOptions["config"];

export type LocalAuthOptions = { config: { mode: "disabled" } } | DevelopmentAuthOptions;

export async function createLocalAuth(options: LocalAuthOptions): Promise<LocalAuthRuntime> {
  if (!("storage" in options))
    return {
      handle: async (request) => {
        const url = new URL(request.url);
        return request.method === "GET" && url.pathname === "/api/auth/state"
          ? succeeded({ kind: "disabled" } satisfies AuthState)
          : failed({ kind: "not-found" });
      },
      close: async () => {},
    };
  return developmentAuth(options);
}
