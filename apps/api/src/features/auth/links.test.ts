import type { AuthLinkRecord, AuthUserRecord } from "@aircastle/core";
import { describe, expect, test } from "vite-plus/test";
import { eligibility, linkVerdict } from "./links.ts";

const now = Date.UTC(2026, 0, 1);
const token = "a".repeat(43);
const link = (overrides: Partial<AuthLinkRecord> = {}): AuthLinkRecord => ({
  digest: "digest",
  messageId: "message-1",
  email: "alex@example.test",
  identity: { purpose: "sign-in", userId: "user-1" },
  issuedAt: now - 1_000,
  expiresAt: now + 299_000,
  status: "active",
  returnTo: null,
  ...overrides,
});
const signIn = { purpose: "sign-in" as const, token };
const setupLink = link({ identity: { purpose: "setup", name: "Alex" } });
const setupInput = { purpose: "setup" as const, token };

describe("linkVerdict", () => {
  test("accepts an active, unexpired link redeemed for its own purpose", () => {
    const record = link();
    expect(linkVerdict(signIn, record, "complete", now)).toEqual({ kind: "valid", record });
  });

  test.each([
    ["a malformed body", null, link()],
    ["an unknown token", signIn, null],
    ["the wrong purpose", setupInput, link()],
    ["an expired link", signIn, link({ expiresAt: now - 1 })],
    ["a consumed link", signIn, link({ status: "consumed" })],
    ["an expired superseded link", signIn, link({ status: "superseded", expiresAt: now - 1 })],
  ])("reports %s as invalid", (_label, input, record) => {
    expect(linkVerdict(input, record, "complete", now)).toEqual({
      kind: "failure",
      failure: { kind: "invalid-link", next: "sign-in" },
    });
  });

  test("expires a link at exactly its expiry time", () => {
    expect(linkVerdict(signIn, link({ expiresAt: now + 1 }), "complete", now).kind).toBe("valid");
    expect(linkVerdict(signIn, link({ expiresAt: now }), "complete", now)).toEqual({
      kind: "failure",
      failure: { kind: "invalid-link", next: "sign-in" },
    });
  });

  test("reports an unexpired superseded link as superseded", () => {
    expect(linkVerdict(signIn, link({ status: "superseded" }), "complete", now)).toEqual({
      kind: "failure",
      failure: { kind: "superseded-link", next: "sign-in" },
    });
  });

  test("sends a failed link to setup while setup is open", () => {
    expect(linkVerdict(null, null, "open", now)).toEqual({
      kind: "failure",
      failure: { kind: "invalid-link", next: "setup" },
    });
    expect(linkVerdict(setupInput, { ...setupLink, status: "superseded" }, "open", now)).toEqual({
      kind: "failure",
      failure: { kind: "superseded-link", next: "setup" },
    });
  });

  test("a setup link redeemed after setup completes reports setup complete", () => {
    expect(linkVerdict(setupInput, setupLink, "complete", now)).toEqual({
      kind: "failure",
      failure: { kind: "setup-complete" },
    });
    expect(linkVerdict(setupInput, setupLink, "open", now)).toEqual({
      kind: "valid",
      record: setupLink,
    });
  });
});

describe("eligibility", () => {
  const alex: AuthUserRecord = {
    id: "user-1",
    name: "Alex",
    email: "alex@example.test",
    createdAt: now,
    updatedAt: now,
  };
  const directory = (...users: AuthUserRecord[]) => {
    const lookups: string[] = [];
    return {
      lookups,
      userByEmail: async (email: string) => {
        lookups.push(email);
        return users.find((user) => user.email === email) ?? null;
      },
    };
  };
  const setup = {
    purpose: "setup" as const,
    name: "Alex",
    email: "alex@example.test",
    returnTo: null,
  };
  const signInRequest = { purpose: "sign-in" as const, email: "alex@example.test", returnTo: null };

  test("anyone may request setup while it is open and no initial email is set", async () => {
    const users = directory();
    expect(await eligibility(setup, "open", undefined, users.userByEmail)).toEqual({
      kind: "eligible",
      identity: { purpose: "setup", name: "Alex" },
    });
    expect(users.lookups).toEqual([]);
  });

  test("only the initial email may request setup when one is set", async () => {
    const users = directory();
    expect(await eligibility(setup, "open", "owner@example.test", users.userByEmail)).toEqual({
      kind: "email-not-allowed",
    });
    expect(await eligibility(setup, "open", "alex@example.test", users.userByEmail)).toMatchObject({
      kind: "eligible",
    });
  });

  test("setup cannot be requested again once it is complete", async () => {
    expect(await eligibility(setup, "complete", undefined, directory().userByEmail)).toEqual({
      kind: "setup-complete",
    });
  });

  test("sign-in needs completed setup and looks no one up before it", async () => {
    const users = directory(alex);
    expect(await eligibility(signInRequest, "open", undefined, users.userByEmail)).toEqual({
      kind: "setup-required",
    });
    expect(users.lookups).toEqual([]);
  });

  test("a known email may request sign-in for its account", async () => {
    const users = directory(alex);
    expect(await eligibility(signInRequest, "complete", undefined, users.userByEmail)).toEqual({
      kind: "eligible",
      identity: { purpose: "sign-in", userId: "user-1" },
    });
    expect(users.lookups).toEqual(["alex@example.test"]);
  });

  test("reports an unknown sign-in email as an unknown identity", async () => {
    expect(
      await eligibility(
        { ...signInRequest, email: "missing@example.test" },
        "complete",
        undefined,
        directory(alex).userByEmail,
      ),
    ).toEqual({ kind: "unknown-identity" });
  });
});
