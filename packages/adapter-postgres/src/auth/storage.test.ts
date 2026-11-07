import { createHash } from "node:crypto";
import { expect, test } from "vite-plus/test";
import { postgresAuthStore } from "../index.ts";
import { withStore } from "../test-support/auth-store.ts";

test("repeat and concurrent initialization retain one signing secret", async () => {
  await withStore(async ({ url, namespace, auth }) => {
    const secret = await auth.signingSecret();
    expect(secret.length).toBeGreaterThanOrEqual(32);
    const others = await Promise.all(
      Array.from({ length: 4 }, () => postgresAuthStore({ url, namespace })),
    );
    try {
      expect(await Promise.all(others.map((store) => store.signingSecret()))).toEqual(
        Array(4).fill(secret),
      );
    } finally {
      await Promise.all(others.map((store) => store.close()));
    }
  });
});

test("signing material persists across closing and reopening storage", async () => {
  await withStore(async ({ auth, url, namespace }) => {
    const secret = await auth.signingSecret();
    expect(secret.length).toBeGreaterThanOrEqual(32);
    await auth.close();
    const reopened = await postgresAuthStore({ url, namespace });
    try {
      expect(await reopened.signingSecret()).toBe(secret);
    } finally {
      await reopened.close();
    }
  });
});

test("different namespaces never share signing material", async () => {
  await withStore(async ({ auth }) => {
    await withStore(async ({ auth: other }) => {
      const secret = await auth.signingSecret();
      expect(secret).not.toBe(await other.signingSecret());
    });
  });
});

test("auth users and sessions keep only the columns Aircastle reads", async () => {
  await withStore(async ({ sql, namespace }) => {
    const columns = async (table: string) =>
      (
        await sql<{ column_name: string }[]>`
          SELECT column_name FROM information_schema.columns
          WHERE table_schema = ${namespace} AND table_name = ${table} ORDER BY ordinal_position`
      ).map((row) => row.column_name);
    expect(await columns("auth_users")).toEqual([
      "id",
      "name",
      "email",
      "created_at",
      "updated_at",
      "onboarding_offered",
      "last_workspace_id",
    ]);
    expect(await columns("auth_sessions")).toEqual([
      "id",
      "user_id",
      "token_digest",
      "expires_at",
      "created_at",
      "updated_at",
    ]);
  });
});

test("a session is stored and found by its token digest", async () => {
  await withStore(async ({ auth }) => {
    const user = {
      id: "user-1",
      name: "Alex",
      email: "alex@example.test",
      createdAt: 1,
      updatedAt: 1,
    };
    const session = {
      id: "session-1",
      userId: user.id,
      tokenDigest: createHash("sha256").update("bearer").digest("hex"),
      expiresAt: 10,
      createdAt: 1,
      updatedAt: 1,
    };
    await auth.transaction(async (tx) => {
      expect(await tx.insertUser(user)).toEqual(user);
      expect(await tx.insertSession(session)).toEqual(session);
    });
    expect(await auth.transaction((tx) => tx.session(session.tokenDigest))).toEqual(session);
    expect(await auth.transaction((tx) => tx.session("bearer"))).toBeNull();
  });
});

test("reading setup state does not wait for a held setup claim lock", async () => {
  await withStore(async ({ auth }) => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => {};
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const claim = auth.transaction(async (tx) => {
      expect(await tx.lockSetupClaim()).toBe("open");
      locked();
      await held;
    });
    try {
      await lockTaken;
      const read = auth.transaction((tx) => tx.setupState());
      const outcome = await Promise.race([
        read,
        new Promise((resolve) => setTimeout(() => resolve("blocked"), 2_000)),
      ]);
      expect(outcome).toBe("open");
    } finally {
      release();
      await claim;
    }
  });
});
