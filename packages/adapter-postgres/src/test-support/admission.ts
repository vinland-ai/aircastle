import { expect } from "vite-plus/test";
import type { AuthAdmissionStore, AuthLimits } from "@aircastle/core";
import { postgresAuthAdmission } from "../index.ts";
import { withDatabase } from "./database.ts";

export const defaults: AuthLimits = {
  email: { fiveMinutes: 5, oneHour: 20 },
  ip: { fiveMinutes: 10, oneHour: 30 },
  global: { fiveMinutes: 30, oneHour: 100 },
};
export const generous: AuthLimits = {
  email: { fiveMinutes: 1_000, oneHour: 1_000 },
  ip: { fiveMinutes: 1_000, oneHour: 1_000 },
  global: { fiveMinutes: 1_000, oneHour: 1_000 },
};
export const start = Date.UTC(2026, 0, 1);
export const request = { source: "127.0.0.1", email: "alex@example.test" };

export async function withAdmission(
  run: (fixture: {
    open: (limits?: AuthLimits) => Promise<AuthAdmissionStore>;
    at: (milliseconds: number) => void;
    url: string;
    namespace: string;
  }) => Promise<void>,
) {
  await withDatabase(async ({ store, url, namespace, sql }) => {
    await store.initialize();
    expect((await sql`SELECT 1 AS connected`)[0]?.connected).toBe(1);
    let now = start;
    const opened: AuthAdmissionStore[] = [];
    try {
      await run({
        url,
        namespace,
        at: (milliseconds) => {
          now = start + milliseconds;
        },
        open: async (limits = defaults) => {
          const admission = await postgresAuthAdmission({
            url,
            namespace,
            limits,
            clock: () => now,
          });
          opened.push(admission);
          return admission;
        },
      });
    } finally {
      await Promise.all(opened.map((admission) => admission.close()));
    }
  });
}
