import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import type { DevelopmentInboxEntry } from "@aircastle/contracts";

const repository = fileURLToPath(new URL("../../../../../../", import.meta.url));
const runtimeConfig = fileURLToPath(
  new URL("../../../../../../tests/fixtures/tsconfig.runtime.json", import.meta.url),
);
const server = fileURLToPath(new URL("./server.ts", import.meta.url));

export interface AuthProcess {
  /** The child's own API origin on an ephemeral loopback port. */
  origin: string;
  /** Reads the child's in-memory development inbox. */
  inbox: () => Promise<DevelopmentInboxEntry[]>;
  /** Moves the child's injected clock forward. */
  advance: (milliseconds: number) => Promise<void>;
  /** Stops the child with SIGTERM, then SIGKILL if it outlives the close deadline. */
  close: () => Promise<void>;
}

const field = (message: unknown, name: string): unknown =>
  typeof message === "object" && message !== null ? Reflect.get(message, name) : undefined;

/**
 * Runs `server.ts` in its own Bun process with development conditions and talks to it over IPC.
 * The child parses its configuration with the production parsers, so `environment` must hold
 * valid configuration.
 */
export async function startAuthProcess(options: {
  database: { url: string; namespace: string };
  browserOrigin: string;
  now: number;
  /** Applied over `AIRCASTLE_ENV=development`. The database, origin and clock keys always win. */
  environment?: Record<string, string>;
  /** A file descriptor for the child's stdout and stderr. Without one, stderr is kept for errors. */
  output?: number;
  /** Milliseconds to wait for readiness, for each IPC reply, and for exit after SIGTERM. */
  deadlines: { ready: number; reply: number; close: number };
}): Promise<AuthProcess> {
  const output = options.output ?? "ignore";
  const child = spawn(
    "bun",
    ["--conditions=development", `--tsconfig-override=${runtimeConfig}`, server],
    {
      cwd: repository,
      env: {
        ...process.env,
        AIRCASTLE_ENV: "development",
        ...options.environment,
        AIRCASTLE_DATABASE_URL: options.database.url,
        AIRCASTLE_DATABASE_NAMESPACE: options.database.namespace,
        AIRCASTLE_URL: options.browserOrigin,
        AUTH_TEST_NOW: String(options.now),
      },
      stdio: ["ignore", output, options.output === undefined ? "pipe" : output, "ipc"],
    },
  );
  let stderr = "";
  child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const failure = (what: string) =>
    new Error(
      options.output === undefined
        ? `${what}${stderr ? `: ${stderr}` : ""}`
        : `${what}; see its log`,
    );

  function receive<Value>(
    kind: string,
    id: string | undefined,
    within: number,
    read: (message: unknown) => Value | undefined,
  ) {
    return new Promise<Value>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        child.off("message", listener);
        child.off("exit", exited);
        child.off("error", failed);
      };
      const timer = setTimeout(() => {
        finish();
        reject(failure(`Auth process sent no ${kind} reply`));
      }, within);
      const listener = (message: unknown) => {
        if (field(message, "kind") !== kind || (id !== undefined && field(message, "id") !== id))
          return;
        const value = read(message);
        if (value === undefined) return;
        finish();
        resolve(value);
      };
      const exited = (code: number | null) => {
        finish();
        reject(failure(`Auth process exited with code ${code} before its ${kind} reply`));
      };
      const failed = (error: Error) => {
        finish();
        reject(error);
      };
      child.on("message", listener);
      child.once("exit", exited);
      child.once("error", failed);
    });
  }

  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        exited,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("Auth process did not stop")),
            options.deadlines.close,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  };

  try {
    const origin = await receive("ready", undefined, options.deadlines.ready, (message) => {
      const value = field(message, "origin");
      return typeof value === "string" && /^http:\/\/127\.0\.0\.1:\d+$/.test(value)
        ? value
        : undefined;
    });
    return {
      origin,
      close,
      inbox: async () => {
        const id = randomUUID();
        const entries = receive("inbox", id, options.deadlines.reply, (message) => {
          const value = field(message, "entries");
          return Array.isArray(value) ? (value as DevelopmentInboxEntry[]) : undefined;
        });
        child.send({ kind: "inbox", id });
        return entries;
      },
      advance: async (milliseconds) => {
        const id = randomUUID();
        const advanced = receive("advanced", id, options.deadlines.reply, () => true);
        child.send({ kind: "advance", milliseconds, id });
        await advanced;
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
