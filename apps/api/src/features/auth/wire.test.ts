import { expect, test } from "vite-plus/test";
import postgres from "postgres";
import type { AuthStore } from "@aircastle/core";
import type { DevelopmentInbox, EmailMessage } from "../development-inbox/index.ts";
import { issueSetupLink, withAuth } from "./test-support/fixture.ts";
import { deadline, postgresWire, waitForBlock } from "./test-support/postgres-wire.ts";

/** Runs a hook once, right after the next link replacement writes and before its transaction commits. */
function afterNextReplacement() {
  let hook: (() => void) | undefined;
  return {
    arm: (next: () => void) => {
      hook = next;
    },
    wrap: (store: AuthStore): AuthStore => ({
      ...store,
      transaction: (work) =>
        store.transaction((transaction) =>
          work({
            ...transaction,
            replaceLink: async (record) => {
              await transaction.replaceLink(record);
              const run = hook;
              hook = undefined;
              run?.();
            },
          }),
        ),
    }),
  };
}

/** Records each message the inbox prepared, in order. */
function preparedMessages() {
  const prepared: EmailMessage[] = [];
  return {
    prepared,
    wrap: (inbox: DevelopmentInbox): DevelopmentInbox => ({
      ...inbox,
      prepare: async (mail) => {
        const publication = await inbox.prepare(mail);
        prepared.push(mail);
        return publication;
      },
    }),
  };
}

test("wire control notifies a waiter registered before the fault is armed", async () => {
  await withAuth(async ({ url }) => {
    const wire = await postgresWire(url);
    const writer = postgres(wire.url, { max: 1 });
    let writing: Promise<unknown> | undefined;
    const waiting = wire.held().catch((error: unknown) => error);
    try {
      wire.arm("before-commit");
      writing = writer.begin(async (tx) => tx`SELECT 1`).catch((error: unknown) => error);
      const pid = await wire.held();
      expect(pid).toBeGreaterThan(0);
      expect(await Promise.race([waiting, Promise.resolve("waiter was abandoned")])).toBe(pid);
      wire.release();
      expect(await writing).toMatchObject({ code: "CONNECTION_CLOSED" });
    } finally {
      await wire.close();
      await writing;
      await writer.end({ timeout: 1 });
    }
  });
});

