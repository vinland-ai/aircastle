import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "vite-plus/test";
import { captureFaults, storageFaults } from "./test-support/faults.ts";
import {
  claim,
  credentialCounts,
  issueSetupLink,
  start,
  withAuth,
} from "./test-support/fixture.ts";

test("capture preparation failure preserves the previous link and publishes no replacement", async () => {
  const capture = captureFaults();
  await withAuth(
    async ({ open }) => {
      const server = await open();
      const old = await issueSetupLink(server);
      const before = server.inbox.list();
      capture.fail(true);
      const failed = await server.request("/auth/setup", {
        name: "Replacement",
        email: "alex@example.test",
      });
      expect(failed.status).toBe(503);
      expect(await failed.json()).toEqual({ kind: "temporary-failure" });
      expect(server.inbox.list()).toEqual(before);
      capture.fail(false);
      expect(
        (await server.request("/auth/confirm", { purpose: "setup", token: old.token })).status,
      ).toBe(200);
    },
    { inbox: capture.wrap },
  );
});

for (const fault of ["replacement", "commit"] as const) {
  test(`${fault} rollback preserves the previous active link and aborts capture`, async () => {
    const faults = storageFaults();
    await withAuth(
      async ({ open }) => {
        const server = await open();
        const old = await issueSetupLink(server);
        const before = server.inbox.list();
        faults.inject(fault);
        const response = await server.request("/auth/setup", {
          name: "Replacement",
          email: "alex@example.test",
        });
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ kind: "temporary-failure" });
        expect(server.inbox.list()).toEqual(before);
        faults.inject("none");
        expect(
          (await server.request("/auth/confirm", { purpose: "setup", token: old.token })).status,
        ).toBe(200);
      },
      { storage: faults.wrap },
    );
  });
}

test("session-write failure rolls back the setup user, marker and token consumption together", async () => {
  const faults = storageFaults();
  await withAuth(
    async ({ open }) => {
      const server = await open();
      const link = await issueSetupLink(server);
      faults.inject("session");
      const response = await server.request("/auth/confirm", {
        purpose: "setup",
        token: link.token,
      });
      expect(response.status).toBe(503);
      expect(response.headers.get("set-cookie")).toBeNull();
      faults.inject("none");
      expect(
        await server.storage.transaction((tx) => tx.userByEmail("alex@example.test")),
      ).toBeNull();
      expect(await server.storage.transaction((tx) => tx.lockSetupClaim())).toBe("open");
      const other = await open();
      expect(
        await other.storage.transaction((tx) => tx.userByEmail("alex@example.test")),
      ).toBeNull();
      expect(
        (await other.request("/auth/confirm", { purpose: "setup", token: link.token })).status,
      ).toBe(200);
    },
    { storage: faults.wrap },
  );
});

test("unknown commit acknowledgment resolves the durable issuance before publishing", async () => {
  const faults = storageFaults();
  await withAuth(
    async ({ open }) => {
      const server = await open();
      const old = await issueSetupLink(server);
      faults.inject("ack");
      const response = await server.request("/auth/setup", {
        name: "Replacement",
        email: "alex@example.test",
      });
      faults.inject("none");
      expect(response.status).toBe(200);
      expect(server.inbox.list()).toHaveLength(2);
      const latest = server.inbox.list()[0]?.mail;
      expect(latest).toBeDefined();
      if (!latest) throw new Error("Committed replacement must publish");
      expect(
        await server.storage.resolveIssuance({
          messageId: latest.messageId,
          email: "alex@example.test",
        }),
      ).toBe("committed");
      const replay = await server.request("/auth/confirm", { purpose: "setup", token: old.token });
      expect(replay.status).toBe(400);
      expect(await replay.json()).toEqual({ kind: "superseded-link", next: "setup" });
    },
    { storage: faults.wrap },
  );
});

