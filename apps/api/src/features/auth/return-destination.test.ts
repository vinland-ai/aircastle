import { randomUUID } from "node:crypto";
import { expect, test } from "vite-plus/test";
import { claim, confirmedCookie, pendingLink, start, withAuth } from "./test-support/fixture.ts";

const alexSession = {
  user: {
    id: expect.any(String),
    name: "Alex",
    email: "alex@example.test",
    authority: "super_user",
  },
  expiresAt: start + 1_209_600_000,
};

test("setup restores its link-carried authorized destination and skips automatic onboarding", async () => {
  await withAuth(async ({ open }) => {
    const server = await open();
    const destination = { kind: "workspaces" } as const;
    const link = await pendingLink(server, "setup", destination);
    const reopened = await open();
    const confirmed = await reopened.request("/auth/confirm", link);
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual({ kind: "ok", value: { destination } });
    const cookie = confirmedCookie(confirmed);
    const observer = await open();
    const user = await observer.storage.transaction((tx) => tx.userByEmail("alex@example.test"));
    if (!user) throw new Error("Confirmation must persist its user before entry resolution");
    expect(await observer.storage.transaction((tx) => tx.entry(user.id))).toMatchObject({
      onboardingOffered: true,
    });
    const restored = await observer.request("/auth/entry", { kind: "resolve" }, cookie);
    expect(restored.status).toBe(200);
    expect(await restored.json()).toEqual({
      kind: "ok",
      value: { destination, session: alexSession },
    });
    const session = await reopened.request("/auth/session", undefined, cookie);
    expect(session.status).toBe(200);
    const entry = await reopened.request("/auth/entry", { kind: "resolve" }, cookie);
    expect(entry.status).toBe(200);
    expect(await entry.json()).toEqual({
      kind: "ok",
      value: { destination, session: alexSession },
    });
  });
});
for (const revoked of [false, true]) {
  test(`sign-in link destination ${revoked ? "falls back after membership is revoked following preview" : "is restored while membership remains authorized"}`, async () => {
    await withAuth(async ({ open, content, sql, namespace }) => {
      const project = await content.provision({
        verifier: "credential-lifecycle-digest",
        permissions: ["content:read"],
        key: "reuse",
        workspaceName: "Development workspace",
        projectName: "Development project",
      });
      const server = await open();
      const { cookie } = await claim(server);
      const user = await server.storage.transaction((tx) => tx.userByEmail("alex@example.test"));
      if (!user) throw new Error("Setup must persist a user before granting fixture membership");
      await sql`INSERT INTO ${sql(namespace)}.auth_workspace_access (user_id, workspace_id) VALUES (${user.id}, ${project.workspace})`;
      const destination = {
        kind: "project-page",
        workspaceId: project.workspace,
        projectId: project.project,
        page: "collections",
      } as const;
      const before = await server.request("/auth/entry", { kind: "visit", destination }, cookie);
      expect(before.status).toBe(200);
      expect(await before.json()).toEqual({
        kind: "ok",
        value: { destination, session: alexSession },
      });
      const link = await pendingLink(server, "sign-in", destination);
      const preview = await server.request("/auth/confirm/preview", link);
      expect(preview.status).toBe(200);
      expect(await preview.json()).toEqual({
        kind: "ok",
        value: { email: "alex@example.test", purpose: "sign-in" },
      });
      if (revoked)
        await sql`DELETE FROM ${sql(namespace)}.auth_workspace_access WHERE user_id = ${user.id} AND workspace_id = ${project.workspace}`;
      const reopened = await open();
      const confirmed = await reopened.request("/auth/confirm", link);
      expect(confirmed.status).toBe(200);
      expect(await confirmed.json()).toEqual({
        kind: "ok",
        value: { destination: revoked ? { kind: "dashboard" } : destination },
      });
      const signedIn = confirmedCookie(confirmed);
      expect((await reopened.request("/auth/session", undefined, signedIn)).status).toBe(200);
      const visit = await reopened.request("/auth/entry", { kind: "visit", destination }, signedIn);
      expect(visit.status).toBe(revoked ? 403 : 200);
      expect(await visit.json()).toEqual(
        revoked
          ? { kind: "forbidden" }
          : { kind: "ok", value: { destination, session: alexSession } },
      );
    });
  });
}
for (const change of ["delete-workspace", "remove-membership"] as const) {
  test(`a saved remembered workspace falls back on later sign-in after ${change}`, async () => {
    await withAuth(async ({ open, sql, namespace }) => {
      const server = await open();
      const { cookie } = await claim(server);
      const workspaceId = randomUUID();
      const user = await server.storage.transaction((tx) => tx.userByEmail("alex@example.test"));
      if (!user) throw new Error("Setup must persist a user before granting fixture membership");
      await sql`INSERT INTO ${sql(namespace)}.workspaces (id, name) VALUES (${workspaceId}, 'Remembered workspace')`;
      await sql`INSERT INTO ${sql(namespace)}.auth_workspace_access (user_id, workspace_id) VALUES (${user.id}, ${workspaceId})`;
      const destination = { kind: "workspace-projects", workspaceId };
      const visited = await server.request("/auth/entry", { kind: "visit", destination }, cookie);
      expect(visited.status).toBe(200);
      expect(await visited.json()).toEqual({
        kind: "ok",
        value: { destination, session: alexSession },
      });
      const remembered = await server.request("/auth/entry", { kind: "resolve" }, cookie);
      expect(remembered.status).toBe(200);
      expect(await remembered.json()).toEqual({
        kind: "ok",
        value: { destination, session: alexSession },
      });
      if (change === "delete-workspace") {
        await sql`DELETE FROM ${sql(namespace)}.workspaces WHERE id = ${workspaceId}`;
        expect(
          await sql`SELECT id FROM ${sql(namespace)}.workspaces WHERE id = ${workspaceId}`,
        ).toHaveLength(0);
      } else {
        await sql`DELETE FROM ${sql(namespace)}.auth_workspace_access WHERE user_id = ${user.id} AND workspace_id = ${workspaceId}`;
        expect(
          await sql`SELECT id FROM ${sql(namespace)}.workspaces WHERE id = ${workspaceId}`,
        ).toHaveLength(1);
      }
      const link = await pendingLink(server, "sign-in");
      const reopened = await open();
      const confirmed = await reopened.request("/auth/confirm", link);
      expect(confirmed.status).toBe(200);
      expect(await confirmed.json()).toEqual({
        kind: "ok",
        value: { destination: { kind: "dashboard" } },
      });
      const entry = await reopened.request(
        "/auth/entry",
        { kind: "resolve" },
        confirmedCookie(confirmed),
      );
      expect(entry.status).toBe(200);
      expect(await entry.json()).toEqual({
        kind: "ok",
        value: { destination: { kind: "workspaces" }, session: alexSession },
      });
    });
  });
}
for (const purpose of ["setup", "sign-in"] as const) {
  for (const [label, returnTo] of [
    ["external URL", "https://evil.test/steal"],
    ["unsupported destination", { kind: "external", url: "https://evil.test/steal" }],
    [
      "unsupported page name",
      {
        kind: "project-page",
        workspaceId: "00000000-0000-4000-8000-000000000001",
        projectId: "00000000-0000-4000-8000-000000000002",
        page: "unsupported-page",
      },
    ],
  ] as const) {
    test(`${purpose} rejects ${label} returnTo without publishing a link`, async () => {
      await withAuth(async ({ open }) => {
        const server = await open();
        if (purpose === "sign-in") await claim(server);
        const messages = server.inbox.list();
        const response = await server.request(`/auth/${purpose}`, {
          email: "alex@example.test",
          ...(purpose === "setup" ? { name: "Alex" } : {}),
          returnTo,
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ kind: "invalid-input" });
        expect(response.headers.get("set-cookie")).toBeNull();
        expect(server.inbox.list()).toEqual(messages);
        expect((await server.request("/auth/session")).status).toBe(401);
      });
    });
  }
}
