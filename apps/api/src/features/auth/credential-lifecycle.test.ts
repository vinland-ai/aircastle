import { expect, test } from "vite-plus/test";
import {
  claim,
  confirmedCookie,
  credentialCounts,
  pendingLink,
  withAuth,
} from "./test-support/fixture.ts";
import type { AuthFixture } from "./test-support/fixture.ts";

async function waitForContenders(sql: AuthFixture["sql"], blocker: number) {
  const until = Date.now() + 5_000;
  while (Date.now() < until) {
    const [waiting] = await sql<{ contenders: number }[]>`
      WITH RECURSIVE waiters AS (
        SELECT pid FROM pg_stat_activity WHERE ${blocker} = ANY(pg_blocking_pids(pid))
        UNION
        SELECT activity.pid FROM pg_stat_activity AS activity
        JOIN waiters ON waiters.pid = ANY(pg_blocking_pids(activity.pid))
      ) SELECT count(DISTINCT pid)::integer AS contenders FROM waiters`;
    if (waiting?.contenders === 2) return waiting.contenders;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    "Both sign-in confirmations must demonstrably wait before the session gate opens",
  );
}

test("a pending sign-in link cannot authenticate or recreate its deleted user", async () => {
  await withAuth(async ({ open, sql, namespace }) => {
    const server = await open();
    await claim(server);
    const link = await pendingLink(server, "sign-in");
    const preview = await server.request("/auth/confirm/preview", link);
    expect(preview.status).toBe(200);
    expect(await preview.json()).toEqual({
      kind: "ok",
      value: { email: "alex@example.test", purpose: "sign-in" },
    });
    const user = await server.storage.transaction((tx) => tx.userByEmail("alex@example.test"));
    if (!user) throw new Error("Setup must persist the user before deletion");
    await sql`DELETE FROM ${sql(namespace)}.auth_users WHERE id = ${user.id}`;
    const counts = await credentialCounts(sql, namespace);
    expect(counts.users).toBe(0);
    const sessions = await sql`SELECT id FROM ${sql(namespace)}.auth_sessions ORDER BY id`;
    const confirmed = await server.request("/auth/confirm", link);
    expect(confirmed.status).toBe(400);
    expect(await confirmed.json()).toEqual({ kind: "invalid-link", next: "sign-in" });
    expect(confirmed.headers.get("set-cookie")).toBeNull();
    expect(await credentialCounts(sql, namespace)).toEqual(counts);
    expect(await server.storage.transaction((tx) => tx.userById(user.id))).toBeNull();
    expect(
      await server.storage.transaction((tx) => tx.userByEmail("alex@example.test")),
    ).toBeNull();
    expect(await sql`SELECT id FROM ${sql(namespace)}.auth_sessions ORDER BY id`).toEqual(sessions);
    expect((await server.request("/auth/session")).status).toBe(401);
    expect(await (await server.request("/auth/state")).json()).toEqual({
      kind: "ok",
      value: { kind: "signed-out" },
    });
  });
});
test("a sign-in token rejected as setup remains usable for sign-in", async () => {
  await withAuth(async ({ open, sql, namespace }) => {
    const server = await open();
    await claim(server);
    const user = await server.storage.transaction((tx) => tx.userByEmail("alex@example.test"));
    if (!user) throw new Error("Setup must persist the user before issuing a sign-in link");
    const link = await pendingLink(server, "sign-in");
    const counts = await credentialCounts(sql, namespace);
    expect(counts).toEqual({ users: 1, sessions: 1 });
    const sessions = await sql`SELECT id FROM ${sql(namespace)}.auth_sessions ORDER BY id`;
    const wrong = await server.request("/auth/confirm", { ...link, purpose: "setup" });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ kind: "invalid-link", next: "sign-in" });
    expect(wrong.headers.get("set-cookie")).toBeNull();
    expect(await credentialCounts(sql, namespace)).toEqual(counts);
    expect(await sql`SELECT id FROM ${sql(namespace)}.auth_sessions ORDER BY id`).toEqual(sessions);
    const preview = await server.request("/auth/confirm/preview", link);
    expect(preview.status).toBe(200);
    expect(await preview.json()).toEqual({
      kind: "ok",
      value: { email: "alex@example.test", purpose: "sign-in" },
    });
    const confirmed = await server.request("/auth/confirm", link);
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual({
      kind: "ok",
      value: { destination: { kind: "dashboard" } },
    });
    const session = await server.request("/auth/session", undefined, confirmedCookie(confirmed));
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({
      kind: "ok",
      value: {
        user: {
          id: user.id,
          name: "Alex",
          email: "alex@example.test",
          authority: "super_user",
        },
      },
    });
  });
});
for (const elapsed of [299_999, 300_000]) {
  test(`sign-in token expires strictly 300 seconds after its issuance at ${elapsed} milliseconds`, async () => {
    await withAuth(async ({ open, at, sql, namespace }) => {
      const server = await open();
      await claim(server);
      at(10_000);
      const link = await pendingLink(server, "sign-in");
      const counts = await credentialCounts(sql, namespace);
      expect(counts).toEqual({ users: 1, sessions: 1 });
      at(10_000 + elapsed);
      const confirmed = await server.request("/auth/confirm", link);
      expect(confirmed.status).toBe(elapsed < 300_000 ? 200 : 400);
      if (elapsed < 300_000) {
        expect(await confirmed.json()).toEqual({
          kind: "ok",
          value: { destination: { kind: "dashboard" } },
        });
        const cookie = confirmedCookie(confirmed);
        expect((await server.request("/auth/session", undefined, cookie)).status).toBe(200);
        expect(await credentialCounts(sql, namespace)).toEqual({ users: 1, sessions: 2 });
      } else {
        expect(await confirmed.json()).toEqual({ kind: "invalid-link", next: "sign-in" });
        expect(confirmed.headers.get("set-cookie")).toBeNull();
        expect(await credentialCounts(sql, namespace)).toEqual(counts);
      }
    });
  });
}
test("replaying a consumed sign-in token cannot create another user, session or cookie", async () => {
  await withAuth(async ({ open, sql, namespace }) => {
    const server = await open();
    await claim(server);
    const link = await pendingLink(server, "sign-in");
    const confirmed = await server.request("/auth/confirm", link);
    expect(confirmed.status).toBe(200);
    const cookie = confirmedCookie(confirmed);
    expect((await server.request("/auth/session", undefined, cookie)).status).toBe(200);
    const counts = await credentialCounts(sql, namespace);
    expect(counts).toEqual({ users: 1, sessions: 2 });
    const reopened = await open();
    const replay = await reopened.request("/auth/confirm", link);
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({ kind: "invalid-link", next: "sign-in" });
    expect(replay.headers.get("set-cookie")).toBeNull();
    expect(await credentialCounts(sql, namespace)).toEqual(counts);
    expect((await reopened.request("/auth/session", undefined, cookie)).status).toBe(200);
  });
});
test("concurrent redemption of one sign-in token commits exactly one new session", async () => {
  await withAuth(async ({ open, sql, namespace }) => {
    const first = await open();
    await claim(first);
    const link = await pendingLink(first, "sign-in");
    const second = await open();
    expect(await credentialCounts(sql, namespace)).toEqual({ users: 1, sessions: 1 });
    const confirmations: Promise<Response>[] = [];
    let responses: Response[];
    try {
      await sql.begin(async (tx) => {
        await tx`LOCK TABLE ${tx(namespace)}.auth_sessions IN SHARE MODE`;
        const [backend] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        if (!backend) throw new Error("Session gate must have a Postgres backend identity");
        confirmations.push(
          ...[first, second].map((server) => server.request("/auth/confirm", link)),
        );
        expect(await waitForContenders(sql, backend.pid)).toBe(2);
        expect(await credentialCounts(sql, namespace)).toEqual({ users: 1, sessions: 1 });
      });
      responses = await Promise.all(confirmations);
    } finally {
      await Promise.allSettled(confirmations);
    }
    expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([200, 400]);
    for (const response of responses) {
      if (response.status === 200) {
        expect(await response.json()).toEqual({
          kind: "ok",
          value: { destination: { kind: "dashboard" } },
        });
        const cookie = confirmedCookie(response);
        expect((await first.request("/auth/session", undefined, cookie)).status).toBe(200);
      } else {
        expect(await response.json()).toEqual({ kind: "invalid-link", next: "sign-in" });
        expect(response.headers.get("set-cookie")).toBeNull();
      }
    }
    expect(await credentialCounts(sql, namespace)).toEqual({ users: 1, sessions: 2 });
  });
}, 15_000);
test("replacement invalidates the old sign-in token, expiry takes precedence, and the newest stays usable", async () => {
  await withAuth(async ({ open, at, sql, namespace }) => {
    const server = await open();
    await claim(server);
    at(10_000);
    const old = await pendingLink(server, "sign-in");
    at(11_000);
    const latest = await pendingLink(server, "sign-in");
    expect(latest.token).not.toBe(old.token);
    const counts = await credentialCounts(sql, namespace);
    expect(counts).toEqual({ users: 1, sessions: 1 });
    const superseded = await server.request("/auth/confirm", old);
    expect(superseded.status).toBe(400);
    expect(await superseded.json()).toEqual({ kind: "superseded-link", next: "sign-in" });
    expect(superseded.headers.get("set-cookie")).toBeNull();
    expect(await credentialCounts(sql, namespace)).toEqual(counts);
    at(310_000);
    const expired = await server.request("/auth/confirm", old);
    expect(expired.status).toBe(400);
    expect(await expired.json()).toEqual({ kind: "invalid-link", next: "sign-in" });
    expect(expired.headers.get("set-cookie")).toBeNull();
    expect(await credentialCounts(sql, namespace)).toEqual(counts);
    const confirmed = await server.request("/auth/confirm", latest);
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual({
      kind: "ok",
      value: { destination: { kind: "dashboard" } },
    });
    const cookie = confirmedCookie(confirmed);
    expect((await server.request("/auth/session", undefined, cookie)).status).toBe(200);
    expect(await credentialCounts(sql, namespace)).toEqual({ users: 1, sessions: 2 });
  });
});
