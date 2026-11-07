import { postgresAuthStore } from "../index.ts";
import { withDatabase } from "./database.ts";

/** Runs with an initialized content namespace and an auth store open on it. */
export async function withStore(
  run: (
    fixture: Parameters<Parameters<typeof withDatabase>[0]>[0] & {
      auth: Awaited<ReturnType<typeof postgresAuthStore>>;
    },
  ) => Promise<void>,
) {
  await withDatabase(async (fixture) => {
    await fixture.store.initialize();
    const auth = await postgresAuthStore({ url: fixture.url, namespace: fixture.namespace });
    try {
      await run({ ...fixture, auth });
    } finally {
      await auth.close();
    }
  });
}
