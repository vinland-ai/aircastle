import postgres from "postgres";
import { AuthStorageError } from "@aircastle/core";
import type {
  AuthAdmission,
  AuthAdmissionStore,
  AuthLimits,
  AuthLimitScope,
} from "@aircastle/core";
import { connectionTarget } from "../config.ts";
import type { PostgresOptions } from "../config.ts";
import { identifier } from "../identifier.ts";
import { storageFailure } from "./failure.ts";
import { initializeAuthLayout } from "./layout.ts";
import { lockId } from "./lock.ts";

const windows = [
  ["fiveMinutes", 300_000],
  ["oneHour", 3_600_000],
] as const;
const retention = Math.max(...windows.map(([, duration]) => duration));
const scopes = ["email", "ip", "global"] as const;

type AdmissionEvent = { scope: AuthLimitScope; admitted_at: string };
type Throttled = Extract<AuthAdmission, { kind: "throttled" }>;

function exhausted(
  events: AdmissionEvent[],
  limits: AuthLimits,
  now: number,
  checked: AuthLimitScope[],
): Throttled | undefined {
  const blocked: AuthLimitScope[] = [];
  let retryAt = now;
  for (const scope of checked) {
    const times = events
      .filter((event) => event.scope === scope)
      .map((event) => Number(event.admitted_at));
    let denied = false;
    for (const [window, duration] of windows) {
      const retained = times.filter((time) => time > now - duration);
      const ceiling = limits[scope][window];
      if (retained.length >= ceiling) {
        denied = true;
        retryAt = Math.max(retryAt, retained[retained.length - ceiling]! + duration);
      }
    }
    if (denied) blocked.push(scope);
  }
  if (blocked.length) return { kind: "throttled", retryAt, scopes: blocked };
}

interface AdmissionPolicy {
  namespace: string;
  limits: AuthLimits;
  /** The ceilings in the order every process compares, so a peer with equal limits matches. */
  text: string;
}

/** Copies and checks the ceilings, and serializes them in the order every process compares. */
function admissionPolicy(namespace: string, configured: AuthLimits): AdmissionPolicy {
  const limits: AuthLimits = {
    email: { ...configured.email },
    ip: { ...configured.ip },
    global: { ...configured.global },
  };
  for (const scope of scopes)
    for (const [window] of windows)
      if (!Number.isSafeInteger(limits[scope][window]) || limits[scope][window] <= 0)
        throw new Error(`Invalid auth limits: ${scope}.${window}`);
  const text = JSON.stringify(
    scopes.map((scope) => windows.map(([window]) => limits[scope][window])),
  );
  return { namespace, limits, text };
}

type PolicyHold = "held" | "conflict";

async function lockOperation(tx: postgres.TransactionSql, namespace: string) {
  await tx`SELECT pg_advisory_xact_lock(${lockId(tx, namespace, "auth-admission")})`;
}

async function storedPolicyIs(tx: postgres.TransactionSql, policy: AdmissionPolicy) {
  const [row] = await tx<
    { policy: string }[]
  >`SELECT policy FROM ${identifier(tx, policy.namespace, "auth_admission_policy")} WHERE singleton = 1`;
  return row?.policy === policy.text;
}

async function holdsPolicy(tx: postgres.TransactionSql, policy: AdmissionPolicy) {
  const [row] = await tx<{ held: boolean }[]>`
    SELECT EXISTS (
      SELECT FROM pg_locks
      WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND mode = 'ShareLock' AND granted
        AND objsubid = 1
        AND ((classid::bigint << 32) | objid::bigint) = ${lockId(tx, policy.namespace, "auth-admission-policy")}
    ) AS held`;
  return row?.held ?? false;
}

/**
 * Overwrites the stored policy only when no running process holds it, then holds it shared for
 * the connection's life. A different stored policy that another process holds is a conflict.
 */
