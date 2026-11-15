import postgres from "postgres";
import { AuthStorageError } from "@aircastle/core";
import type { AuthStore } from "@aircastle/core";
import { connectionTarget } from "../config.ts";
import type { PostgresOptions } from "../config.ts";
import { initializeAuthLayout } from "./layout.ts";
import { storageFailure } from "./failure.ts";
import { authTransaction, resolveIssuance, signingSecret } from "./transaction.ts";

export async function postgresAuthStore(options: PostgresOptions): Promise<AuthStore> {
  const { url, namespace } = connectionTarget(options);
  const sql = postgres(url, { max: 10, prepare: false, onnotice: () => {} });
  try {
    await sql.begin((transaction) => initializeAuthLayout(transaction, namespace));
  } catch (error) {
    await sql.end({ timeout: 0 });
    throw error;
  }
  let closing: Promise<void> | undefined;
  const pending = new Set<Promise<unknown>>();
  function run<Value>(operation: () => Promise<Value>): Promise<Value> {
    if (closing) return Promise.reject(new AuthStorageError("unavailable"));
    const result = Promise.resolve().then(operation);
    pending.add(result);
    void Promise.allSettled([result]).then(() => pending.delete(result));
    return result;
  }
  async function transaction<Value>(
    operation: (sql: postgres.TransactionSql) => Promise<Value>,
  ): Promise<Value> {
    let phase: "operation" | "commit" = "operation";
    try {
      const result = await sql.begin(async (transactionSql) => {
        const value = await operation(transactionSql);
        phase = "commit";
        return { value };
      });
      return result.value;
    } catch (error) {
      throw storageFailure(error, phase);
    }
  }
  return {
    transaction: (operation) =>
      run(() => transaction((sql) => operation(authTransaction(sql, namespace)))),
    signingSecret: () =>
      run(async () => {
        try {
          return await signingSecret(sql, namespace);
        } catch (error) {
          throw storageFailure(error);
        }
      }),
    resolveIssuance: (issuance) =>
      run(() => transaction((sql) => resolveIssuance(sql, namespace, issuance))),
    close: () =>
      (closing ??= (async () => {
        while (pending.size) await Promise.allSettled(pending);
        await sql.end({ timeout: 0 });
      })()),
  };
}
