/** Every failure an auth or inbox route answers with, as the browser receives it. */
export type AuthFailure =
  | {
      kind:
        | "not-found"
        | "unauthenticated"
        | "forbidden"
        | "email-not-allowed"
        | "setup-complete"
        | "setup-required"
        | "temporary-failure";
    }
  | { kind: "invalid-input"; fields?: Record<string, string> }
  | { kind: "invalid-link" | "superseded-link"; next: "setup" | "sign-in" }
  | { kind: "throttled"; retryAt: number };

/** The status of each failure kind. A new kind does not compile until it has one. */
const failureStatus = {
  "not-found": 404,
  unauthenticated: 401,
  forbidden: 403,
  "email-not-allowed": 403,
  "invalid-input": 400,
  "invalid-link": 400,
  "superseded-link": 400,
  "setup-complete": 409,
  "setup-required": 409,
  throttled: 429,
  "temporary-failure": 503,
} as const satisfies Record<AuthFailure["kind"], number>;

/** Auth and inbox responses carry credentials or links, so they are never cached or referred. */
function authResponse(value: unknown, status: number, headers: Record<string, string> = {}) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", ...headers },
  });
}

export const failed = (failure: AuthFailure, headers?: Record<string, string>) =>
  authResponse(failure, failureStatus[failure.kind], headers);

export const succeeded = (value: unknown, headers?: Record<string, string>) =>
  authResponse({ kind: "ok", value }, 200, headers);
