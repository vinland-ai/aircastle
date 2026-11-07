import type { Logger } from "pino";
import {
  postgresAdapter,
  postgresAuthAdmission,
  postgresAuthStore,
} from "@aircastle/adapter-postgres";
import type { PostgresOptions } from "@aircastle/adapter-postgres";
import { createAircastle } from "@aircastle/core";
import { cmsErrorReporter, createApp } from "./app.ts";
import {
  authErrorReporter,
  createAuthEventLogger,
  createLocalAuth,
} from "./features/auth/index.ts";
import type { LocalAuthConfig } from "./features/auth/index.ts";
import { createDevelopmentInbox } from "./features/development-inbox/index.ts";
import type { DevelopmentInbox } from "./features/development-inbox/index.ts";

/** Closes resources in reverse order of creation. Every close runs, and failures are thrown together. */
export function resourceStack() {
  const cleanup: (() => Promise<void>)[] = [];
  let closing: Promise<void> | undefined;
  return {
    defer: (close: () => Promise<void>) => {
      cleanup.push(close);
    },
    close: () =>
      (closing ??= (async () => {
        const failures: unknown[] = [];
        for (const close of [...cleanup].reverse()) {
          try {
            await close();
          } catch (error) {
            failures.push(error);
          }
        }
        if (failures.length) throw new AggregateError(failures, "Aircastle cleanup failed");
      })()),
  };
}

export type ResourceStack = ReturnType<typeof resourceStack>;

/** Runs startup. If it throws, closes what it built and rethrows, joined with any cleanup failure. */
export async function startWith<Value>(
  resources: ResourceStack,
  start: () => Promise<Value>,
): Promise<Value> {
  try {
    return await start();
  } catch (error) {
    try {
      await resources.close();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Aircastle startup and cleanup failed", {
        cause: cleanupError,
      });
    }
    throw error;
  }
}

/**
 * Builds the CMS, auth and app for one configuration, deferring each resource's close onto
 * `resources`. Development auth also gets its Postgres storage, admission and an empty inbox.
 */
export async function assemble(
  options: {
    auth: LocalAuthConfig;
    database: PostgresOptions;
    logger: Logger;
    maxRequestBytes?: number;
    docsScript?: string;
    clock?: () => number;
  },
  resources: ResourceStack,
): Promise<{ app: ReturnType<typeof createApp>; inbox?: DevelopmentInbox }> {
  const { auth: config, database, logger } = options;
  const clock = options.clock === undefined ? {} : { clock: options.clock };
  const cms = await createAircastle({
    database: postgresAdapter(database),
    report: cmsErrorReporter(logger),
  });
  resources.defer(() => cms.close());
  const development = async (auth: Extract<LocalAuthConfig, { mode: "development" }>) => {
    const storage = await postgresAuthStore(database);
    resources.defer(() => storage.close());
    const admission = await postgresAuthAdmission({ ...database, limits: auth.limits, ...clock });
    resources.defer(() => admission.close());
    const inbox = createDevelopmentInbox();
    return {
      inbox,
      auth: await createLocalAuth({
        config: auth,
        storage,
        admission,
        inbox,
        emit: createAuthEventLogger(logger),
        report: authErrorReporter(logger),
        ...clock,
      }),
    };
  };
  const { auth, inbox } =
    config.mode === "disabled"
      ? { auth: await createLocalAuth({ config }), inbox: undefined }
      : await development(config);
  resources.defer(() => auth.close());
  const app = createApp({
    logger,
    cms,
    auth,
    ...(options.maxRequestBytes === undefined ? {} : { maxRequestBytes: options.maxRequestBytes }),
    ...(options.docsScript === undefined ? {} : { docsScript: options.docsScript }),
  });
  return { app, ...(inbox === undefined ? {} : { inbox }) };
}
