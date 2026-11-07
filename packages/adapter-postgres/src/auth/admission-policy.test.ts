import { describe, expect, test } from "vite-plus/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { AuthStorageError } from "@aircastle/core";
import type { AuthAdmissionStore, AuthLimitScope } from "@aircastle/core";
import { defaults, generous, request, start, withAdmission } from "../test-support/admission.ts";

async function withAdmissionWorker(
  database: { url: string; namespace: string },
  run: (worker: {
    output: () => Promise<string>;
    send: (command: string) => void;
    kill: () => Promise<void>;
  }) => Promise<void>,
) {
  const child = spawn(
    "bun",
    [
      "--conditions=development",
      fileURLToPath(new URL("../test-support/auth-admission-worker.ts", import.meta.url)),
    ],
    {
      env: {
        ...process.env,
        AIRCASTLE_DATABASE_URL: database.url,
        AIRCASTLE_AUTH_TEST_NAMESPACE: database.namespace,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exited = new Promise<void>((resolve, reject) => {
    child.once("exit", () => resolve());
    child.once("error", reject);
  });
  const output = async () => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        once(child.stdout, "data").then(([chunk]) => String(chunk).trim()),
        exited.then(() => {
          throw new Error(`Admission worker exited: ${stderr}`);
        }),
        new Promise<string>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`Admission worker timed out: ${stderr}`)),
            10_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  };
  const kill = async () => {
    child.kill("SIGKILL");
    await exited;
  };
  try {
    await run({ output, send: (command) => child.stdin.write(`${command}\n`), kill });
  } finally {
    await kill();
  }
}

async function dropPolicyConnections(url: string, namespace: string) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const key = JSON.stringify([namespace, "auth-admission-policy"]);
    const dropped = await sql<{ terminated: boolean }[]>`
      SELECT pg_terminate_backend(pid) AS terminated FROM pg_locks
      WHERE locktype = 'advisory' AND mode = 'ShareLock' AND granted AND pid <> pg_backend_pid()
        AND ((classid::bigint << 32) | objid::bigint) = hashtextextended(${key}, 0)`;
    expect(dropped.length).toBeGreaterThan(0);
    await expect
      .poll(
        async () =>
          (
            await sql<{ held: number }[]>`
              SELECT count(*)::int AS held FROM pg_locks
              WHERE locktype = 'advisory' AND granted
                AND ((classid::bigint << 32) | objid::bigint) = hashtextextended(${key}, 0)`
          )[0]?.held,
      )
      .toBe(0);
  } finally {
    await sql.end();
  }
}

const admitAfterReconnect = (admission: AuthAdmissionStore) =>
  expect
    .poll(() =>
      admission.admit(request).then(
        (result) => result.kind,
        (error: unknown) => (error instanceof AuthStorageError ? "reconnecting" : error),
      ),
    )
    .toBe("admitted");

describe("auth admission policy across instances and processes", () => {
  test("an active namespace refuses different limits and accepts matching peers", async () => {
    await withAdmission(async ({ open }) => {
      const first = await open();
      const peer = await open();
      expect(await first.admit(request)).toEqual({ kind: "admitted" });
      expect(await peer.admit(request)).toEqual({ kind: "admitted" });
      await expect(
        open({ ...defaults, global: { fiveMinutes: 31, oneHour: 100 } }),
      ).rejects.toThrow(/policy|configuration|limits/i);
      expect(await first.admit(request)).toEqual({ kind: "admitted" });
    });
  });

  test.each<AuthLimitScope>(["email", "ip"])(
    "parallel instances cannot oversubscribe the %s budget",
    async (scope) => {
      await withAdmission(async ({ open }) => {
        const limits = { ...generous, [scope]: { fiveMinutes: 3, oneHour: 10 } };
        const instances = await Promise.all([open(limits), open(limits)]);
        const results = await Promise.all(
          Array.from({ length: 12 }, (_, index) => instances[index % 2]!.admit(request)),
        );
        expect(results.filter((result) => result.kind === "admitted")).toHaveLength(3);
        expect(results.filter((result) => result.kind === "throttled")).toHaveLength(9);
      });
    },
  );

  test("independent namespaces do not share request budgets or active policy", async () => {
    await withAdmission(async ({ open: openFirst }) => {
      const first = await openFirst({ ...generous, global: { fiveMinutes: 1, oneHour: 1 } });
      expect(await first.admit(request)).toEqual({ kind: "admitted" });
      expect(await first.admit(request)).toMatchObject({ kind: "throttled" });
      await withAdmission(async ({ open: openSecond }) => {
        const second = await openSecond();
        expect(await second.admit(request)).toEqual({ kind: "admitted" });
      });
    });
  });

  test("a different OS process shares the same remaining recipient slot", async () => {
    await withAdmission(async ({ open, url, namespace }) => {
      const parent = await open();
      for (let index = 0; index < 4; index++)
        expect(await parent.admit(request)).toEqual({ kind: "admitted" });
      await withAdmissionWorker({ url, namespace }, async ({ output, send }) => {
        expect(await output()).toBe("ready");
        const childResult = output();
        send("admit");
        const [local, remoteText] = await Promise.all([parent.admit(request), childResult]);
        const remote: unknown = JSON.parse(remoteText);
        expect(remote).toHaveProperty("kind");
        const results = [local, remote];
        expect(
          results.filter(
            (result) =>
              result &&
              typeof result === "object" &&
              "kind" in result &&
              result.kind === "admitted",
          ),
        ).toHaveLength(1);
        expect(results).toContainEqual({
          kind: "throttled",
          retryAt: start + 300_000,
          scopes: ["email"],
        });
      });
    });
  });

  test("an abruptly killed process cannot permanently block a coordinated policy change", async () => {
    await withAdmission(async ({ open, url, namespace }) => {
      await withAdmissionWorker({ url, namespace }, async ({ output, kill }) => {
        expect(await output()).toBe("ready");
        const changed = { ...defaults, global: { fiveMinutes: 31, oneHour: 100 } };
        await expect(open(changed)).rejects.toThrow(/policy|configuration|limits/i);
        await kill();
        await expect.poll(() => open(changed), { timeout: 5_000 }).toHaveProperty("admit");
        const restarted = await open(changed);
        expect(await restarted.admit(request)).toEqual({ kind: "admitted" });
      });
    });
  });

  test("a reconnected instance takes its policy back before a conflicting newcomer starts", async () => {
    await withAdmission(async ({ open, url, namespace }) => {
      const first = await open(generous);
      expect(await first.admit(request)).toEqual({ kind: "admitted" });
      await dropPolicyConnections(url, namespace);
      await admitAfterReconnect(first);
      await expect(
        open({ ...generous, global: { fiveMinutes: 999, oneHour: 1_000 } }),
      ).rejects.toThrow(/policy|configuration|limits/i);
      expect(await first.admit(request)).toEqual({ kind: "admitted" });
    });
  });

  test("an instance whose policy a newcomer replaced after a reconnect fails closed", async () => {
    await withAdmission(async ({ open, url, namespace }) => {
      const first = await open(generous);
      expect(await first.admit(request)).toEqual({ kind: "admitted" });
      await dropPolicyConnections(url, namespace);
      const newcomer = await open({ ...generous, global: { fiveMinutes: 999, oneHour: 1_000 } });
      for (let attempt = 0; attempt < 3; attempt++)
        await expect(first.admit(request)).rejects.toBeInstanceOf(AuthStorageError);
      expect(await newcomer.admit(request)).toEqual({ kind: "admitted" });
    });
  });
});