for (const mode of ["before-commit", "after-commit"] as const) {
  for (const prepare of [false, true]) {
    test(`wire control distinguishes ${mode} loss with prepare=${prepare} using an independent durable read and lock waiter`, async () => {
      await withAuth(async ({ sql, url, namespace }) => {
        await sql`CREATE TABLE ${sql(namespace)}.fixture_wire (id integer PRIMARY KEY, value text NOT NULL)`;
        await sql`INSERT INTO ${sql(namespace)}.fixture_wire VALUES (1, 'before')`;
        let commitStatement: string | undefined;
        let commitParses = 0;
        let commitBinds = 0;
        const wire = await postgresWire(url, (frame, type) => {
          const fields = frame.subarray(5).toString("utf8").split("\0");
          if (type === "P" && fields[1]?.trim().toLowerCase() === "commit") {
            commitStatement = fields[0];
            commitParses++;
          }
          if (type === "B" && commitStatement !== undefined && fields[1] === commitStatement)
            commitBinds++;
        });
        const writer = postgres(wire.url, { max: 1, prepare });
        let writing: Promise<unknown> | undefined;
        let resolving: Promise<unknown> | undefined;
        try {
          await writer.begin(async (tx) => {
            expect((await tx`SELECT 1 AS connected`)[0]?.connected).toBe(1);
          });
          expect(await sql`SELECT value FROM ${sql(namespace)}.fixture_wire`).toEqual([
            { value: "before" },
          ]);
          if (prepare) {
            expect(commitParses).toBe(1);
            expect(commitBinds).toBe(1);
          }
          wire.arm(mode);
          const outcome = writer
            .begin(async (tx) => {
              await tx`UPDATE ${tx(namespace)}.fixture_wire SET value = 'after' WHERE id = 1`;
            })
            .then(
              () => ({ kind: "committed" }),
              (error: unknown) => ({ kind: "error", error }),
            );
          writing = outcome;
          const pid = await Promise.race([
            wire.held(),
            outcome.then((outcome) => {
              if (prepare) {
                expect(commitParses).toBe(1);
                expect(commitBinds).toBe(2);
              }
              throw new Error(`COMMIT escaped the wire gate: ${JSON.stringify(outcome)}`);
            }),
          ]);
          if (prepare) {
            expect(commitParses).toBe(1);
            expect(commitBinds).toBe(2);
          }
          expect(pid).toBeGreaterThan(0);
          expect(await sql`SELECT value FROM ${sql(namespace)}.fixture_wire`).toEqual([
            { value: "before" },
          ]);
          resolving = sql.begin(async (tx) => {
            await tx`SELECT id FROM ${tx(namespace)}.fixture_wire WHERE id = 1 FOR UPDATE`;
            return tx`SELECT value FROM ${tx(namespace)}.fixture_wire WHERE id = 1`;
          });
          expect(await waitForBlock(sql, pid)).toBeGreaterThan(0);
          wire.release();
          expect(await deadline(writing, "Driver did not report transport loss")).toMatchObject({
            kind: "error",
            error: { code: "CONNECTION_CLOSED" },
          });
          const expected = [{ value: mode === "after-commit" ? "after" : "before" }];
          expect(await resolving).toEqual(expected);
          expect(await sql`SELECT value FROM ${sql(namespace)}.fixture_wire`).toEqual(expected);
          expect(wire.committed()).toBe(mode === "after-commit");
        } finally {
          await wire.close();
          await writing;
          await resolving;
          await writer.end({ timeout: 1 });
        }
      });
    });
  }

  test(`application ${mode} transport loss coordinates inbox publication with locked marker resolution`, async () => {
    const nextReplacement = afterNextReplacement();
    const capture = preparedMessages();
    await withAuth(
      async ({ open, url, sql }) => {
        const wire = await postgresWire(url);
        let requesting: Promise<Response> | undefined;
        let resolving: Promise<"committed" | "not-committed"> | undefined;
        try {
          const server = await open(undefined, wire.url);
          const old = await issueSetupLink(server);
          nextReplacement.arm(() => wire.arm(mode));
          requesting = server.request("/auth/setup", {
            name: "Replacement",
            email: "alex@example.test",
          });
          const pid = await wire.held();
          expect(server.inbox.list()).toHaveLength(1);
          const message = capture.prepared[capture.prepared.length - 1];
          expect(message?.messageId).not.toBe(old.message.messageId);
          if (!message)
            throw new Error("Issuance must reserve its complete message before committing");
          resolving = server.storage.resolveIssuance({
            messageId: message.messageId,
            email: "alex@example.test",
          });
          expect(await waitForBlock(sql, pid)).toBeGreaterThan(0);
          wire.release();
          expect(await deadline(resolving, "Issuance resolution never completed")).toBe(
            mode === "after-commit" ? "committed" : "not-committed",
          );
          const response = await deadline(requesting, "Request never resolved its commit outcome");
          expect(response.status).toBe(mode === "after-commit" ? 200 : 503);
          expect(server.inbox.list()).toHaveLength(mode === "after-commit" ? 2 : 1);
          if (mode === "after-commit") {
            await issueSetupLink(server);
            expect(
              await server.storage.resolveIssuance({
                messageId: message.messageId,
                email: "alex@example.test",
              }),
            ).toBe("committed");
            expect(
              (await server.request("/auth/confirm", { purpose: "setup", token: old.token }))
                .status,
            ).toBe(400);
          } else {
            expect(
              (await server.request("/auth/confirm", { purpose: "setup", token: old.token }))
                .status,
            ).toBe(200);
          }
        } finally {
          await wire.close();
          await Promise.allSettled([requesting, resolving]);
        }
      },
      { storage: nextReplacement.wrap, inbox: capture.wrap },
    );
  });
}

test("token expiry is rechecked after a demonstrable same-email database lock wait", async () => {
  const nextReplacement = afterNextReplacement();
  await withAuth(
    async ({ open, url, sql, at }) => {
      const wire = await postgresWire(url);
      let replacement: Promise<Response> | undefined;
      let confirming: Promise<Response> | undefined;
      try {
        const server = await open(undefined, wire.url);
        const old = await issueSetupLink(server);
        nextReplacement.arm(() => wire.arm("after-commit"));
        replacement = server.request("/auth/setup", {
          name: "Replacement",
          email: "alex@example.test",
        });
        const pid = await wire.held();
        at(299_999);
        confirming = server.request("/auth/confirm", {
          purpose: "setup",
          token: old.token,
        });
        expect(await waitForBlock(sql, pid)).toBeGreaterThan(0);
        at(300_000);
        wire.release();
        expect((await deadline(replacement, "Replacement did not resolve")).status).toBe(200);
        const response = await deadline(
          confirming,
          "Confirmation did not resolve after lock release",
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ kind: "invalid-link", next: "setup" });
        expect(
          await server.storage.transaction((tx) => tx.userByEmail("alex@example.test")),
        ).toBeNull();
      } finally {
        await wire.close();
        await Promise.allSettled([replacement, confirming]);
      }
    },
    { storage: nextReplacement.wrap },
  );
});
