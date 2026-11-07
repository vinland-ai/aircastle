import { describe, expect, test } from "vite-plus/test";
import pino from "pino";
import type { AuthLimits } from "@aircastle/core";
import { createApp } from "../../app.ts";
import { createLocalAuth } from "./index.ts";
import { dispatched } from "./dispatch.ts";
import { browserOrigin, claim, withAuth } from "./test-support/fixture.ts";

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

describe("local auth HTTP boundaries", () => {
  test("disabled auth exposes configuration state but no inbox or account mutations", async () => {
    const auth = await createLocalAuth({ config: { mode: "disabled" } });
    const app = createApp({ logger: pino({ level: "silent" }), auth });
    try {
      const state = await app.request(`${browserOrigin}/api/auth/state`);
      expect(state.status).toBe(200);
      expect(await state.json()).toEqual({ kind: "ok", value: { kind: "disabled" } });
      for (const path of [
        "/auth/setup",
        "/auth/sign-in",
        "/auth/confirm",
        "/auth/activity",
        "/auth/entry",
      ]) {
        const response = await app.request(`${browserOrigin}/api${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(setup),
        });
        expect(response.status, path).toBe(404);
        expect(response.headers.get("set-cookie")).toBeNull();
      }
      const inbox = await app.request(`${browserOrigin}/api/development-inbox/messages`);
      expect(inbox.status).toBe(404);
      expect(inbox.headers.get("cache-control")).toContain("no-store");
    } finally {
      await auth.close();
    }
  });
  test.each([
    { origin: "https://evil.test" },
    { origin: "null" },
    { host: "evil.test" },
    { host: "localhost.evil.test:43121" },
    { host: "localhost:43122" },
  ])("rejects disallowed request authority %j before admission", async (forged) => {
    await withAuth(
      async (fixture) => {
        const server = await fixture.open();
        for (let index = 0; index < 3; index++)
          expect((await server.request("/auth/setup", setup, undefined, forged)).status).toBe(403);
        expect(server.inbox.list()).toEqual([]);
        expect((await server.request("/auth/setup", setup)).status).toBe(200);
      },
      { limits: { ...generous, ip: { fiveMinutes: 1, oneHour: 1 } } },
    );
  });
  test("an absent Origin cannot be replaced by forwarding headers", async () => {
    await withAuth(async ({ open }) => {
      const server = await open();
      const response = await server.app.request(
        `${browserOrigin}/api/auth/setup`,
        {
          method: "POST",
          headers: {
            host: "localhost:43121",
            "content-type": "application/json",
            "x-forwarded-host": "localhost:43121",
          },
          body: JSON.stringify(setup),
        },
        { peerAddress: "127.0.0.1" },
      );
      expect(response.status).toBe(403);
      expect(server.inbox.list()).toEqual([]);
    });
  });
  test("a missing socket peer cannot be replaced by X-Forwarded-For", async () => {
    await withAuth(async ({ open }) => {
      const server = await open();
      const response = await server.app.request(
        `${browserOrigin}/api/auth/setup`,
        {
          method: "POST",
          headers: { ...headers, "x-forwarded-for": "127.0.0.1" },
          body: JSON.stringify(setup),
        },
        {},
      );
      expect(response.status).toBe(403);
      expect(server.inbox.list()).toEqual([]);
    });
  });
  test("forwarded addresses cannot evade the real peer budget or choose link origins", async () => {
    await withAuth(
      async ({ open, events }) => {
        const server = await open();
        for (let index = 0; index < 3; index++) {
          const response = await server.request(
            "/auth/setup",
            { ...setup, email: `user${index}@example.test` },
            undefined,
            {
              "x-forwarded-for": `203.0.113.${index + 1}`,
              "x-real-ip": `203.0.113.${index + 1}`,
              forwarded: `for=203.0.113.${index + 1};host=evil.test;proto=https`,
              "x-forwarded-host": "evil.test",
              "x-forwarded-proto": "https",
            },
          );
          expect(response.status).toBe(index < 2 ? 200 : 429);
        }
        expect(server.inbox.list()).toHaveLength(2);
        for (const { mail } of server.inbox.list()) {
          expect(mail.text).toContain(`${browserOrigin}/setup?token=`);
          expect(mail.text).not.toContain("evil.test");
        }
        expect(events).toContainEqual({ kind: "request-blocked", scopes: ["ip"] });
      },
      { limits: { ...generous, ip: { fiveMinutes: 2, oneHour: 2 } } },
    );
  });
  test("oversized requests without Content-Length are rejected before spending quota", async () => {
    await withAuth(
      async ({ open }) => {
        const server = await open();
        const response = await server.app.request(
          `${browserOrigin}/api/auth/setup`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ ...setup, name: "a".repeat(2_048) }),
          },
          { peerAddress: "127.0.0.1" },
        );
        expect(response.status).toBe(413);
        expect(server.inbox.list()).toEqual([]);
        expect((await server.request("/auth/setup", setup)).status).toBe(200);
      },
      { limits: { ...generous, ip: { fiveMinutes: 1, oneHour: 1 } }, maxRequestBytes: 1_024 },
    );
  });
  const forgeries = [
    { origin: "https://evil.test" },
    { origin: "null" },
    { host: "evil.test" },
    { host: "localhost.evil.test:43121" },
    { host: "localhost:43122" },
  ];

  test.each(
    dispatched.map(({ method, path }) => [method, path.replace(":id", "message-id")] as const),
  )(
    "%s %s rejects every disallowed Host and Origin before doing any work",
    async (method, path) => {
      await withAuth(async ({ open }) => {
        const server = await open();
        const { cookie } = await claim(server);
        const before = server.inbox.list();
        const variants: Record<string, string>[] = [
          ...forgeries,
          ...(method === "POST" ? [{ origin: "" }] : []),
        ];
        for (const forged of variants) {
          const requestHeaders = new Headers({
            host: "localhost:43121",
            origin: browserOrigin,
            "content-type": "application/json",
            cookie,
          });
          for (const [name, value] of Object.entries(forged))
            if (value === "") requestHeaders.delete(name);
            else requestHeaders.set(name, value);
          const response = await server.app.request(
            `${browserOrigin}${path}`,
            {
              method,
              headers: requestHeaders,
              ...(method === "POST" ? { body: JSON.stringify(setup) } : {}),
            },
            { peerAddress: "127.0.0.1" },
          );
          expect(response.status, JSON.stringify(forged)).toBe(403);
          expect(await response.json(), JSON.stringify(forged)).toEqual({ kind: "forbidden" });
          expect(response.headers.get("set-cookie")).toBeNull();
        }
        expect(server.inbox.list()).toEqual(before);
        expect((await server.request("/auth/session", undefined, cookie)).status).toBe(200);
      });
    },
  );
});