async function claimPolicy(
  tx: postgres.TransactionSql,
  policy: AdmissionPolicy,
): Promise<PolicyHold> {
  const [lock] = await tx<{ acquired: boolean }[]>`
    SELECT pg_try_advisory_xact_lock(${lockId(tx, policy.namespace, "auth-admission-policy")}) AS acquired`;
  if (lock?.acquired) {
    await tx`INSERT INTO ${identifier(tx, policy.namespace, "auth_admission_policy")} (singleton, policy) VALUES (1, ${policy.text}) ON CONFLICT (singleton) DO UPDATE SET policy = EXCLUDED.policy`;
  } else if (!(await storedPolicyIs(tx, policy))) {
    return "conflict";
  }
  await tx`SELECT pg_advisory_lock_shared(${lockId(tx, policy.namespace, "auth-admission-policy")})`;
  return "held";
}

/**
 * Run under the operation lock before admitting. After a reconnect drops the hold, takes it back,
 * then confirms the stored policy is still this one, so an instance that a newcomer replaced fails
 * closed.
 */
async function confirmPolicy(
  tx: postgres.TransactionSql,
  policy: AdmissionPolicy,
): Promise<PolicyHold> {
  if (!(await holdsPolicy(tx, policy)) && (await claimPolicy(tx, policy)) === "conflict")
    return "conflict";
  return (await storedPolicyIs(tx, policy)) ? "held" : "conflict";
}

export async function postgresAuthAdmission(
  options: PostgresOptions & { limits: AuthLimits; clock?: () => number },
): Promise<AuthAdmissionStore> {
  const { url, namespace } = connectionTarget(options);
  const policy = admissionPolicy(namespace, options.limits);
  const { limits } = policy;
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    idle_timeout: 0,
    max_lifetime: 0,
    onnotice: () => {},
  });
  const table = (name: string) => identifier(sql, namespace, name);
  const clock = options.clock ?? Date.now;
  try {
    await sql.begin(async (transaction) => {
      await initializeAuthLayout(transaction, namespace);
      await lockOperation(transaction, namespace);
      if ((await claimPolicy(transaction, policy)) === "conflict")
        throw new Error("Auth admission limits conflict with the active namespace policy");
    });
  } catch (error) {
    await sql.end({ timeout: 5 });
    throw error;
  }
  let closing: Promise<void> | undefined;
  return {
    admit: async ({ source, email }) => {
      if (closing) throw new AuthStorageError("unavailable");
      try {
        return await sql.begin(async (transaction): Promise<AuthAdmission> => {
          await lockOperation(transaction, namespace);
          if ((await confirmPolicy(transaction, policy)) === "conflict")
            throw new AuthStorageError("unavailable");
          const now = clock();
          await transaction`DELETE FROM ${table("auth_admission_events")} WHERE admitted_at <= ${now - retention}`;
          const events = await transaction<
            AdmissionEvent[]
          >`SELECT scope, admitted_at FROM ${table("auth_admission_events")} WHERE (scope = 'global' AND identity = '') OR (scope = 'ip' AND identity = ${source}) OR (scope = 'email' AND identity = ${email ?? null}) ORDER BY admitted_at`;
          const throttled = (checked: AuthLimitScope[]) => exhausted(events, limits, now, checked);
          const outer = throttled(["ip", "global"]);
          if (outer) {
            const recipient = email === undefined ? undefined : throttled(["email"]);
            if (recipient) outer.retryAt = Math.max(outer.retryAt, recipient.retryAt);
            return outer;
          }
          await transaction`INSERT INTO ${table("auth_admission_events")} (scope, identity, admitted_at) VALUES ('ip', ${source}, ${now}), ('global', '', ${now})`;
          events.push(
            { scope: "ip", admitted_at: String(now) },
            { scope: "global", admitted_at: String(now) },
          );
          if (email !== undefined) {
            const recipient = throttled(["email"]);
            if (recipient) {
              const chargedOuter = throttled(["ip", "global"]);
              if (chargedOuter)
                recipient.retryAt = Math.max(recipient.retryAt, chargedOuter.retryAt);
              return recipient;
            }
            await transaction`INSERT INTO ${table("auth_admission_events")} (scope, identity, admitted_at) VALUES ('email', ${email}, ${now})`;
          }
          return { kind: "admitted" };
        });
      } catch (error) {
        throw storageFailure(error);
      }
    },
    close: () => (closing ??= sql.end({ timeout: 5 })),
  };
}
