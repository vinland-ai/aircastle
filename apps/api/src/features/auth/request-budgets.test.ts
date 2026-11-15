import { describe, expect, test } from "vite-plus/test";
import type { AuthLimits } from "@aircastle/core";
import { captureFaults } from "./test-support/faults.ts";
import { browserOrigin, claim, issueSetupLink, start, withAuth } from "./test-support/fixture.ts";

const generous: AuthLimits = {
  email: { fiveMinutes: 100, oneHour: 100 },
  ip: { fiveMinutes: 100, oneHour: 100 },
  global: { fiveMinutes: 100, oneHour: 100 },
};
const setup = { name: "Alex", email: "alex@example.test" };
const headers = {
  host: "localhost:43121",
  origin: browserOrigin,
  "content-type": "application/json",
};

describe("auth request budgets", () => {
  test.each([
    "{",
    "null",
    "[]",
    JSON.stringify({ email: "bad", name: "Alex" }),
    JSON.stringify({ ...setup, role: "super_user" }),
  ])("malformed input %s consumes outer protection without producing mail", async (body) => {
    await withAuth(
      async ({ open }) => {
        const server = await open();
        const malformed = await server.app.request(
          `${browserOrigin}/api/auth/setup`,
          {
            method: "POST",
            headers,
            body,
          },
          { peerAddress: "127.0.0.1" },
        );
        expect(malformed.status).toBe(400);
        expect((await server.request("/auth/setup", setup)).status).toBe(429);
        expect(server.inbox.list()).toEqual([]);
        expect(
          (await server.request("/auth/setup", setup, undefined, {}, "127.0.0.2")).status,
        ).toBe(200);
      },
      {
        limits: {
          ...generous,
          email: { fiveMinutes: 1, oneHour: 1 },
          ip: { fiveMinutes: 1, oneHour: 1 },
        },
      },
    );
  });
  test("recipient rejection spends outer slots and does not replace the existing link", async () => {
    await withAuth(
      async ({ open }) => {
        const server = await open();
        const original = await issueSetupLink(server);
        const rejected = await server.request("/auth/setup", setup);
        expect(rejected.status).toBe(429);
        expect(await rejected.json()).toEqual({ kind: "throttled", retryAt: start + 300_000 });
        expect(rejected.headers.get("retry-after")).toBe("300");
        const other = await server.request("/auth/setup", {
          ...setup,
          email: "other@example.test",
        });
        expect(other.status).toBe(429);
        expect(server.inbox.list()).toEqual([{ mail: original.message, read: false }]);
        const confirmation = await server.request("/auth/confirm", {
          purpose: "setup",
          token: original.token,
        });
        expect(confirmation.status).toBe(200);
      },
      {
        limits: {
          ...generous,
          email: { fiveMinutes: 1, oneHour: 10 },
          ip: { fiveMinutes: 2, oneHour: 10 },
        },
      },
    );
  });
  test("failed capture spends its admitted slot and records a delivery failure", async () => {
    const capture = captureFaults();
    await withAuth(
      async ({ open, events }) => {
        const server = await open();
        capture.fail(true);
        const failure = await server.request("/auth/setup", setup);
        expect(failure.status).toBe(503);
        expect(await failure.json()).toEqual({ kind: "temporary-failure" });
        expect(events).toContainEqual({ kind: "delivery-failed" });
        capture.fail(false);
        expect((await server.request("/auth/setup", setup)).status).toBe(429);
        expect(server.inbox.list()).toEqual([]);
      },
      { limits: { ...generous, email: { fiveMinutes: 1, oneHour: 1 } }, inbox: capture.wrap },
    );
  });
  test("unknown identities spend the same recipient budget without producing email", async () => {
    await withAuth(
      async ({ open, at }) => {
        const server = await open();
        await claim(server);
        at(300_000);
        for (const email of ["missing@example.test", "alex@example.test"]) {
          const first = await server.request("/auth/sign-in", { email });
          expect(first.status).toBe(200);
          expect(await first.json()).toEqual({
            kind: "ok",
            value: { confirmation: "sign-in-inbox" },
          });
          expect(
            (await server.request("/auth/sign-in", { email: ` ${email.toUpperCase()} ` })).status,
          ).toBe(429);
        }
        expect(
          server.inbox.list().filter(({ mail }) => mail.to.includes("missing@example.test")),
        ).toEqual([]);
      },
      { limits: { ...generous, email: { fiveMinutes: 1, oneHour: 10 } } },
    );
  });
  test("state and inbox polling do not spend link-request allowances", async () => {
    await withAuth(
      async ({ open }) => {
        const server = await open();
        for (let index = 0; index < 15; index++) {
          expect((await server.request("/auth/state")).status).toBe(200);
          const inbox = await server.request("/development-inbox/messages");
          expect(inbox.status).toBe(200);
          expect(inbox.headers.get("cache-control")).toContain("no-store");
        }
        expect((await server.request("/auth/setup", setup)).status).toBe(200);
      },
      {
        limits: {
          ...generous,
          ip: { fiveMinutes: 1, oneHour: 1 },
          global: { fiveMinutes: 1, oneHour: 1 },
        },
      },
    );
  });
});