test("discarding a successful response retains the inbox replacement and its durable marker", async () => {
  await withAuth(async ({ open }) => {
    const server = await open();
    const old = await issueSetupLink(server);
    await server.request("/auth/setup", { name: "Replacement", email: "alex@example.test" });
    const latest = server.inbox.list()[0]?.mail;
    expect(latest?.messageId).not.toBe(old.message.messageId);
    if (!latest) throw new Error("Successful replacement must remain readable after response loss");
    expect(
      await server.storage.resolveIssuance({
        messageId: latest.messageId,
        email: "alex@example.test",
      }),
    ).toBe("committed");
    expect(
      (await server.request("/auth/confirm", { purpose: "setup", token: old.token })).status,
    ).toBe(400);
  });
});

test("healthy control still completes setup after a recovered capture fault", async () => {
  const capture = captureFaults();
  await withAuth(
    async ({ open }) => {
      const server = await open();
      capture.fail(true);
      expect(
        (await server.request("/auth/setup", { name: "Alex", email: "alex@example.test" })).status,
      ).toBe(503);
      capture.fail(false);
      const { cookie } = await claim(server);
      expect((await server.request("/auth/session", undefined, cookie)).status).toBe(200);
    },
    { inbox: capture.wrap },
  );
});

for (const scenario of [
  { purpose: "setup", setup: "open", next: "setup" },
  { purpose: "sign-in", setup: "open", next: "setup" },
  { purpose: "sign-in", setup: "complete", next: "sign-in" },
] as const) {
  test(`failed ${scenario.purpose} consumption sends the browser to ${scenario.next} with setup ${scenario.setup}`, async () => {
    let rejectConsumption = true;
    let consumptionAttempts = 0;
    await withAuth(
      async ({ open, sql, namespace }) => {
        const server = await open();
        const token = "a".repeat(43);
        const digest = createHash("sha256").update(token).digest("hex");
        await server.storage.transaction(async (tx) => {
          await tx.lockSetupClaim();
          await tx.lockEmail("alex@example.test");
          const user = {
            id: randomUUID(),
            name: "Alex",
            email: "alex@example.test",
            createdAt: start,
            updatedAt: start,
          };
          if (scenario.purpose === "sign-in") await tx.insertUser(user);
          if (scenario.setup === "complete") await tx.completeSetup(user.id);
          await tx.replaceLink({
            digest,
            messageId: randomUUID(),
            email: user.email,
            identity:
              scenario.purpose === "setup"
                ? { purpose: "setup", name: user.name }
                : { purpose: "sign-in", userId: user.id },
            issuedAt: start,
            expiresAt: start + 300_000,
            status: "active",
            returnTo: null,
          });
        });
        const input = { purpose: scenario.purpose, token };
        expect((await server.request("/auth/confirm/preview", input)).status).toBe(200);
        const before = await credentialCounts(sql, namespace);
        const failed = await server.request("/auth/confirm", input);
        expect(consumptionAttempts).toBe(1);
        expect(failed.status).toBe(400);
        expect(await failed.json()).toEqual({ kind: "invalid-link", next: scenario.next });
        expect(failed.headers.get("set-cookie")).toBeNull();
        expect(await credentialCounts(sql, namespace)).toEqual(before);
        expect(await server.storage.transaction((tx) => tx.setupState())).toBe(scenario.setup);
        expect(await server.storage.transaction((tx) => tx.link(digest))).toMatchObject({
          status: "active",
        });
        const invalid = await server.request("/auth/confirm", { ...input, token: "b".repeat(43) });
        expect(await invalid.json()).toEqual({ kind: "invalid-link", next: scenario.next });
        rejectConsumption = false;
        expect((await server.request("/auth/confirm", input)).status).toBe(200);
        expect(await credentialCounts(sql, namespace)).toEqual({ users: 1, sessions: 1 });
      },
      {
        storage: (store) => ({
          ...store,
          transaction: (work) =>
            store.transaction((tx) =>
              work({
                ...tx,
                consumeLink: async (digest) => {
                  consumptionAttempts += 1;
                  return rejectConsumption ? false : tx.consumeLink(digest);
                },
              }),
            ),
        }),
      },
    );
  });
}
