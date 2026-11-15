import type postgres from "postgres";

type LockPurpose = "auth-admission" | "auth-admission-policy" | "auth-email";

/**
 * The advisory lock id for one auth purpose in a namespace. Processes on every build must derive
 * the same key text, or they stop excluding each other.
 */
export const lockId = (
  sql: postgres.TransactionSql,
  namespace: string,
  purpose: LockPurpose,
  ...parts: string[]
) => sql`hashtextextended(${JSON.stringify([namespace, purpose, ...parts])}, 0)`;
