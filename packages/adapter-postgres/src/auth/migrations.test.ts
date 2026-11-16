import { createHash } from "node:crypto";
import { expect, test } from "vite-plus/test";
import { postgresAdapter, postgresAuthAdmission, postgresAuthStore } from "../index.ts";
import { withDatabase } from "../test-support/database.ts";
import { withStore } from "../test-support/auth-store.ts";

test("auth initialization adds its own ledger and leaves the content migrations as they are", async () => {
  await withStore(async ({ auth, sql, namespace, store }) => {
    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = ${namespace}`;
    expect(tables.map((table) => table.table_name)).toContain("auth_migrations");
    expect(await sql`SELECT version FROM ${sql(namespace)}.migrations ORDER BY version`).toEqual([
      { version: 1 },
      { version: 2 },
    ]);
    await store.initialize();
    expect(await auth.signingSecret()).toMatch(/^.{32,}$/u);
  });
});

test("auth can initialize first and content can initialize afterwards", async () => {
  await withDatabase(async ({ url, namespace, store, sql }) => {
    const auth = await postgresAuthStore({ url, namespace });
    try {
      const rows = await sql<
        { exists: boolean }[]
      >`SELECT to_regnamespace(${namespace}) IS NOT NULL AS exists`;
      expect(rows[0]?.exists).toBe(true);
      await store.initialize();
      expect(await sql`SELECT version FROM ${sql(namespace)}.migrations ORDER BY version`).toEqual([
        { version: 1 },
        { version: 2 },
      ]);
      expect(await auth.signingSecret()).toMatch(/^.{32,}$/u);
    } finally {
      await auth.close();
    }
  });
});

test("a version 1 auth namespace gains request admission storage on upgrade", async () => {
  await withDatabase(async ({ store, sql, namespace, url }) => {
    await store.initialize();
    await (await postgresAuthStore({ url, namespace })).close();
    await sql`DROP TABLE ${sql(namespace)}.auth_admission_events`;
    await sql`DROP TABLE ${sql(namespace)}.auth_admission_policy`;
    await sql`DELETE FROM ${sql(namespace)}.auth_migrations WHERE version = 2`;
    const admission = await postgresAuthAdmission({
      url,
      namespace,
      limits: {
        email: { fiveMinutes: 5, oneHour: 20 },
        ip: { fiveMinutes: 10, oneHour: 30 },
        global: { fiveMinutes: 30, oneHour: 100 },
      },
    });
    try {
      expect(await admission.admit({ source: "127.0.0.1" })).toEqual({ kind: "admitted" });
    } finally {
      await admission.close();
    }
    expect(
      await sql`SELECT version FROM ${sql(namespace)}.auth_migrations ORDER BY version`,
    ).toEqual([{ version: 1 }, { version: 2 }]);
  });
});

test("auth refuses unknown future auth migration versions", async () => {
  await withDatabase(async ({ store, sql, namespace, url }) => {
    await store.initialize();
    await sql`CREATE TABLE ${sql(namespace)}.auth_migrations (version integer PRIMARY KEY)`;
    await sql`INSERT INTO ${sql(namespace)}.auth_migrations VALUES (999)`;
    let opened: Awaited<ReturnType<typeof postgresAuthStore>> | undefined;
    try {
      await expect(
        (async () => {
          opened = await postgresAuthStore({ url, namespace });
        })(),
      ).rejects.toBeInstanceOf(Error);
      expect(await sql`SELECT version FROM ${sql(namespace)}.auth_migrations`).toEqual([
        { version: 999 },
      ]);
    } finally {
      await opened?.close();
    }
  });
});

test("auth refuses to adopt a foreign populated namespace", async () => {
  await withDatabase(async ({ sql, namespace, url }) => {
    await sql`CREATE SCHEMA ${sql(namespace)}`;
    await sql`CREATE TABLE ${sql(namespace)}.foreign_data (value text)`;
    await sql`INSERT INTO ${sql(namespace)}.foreign_data VALUES ('keep')`;
    let opened: Awaited<ReturnType<typeof postgresAuthStore>> | undefined;
    try {
      await expect(
        (async () => {
          opened = await postgresAuthStore({ url, namespace });
        })(),
      ).rejects.toBeInstanceOf(Error);
      expect(await sql`SELECT value FROM ${sql(namespace)}.foreign_data`).toEqual([
        { value: "keep" },
      ]);
    } finally {
      await opened?.close();
    }
  });
});

test("auth initialization preserves existing content, contracts and API-key permissions", async () => {
  await withDatabase(async ({ url, namespace, store }) => {
    await store.initialize();
    const verifier = createHash("sha256").update("content-fixture-key").digest("hex");
    const project = await store.provision({
      verifier,
      permissions: ["content:read"],
      key: "reuse",
      workspaceName: "Development workspace",
      projectName: "Development project",
    });
    const description = {
      fields: { title: { type: "text" as const, required: true, nullable: false, unique: false } },
    };
    const contract = `v1:${"1".repeat(64)}`;
    await store.transaction(project.project, (tx) =>
      tx.activate([{ name: "articles", description }], {
        revision: "before-auth",
        contracts: { articles: contract },
      }),
    );
    const saved = await store.transaction(project.project, (tx) =>
      tx.insert("articles", { title: "old content" }, []),
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error("Content control must persist before auth initialization");
    const auth = await postgresAuthStore({ url, namespace });
    const reopened = postgresAdapter({ url, namespace });
    try {
      await reopened.initialize();
      expect(
        await reopened.transaction(project.project, (tx) => tx.read("articles", saved.data.id)),
      ).toEqual({ id: saved.data.id, title: "old content" });
      expect(await reopened.transaction(project.project, (tx) => tx.contract(contract))).toEqual(
        description,
      );
      expect(await reopened.authorize(project.project, verifier, "content:read")).toBe(
        "authorized",
      );
      expect(await reopened.authorize(project.project, verifier, "content:write")).toBe(
        "forbidden",
      );
      expect((await reopened.transaction(project.project, (tx) => tx.state())).revision).toBe(
        "before-auth",
      );
      expect(await auth.signingSecret()).toMatch(/^.{32,}$/u);
    } finally {
      await auth.close();
      await reopened.close();
    }
  });
});
