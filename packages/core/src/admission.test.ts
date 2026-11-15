import { describe, expect, test } from "vite-plus/test";
import { admissionRetention, decideAdmission } from "./index.ts";
import type { AuthLimits } from "./index.ts";

const minute = 60_000;
const fiveMinutes = 5 * minute;
const oneHour = 60 * minute;
const now = Date.UTC(2026, 0, 1, 12);

const roomy: AuthLimits = {
  email: { fiveMinutes: 100, oneHour: 100 },
  ip: { fiveMinutes: 100, oneHour: 100 },
  global: { fiveMinutes: 100, oneHour: 100 },
};
const limited = (overrides: Partial<AuthLimits>): AuthLimits => ({ ...roomy, ...overrides });
const ago = (...offsets: number[]) => offsets.map((offset) => now - offset);

describe("decideAdmission", () => {
  test("admits a request with an email and charges every scope", () => {
    expect(decideAdmission({ ip: [], global: [], email: [] }, roomy, now)).toEqual({
      charge: ["ip", "global", "email"],
      admission: { kind: "admitted" },
    });
  });

  test("admits a request without an email and charges only IP and global", () => {
    expect(decideAdmission({ ip: [], global: [] }, roomy, now)).toEqual({
      charge: ["ip", "global"],
      admission: { kind: "admitted" },
    });
  });

  test("admits the last request a window allows", () => {
    const limits = limited({ ip: { fiveMinutes: 3, oneHour: 100 } });
    expect(decideAdmission({ ip: ago(1_000, 2_000), global: [] }, limits, now).admission).toEqual({
      kind: "admitted",
    });
  });

  test("rejects a full IP window uncharged and retries when its oldest counted admission ages out", () => {
    const limits = limited({ ip: { fiveMinutes: 2, oneHour: 100 } });
    expect(
      decideAdmission(
        { ip: ago(4 * minute, 3 * minute, minute), global: [], email: [] },
        limits,
        now,
      ),
    ).toEqual({
      charge: [],
      admission: { kind: "throttled", retryAt: now - 3 * minute + fiveMinutes, scopes: ["ip"] },
    });
  });

  test("names every full outer scope", () => {
    const limits = limited({
      ip: { fiveMinutes: 1, oneHour: 100 },
      global: { fiveMinutes: 100, oneHour: 1 },
    });
    expect(decideAdmission({ ip: ago(minute), global: ago(30 * minute) }, limits, now)).toEqual({
      charge: [],
      admission: {
        kind: "throttled",
        retryAt: now - 30 * minute + oneHour,
        scopes: ["ip", "global"],
      },
    });
  });

  test("stops counting an admission exactly one window old", () => {
    const limits = limited({ ip: { fiveMinutes: 1, oneHour: 100 } });
    expect(decideAdmission({ ip: ago(fiveMinutes), global: [] }, limits, now).admission).toEqual({
      kind: "admitted",
    });
    expect(
      decideAdmission({ ip: ago(fiveMinutes - 1), global: [] }, limits, now).admission,
    ).toEqual({ kind: "throttled", retryAt: now + 1, scopes: ["ip"] });
  });

  test("waits for the later window when both windows of a scope are full", () => {
    const limits = limited({ global: { fiveMinutes: 1, oneHour: 2 } });
    expect(
      decideAdmission({ ip: [], global: ago(40 * minute, minute) }, limits, now).admission,
    ).toEqual({ kind: "throttled", retryAt: now - 40 * minute + oneHour, scopes: ["global"] });
  });

  test("rejects a full email window after charging IP and global", () => {
    const limits = limited({ email: { fiveMinutes: 1, oneHour: 100 } });
    expect(decideAdmission({ ip: [], global: [], email: ago(2 * minute) }, limits, now)).toEqual({
      charge: ["ip", "global"],
      admission: { kind: "throttled", retryAt: now - 2 * minute + fiveMinutes, scopes: ["email"] },
    });
  });

  test("an email rejection waits for an outer window that its own charge filled", () => {
    const limits = limited({
      email: { fiveMinutes: 1, oneHour: 100 },
      ip: { fiveMinutes: 100, oneHour: 2 },
    });
    expect(
      decideAdmission({ ip: ago(1_000), global: ago(1_000), email: ago(1_000) }, limits, now),
    ).toEqual({
      charge: ["ip", "global"],
      admission: { kind: "throttled", retryAt: now - 1_000 + oneHour, scopes: ["email"] },
    });
  });

  test("an outer rejection also waits for a full email window", () => {
    const limits = limited({
      email: { fiveMinutes: 100, oneHour: 1 },
      ip: { fiveMinutes: 1, oneHour: 100 },
    });
    expect(
      decideAdmission({ ip: ago(minute), global: [], email: ago(20 * minute) }, limits, now),
    ).toEqual({
      charge: [],
      admission: { kind: "throttled", retryAt: now - 20 * minute + oneHour, scopes: ["ip"] },
    });
  });

  test("keeps admissions for the longest window", () => {
    expect(admissionRetention).toBe(oneHour);
  });
});
