export const authLimitScopes = ["email", "ip", "global"] as const;
export type AuthLimitScope = (typeof authLimitScopes)[number];

/** Rolling windows and their lengths in milliseconds. Limits change counts, never lengths. */
export const authLimitWindows = [
  ["fiveMinutes", 300_000],
  ["oneHour", 3_600_000],
] as const;
export type AuthLimitWindow = (typeof authLimitWindows)[number][0];

/** How many admissions each scope allows in each window. */
export type AuthLimits = Record<AuthLimitScope, Record<AuthLimitWindow, number>>;

/** How long an admission still counts toward some window. */
export const admissionRetention = Math.max(...authLimitWindows.map(([, length]) => length));

export type AuthAdmission =
  | { kind: "admitted" }
  | { kind: "throttled"; retryAt: number; scopes: AuthLimitScope[] };

export interface AuthAdmissionStore {
  admit: (request: { source: string; email?: string }) => Promise<AuthAdmission>;
  close: () => Promise<void>;
}

/**
 * Earlier admission times for one request's identities, ascending. `email` is present only when
 * the request carries an email.
 */
export interface AdmissionHistory {
  ip: readonly number[];
  global: readonly number[];
  email?: readonly number[];
}

/** The scopes this request is charged to, and the answer it gets. */
export interface AdmissionDecision {
  charge: AuthLimitScope[];
  admission: AuthAdmission;
}

/** When every full window of one scope has room again, or undefined if none is full. */
function reopensAt(
  times: readonly number[],
  ceilings: AuthLimits[AuthLimitScope],
  now: number,
): number | undefined {
  let reopens: number | undefined;
  for (const [window, length] of authLimitWindows) {
    const counted = times.filter((time) => time > now - length);
    const ceiling = ceilings[window];
    if (counted.length >= ceiling)
      reopens = Math.max(reopens ?? now, counted[counted.length - ceiling]! + length);
  }
  return reopens;
}

/**
 * Applies the counting order: a full IP or global window rejects the request uncharged. Otherwise
 * the request is charged to IP and global, then checked against its email's windows, and charged
 * to the email only when admitted. A rejection retries once every window would admit the same
 * request again, counting the charges this decision makes.
 */
export function decideAdmission(
  history: AdmissionHistory,
  limits: AuthLimits,
  now: number,
): AdmissionDecision {
  const full = (scopes: AuthLimitScope[]) =>
    scopes.filter((scope) => {
      const times = history[scope];
      return times !== undefined && reopensAt(times, limits[scope], now) !== undefined;
    });
  const throttled = (charge: AuthLimitScope[], scopes: AuthLimitScope[]): AdmissionDecision => {
    const retryAt = Math.max(
      ...authLimitScopes.map((scope) => {
        const times = history[scope];
        if (times === undefined) return now;
        const charged = charge.includes(scope) ? [...times, now] : times;
        return reopensAt(charged, limits[scope], now) ?? now;
      }),
    );
    return { charge, admission: { kind: "throttled", retryAt, scopes } };
  };
  const outer = full(["ip", "global"]);
  if (outer.length) return throttled([], outer);
  if (history.email === undefined)
    return { charge: ["ip", "global"], admission: { kind: "admitted" } };
  if (full(["email"]).length) return throttled(["ip", "global"], ["email"]);
  return { charge: ["ip", "global", "email"], admission: { kind: "admitted" } };
}
