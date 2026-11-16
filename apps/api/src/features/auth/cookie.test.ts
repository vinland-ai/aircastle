import { expect, test } from "vite-plus/test";
import { claim, credentialCounts, withAuth } from "./test-support/fixture.ts";

const cookieName = (origin: string) => `aircastle_session_${new URL(origin).port}`;

for (const origin of ["http://localhost:43121", "http://127.0.0.1:43130"]) {
  test(`confirmation, renewal and sign-out use one cookie named for ${origin}`, async () => {
    await withAuth(
      async ({ open }) => {
        const server = await open();
        const name = cookieName(origin);
        const { cookie, setCookie } = await claim(server);
        expect(setCookie.startsWith(`${name}=`)).toBe(true);
        expect(setCookie).toMatch(/;\s*Max-Age=1209600(?:;|$)/u);
        expect(setCookie).toMatch(/;\s*Path=\/(?:;|$)/u);
        const renewed = await server.request("/auth/activity", {}, cookie);
        expect(renewed.status).toBe(200);
        expect(renewed.headers.get("set-cookie")?.startsWith(`${name}=`)).toBe(true);
        const signedOut = await server.request("/auth/sign-out", {}, cookie);
        expect(signedOut.headers.get("set-cookie")?.startsWith(`${name}=;`)).toBe(true);
      },
      { browserOrigin: origin },
    );
  });
}

test("a session cookie from another origin's port or signing secret is not accepted", async () => {
  await withAuth(
    async ({ open: openFirst }) => {
      const first = await openFirst();
      const { cookie } = await claim(first);
      const value = cookie.slice(cookie.indexOf("=") + 1);
      await withAuth(
        async ({ open: openSecond }) => {
          const second = await openSecond();
          await claim(second);
          for (const presented of [cookie, `${cookieName("http://localhost:43130")}=${value}`]) {
            const response = await second.request("/auth/session", undefined, presented);
            expect(response.status, presented.split("=")[0]).toBe(401);
          }
        },
        { browserOrigin: "http://localhost:43130" },
      );
    },
    { browserOrigin: "http://localhost:43121" },
  );
});

test("altering an actual issued cookie rejects session access without revoking the original", async () => {
  await withAuth(async ({ open, sql, namespace }) => {
    const server = await open();
    const { cookie } = await claim(server);
    expect((await server.request("/auth/session", undefined, cookie)).status).toBe(200);
    const tampered = cookie.replace(/=(.)/u, (_match, first: string) =>
      first === "a" ? "=b" : "=a",
    );
    expect(tampered).not.toBe(cookie);
    const counts = await credentialCounts(sql, namespace);
    expect(counts).toEqual({ users: 1, sessions: 1 });
    for (const [path, body] of [
      ["/auth/session", undefined],
      ["/auth/activity", {}],
      ["/auth/entry", { kind: "resolve" }],
    ] as const) {
      const response = await server.request(path, body, tampered);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ kind: "unauthenticated" });
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await credentialCounts(sql, namespace)).toEqual(counts);
    }
    expect((await server.request("/auth/session", undefined, cookie)).status).toBe(200);
  });
});
