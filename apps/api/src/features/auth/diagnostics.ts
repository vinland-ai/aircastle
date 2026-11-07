import type { AuthLimitScope, AuthStorageError, ReportError } from "@aircastle/core";
import type { Logger } from "pino";

export type AuthEvent =
  | { kind: "request-blocked"; scopes: readonly AuthLimitScope[] }
  | {
      kind: "sign-in-failed";
      reason: "unknown-identity" | "invalid-link" | "superseded-link" | "setup-complete";
    }
  | { kind: "delivery-failed" }
  | { kind: "storage-unavailable"; code?: string };

/**
 * Passes at most five identical events per minute, so a flood cannot fill the log. A clock that
 * moves backwards starts a new minute.
 */
export function boundedEvents(emit: (event: AuthEvent) => void, clock: () => number) {
  const seen = new Map<string, number>();
  let window = clock();
  return (event: AuthEvent) => {
    const now = clock();
    if (now - window >= 60_000 || now < window) {
      seen.clear();
      window = now;
    }
    const key = JSON.stringify(event);
    const count = seen.get(key) ?? 0;
    if (count >= 5) return;
    seen.set(key, count + 1);
    emit(event);
  };
}

/** The diagnostic event for a storage failure, carrying only its driver code. */
export const storageUnavailable = (error: AuthStorageError): AuthEvent => ({
  kind: "storage-unavailable",
  ...(error.code === undefined ? {} : { code: error.code }),
});

/** Writes structured auth diagnostics through the application logger. */
export function createAuthEventLogger(logger: Logger): (event: AuthEvent) => void {
  return (event) => logger.info({ auth: event }, "Authentication event");
}

/** Logs the summary of an unexpected auth error with the same message as a failed auth request. */
export function authErrorReporter(logger: Logger): ReportError {
  return (summary) => logger.error({ err: summary }, "Unexpected auth error");
}
