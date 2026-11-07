import { describe, expect, test } from "vite-plus/test";
import type { AuthLimitScope } from "@aircastle/core";
import { defaults, generous, request, start, withAdmission } from "../test-support/admission.ts";

describe("durable auth request admission", () => {
  test.each<AuthLimitScope>(["email", "ip", "global"])(
    "%s enforces the approved five-minute ceiling",
    async (scope) => {
      await withAdmission(async ({ open }) => {
        const admission = await open({ ...generous, [scope]: defaults[scope] });
        for (let index = 0; index < defaults[scope].fiveMinutes; index++)
          expect(await admission.admit(request)).toEqual({ kind: "admitted" });
        expect(await admission.admit(request)).toEqual({
          kind: "throttled",
          retryAt: start + 300_000,
          scopes: [scope],
        });
      });
    },
  );

  test.each<AuthLimitScope>(["email", "ip", "global"])(
    "%s enforces the approved hour ceiling even when the five-minute window has emptied",
    async (scope) => {
      await withAdmission(async ({ open, at }) => {
        const admission = await open({ ...generous, [scope]: defaults[scope] });
        const count = defaults[scope].oneHour;
        for (let index = 0; index < count; index++) {
          at(Math.floor(index / defaults[scope].fiveMinutes) * 300_000);
          expect(await admission.admit(request)).toEqual({ kind: "admitted" });
        }
        at(1_500_000);
        expect(await admission.admit(request)).toEqual({
          kind: "throttled",
          retryAt: start + 3_600_000,
          scopes: [scope],
        });
        at(3_600_000);
        expect(await admission.admit(request)).toEqual({ kind: "admitted" });
      });
    },
  );

  test("rolling windows expire individual admissions at the exact boundary", async () => {
    await withAdmission(async ({ open, at }) => {
      const admission = await open();
      for (const time of [0, 10_000, 20_000, 30_000, 40_000]) {
        at(time);
        expect(await admission.admit(request)).toEqual({ kind: "admitted" });
      }
      at(299_999);
      expect(await admission.admit(request)).toMatchObject({
        kind: "throttled",
        retryAt: start + 300_000,
      });
      at(300_000);
      expect(await admission.admit(request)).toEqual({ kind: "admitted" });
      at(300_001);
      expect(await admission.admit(request)).toMatchObject({
        kind: "throttled",
        retryAt: start + 310_000,
      });
    });
  });

  test("email-throttled and malformed requests consume admitted outer slots only", async () => {
    await withAdmission(async ({ open }) => {
      const admission = await open({
        ...generous,
        email: { fiveMinutes: 1, oneHour: 1 },
        ip: { fiveMinutes: 4, oneHour: 4 },
      });
      expect(await admission.admit(request)).toEqual({ kind: "admitted" });
      expect(await admission.admit(request)).toMatchObject({
        kind: "throttled",
        scopes: ["email"],
      });
      expect(await admission.admit({ source: request.source })).toEqual({ kind: "admitted" });
      expect(await admission.admit(request)).toMatchObject({
        kind: "throttled",
        scopes: ["email"],
      });
      expect(await admission.admit({ ...request, email: "other@example.test" })).toMatchObject({
        kind: "throttled",
        scopes: ["ip"],
      });
      expect(await admission.admit({ source: "127.0.0.2", email: "other@example.test" })).toEqual({
        kind: "admitted",
      });
    });
  });

  test("outer rejection neither consumes installation budget nor prolongs a cooldown", async () => {
    await withAdmission(async ({ open, at }) => {
      const admission = await open({
        ...generous,
        ip: { fiveMinutes: 1, oneHour: 100 },
        global: { fiveMinutes: 2, oneHour: 100 },
      });
      expect(await admission.admit(request)).toEqual({ kind: "admitted" });
      for (const time of [10_000, 100_000, 299_999]) {
        at(time);
        expect(await admission.admit(request)).toMatchObject({
          kind: "throttled",
          retryAt: start + 300_000,
          scopes: ["ip"],
        });
      }
      expect(await admission.admit({ ...request, source: "127.0.0.2" })).toEqual({
        kind: "admitted",
      });
      at(300_000);
      expect(await admission.admit(request)).toEqual({ kind: "admitted" });
    });
  });

  test("retry time waits for every exhausted outer window", async () => {
    await withAdmission(async ({ open, at }) => {
      const admission = await open({
        ...generous,
        ip: { fiveMinutes: 1, oneHour: 100 },
        global: { fiveMinutes: 100, oneHour: 2 },
      });
      expect(await admission.admit(request)).toEqual({ kind: "admitted" });
      at(300_000);
      expect(await admission.admit(request)).toEqual({ kind: "admitted" });
      at(300_001);
      const blocked = await admission.admit(request);
      expect(blocked.kind).toBe("throttled");
      if (blocked.kind !== "throttled") throw new Error("Both outer scopes must throttle");
      expect(new Set(blocked.scopes)).toEqual(new Set(["ip", "global"]));
      expect(blocked.retryAt).toBe(start + 3_600_000);
    });
  });

  test("outer denial waits for a longer recipient cooldown without charging rejected traffic", async () => {
    await withAdmission(async ({ open, at }) => {
      const admission = await open({
        ...generous,
        email: { fiveMinutes: 100, oneHour: 1 },
        ip: { fiveMinutes: 1, oneHour: 100 },
      });
      expect(await admission.admit(request)).toEqual({ kind: "admitted" });
      at(1);
      expect(await admission.admit(request)).toEqual({
        kind: "throttled",
        retryAt: start + 3_600_000,
        scopes: ["ip"],
      });
      at(300_000);
      expect(await admission.admit({ ...request, email: "other@example.test" })).toEqual({
        kind: "admitted",
      });
      at(3_600_000);
      expect(await admission.admit(request)).toEqual({ kind: "admitted" });
    });
  });

  test("changing recipients and clients cannot evade the shared installation ceiling", async () => {
    await withAdmission(async ({ open }) => {
      const limits = { ...generous, global: { fiveMinutes: 7, oneHour: 9 } };
      const instances = await Promise.all([open(limits), open(limits)]);
      const results = await Promise.all(
        Array.from({ length: 40 }, (_, index) =>
          instances[index % 2]!.admit({
            source: `127.0.0.${index + 1}`,
            email: `person${index}@example.test`,
          }),
        ),
      );
      expect(results.filter((result) => result.kind === "admitted")).toHaveLength(7);
      expect(results.filter((result) => result.kind === "throttled")).toHaveLength(33);
      expect(await instances[0]!.admit(request)).toMatchObject({
        kind: "throttled",
        scopes: ["global"],
      });
    });
  });

  test("closing and reopening applies new limits to retained history", async () => {
    await withAdmission(async ({ open }) => {
      const first = await open();
      for (let index = 0; index < 3; index++)
        expect(await first.admit(request)).toEqual({ kind: "admitted" });
      await first.close();
      const second = await open({ ...defaults, email: { fiveMinutes: 2, oneHour: 20 } });
      expect(await second.admit(request)).toMatchObject({ kind: "throttled", scopes: ["email"] });
      await second.close();
      const third = await open({ ...defaults, email: { fiveMinutes: 4, oneHour: 20 } });
      expect(await third.admit(request)).toEqual({ kind: "admitted" });
      expect(await third.admit(request)).toMatchObject({ kind: "throttled", scopes: ["email"] });
    });
  });

  test("lowered ceilings wait for enough retained admissions to age out", async () => {
    await withAdmission(async ({ open, at }) => {
      const first = await open();
      for (const time of [0, 10_000, 20_000, 30_000, 40_000]) {
        at(time);
        expect(await first.admit(request)).toEqual({ kind: "admitted" });
      }
      await first.close();
      const second = await open({ ...defaults, email: { fiveMinutes: 2, oneHour: 20 } });
      expect(await second.admit(request)).toMatchObject({
        kind: "throttled",
        retryAt: start + 330_000,
        scopes: ["email"],
      });
      at(329_999);
      expect(await second.admit(request)).toMatchObject({
        kind: "throttled",
        retryAt: start + 330_000,
      });
      at(330_000);
      expect(await second.admit(request)).toEqual({ kind: "admitted" });
    });
  });

  test("an email cooldown accounts for both retained windows", async () => {
    await withAdmission(async ({ open, at }) => {
      const admission = await open({
        ...generous,
        email: { fiveMinutes: 2, oneHour: 3 },
      });
      expect(await admission.admit(request)).toEqual({ kind: "admitted" });
      at(300_000);
      expect(await admission.admit(request)).toEqual({ kind: "admitted" });
      at(310_000);
      expect(await admission.admit(request)).toEqual({ kind: "admitted" });
      expect(await admission.admit(request)).toMatchObject({
        kind: "throttled",
        retryAt: start + 3_600_000,
        scopes: ["email"],
      });
      at(3_600_000);
      expect(await admission.admit(request)).toEqual({ kind: "admitted" });
    });
  });

  test("an email rejection waits for an outer window that its own charge filled", async () => {
    await withAdmission(async ({ open, at }) => {
      const admission = await open({
        ...generous,
        email: { fiveMinutes: 1, oneHour: 100 },
        ip: { fiveMinutes: 100, oneHour: 2 },
      });
      expect(await admission.admit(request)).toEqual({ kind: "admitted" });
      at(1_000);
      expect(await admission.admit(request)).toEqual({
        kind: "throttled",
        retryAt: start + 3_600_000,
        scopes: ["email"],
      });
    });
  });
});
