import { AuthStorageError } from "@aircastle/core";
import type { ErrorSummary } from "@aircastle/core";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { AuthEvent } from "./diagnostics.ts";
import { createIssuanceRecovery } from "./issuance-recovery.ts";

type Outcome = "committed" | "not-committed" | Error;

function harness(outcomes: Outcome[]) {
  const resolved: string[] = [];
  const events: AuthEvent[] = [];
  const reports: ErrorSummary[] = [];
  const recovery = createIssuanceRecovery({
    resolve: async ({ messageId }) => {
      resolved.push(messageId);
      const outcome = outcomes.shift() ?? new AuthStorageError("unavailable");
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
    emit: (event) => events.push(event),
    report: (summary) => reports.push(summary),
  });
  const link = (messageId: string) => {
    const published = { commits: 0, aborts: 0 };
    return {
      published,
      link: {
        messageId,
        email: "alex@example.test",
        publication: {
          commit: () => {
            published.commits++;
          },
          abort: () => {
            published.aborts++;
          },
        },
      },
    };
  };
  return { recovery, resolved, events, reports, link };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("publishes a committed link once", async () => {
  const { recovery, link } = harness(["committed"]);
  const pending = link("message-1");
  expect(await recovery.recover(pending.link)).toBe("committed");
  expect(pending.published).toEqual({ commits: 1, aborts: 0 });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(pending.published).toEqual({ commits: 1, aborts: 0 });
});

test("aborts a link that did not commit", async () => {
  const { recovery, link } = harness(["not-committed"]);
  const pending = link("message-1");
  expect(await recovery.recover(pending.link)).toBe("not-committed");
  expect(pending.published).toEqual({ commits: 0, aborts: 1 });
});

test("retries every second after a storage error until the link resolves", async () => {
  const storage = new AuthStorageError("unavailable", { code: "57P01" });
  const { recovery, resolved, events, link } = harness([storage, storage, "committed"]);
  const pending = link("message-1");
  expect(await recovery.recover(pending.link)).toBe("retrying");
  expect(pending.published).toEqual({ commits: 0, aborts: 0 });
  await vi.advanceTimersByTimeAsync(999);
  expect(resolved).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(resolved).toHaveLength(2);
  expect(events).toEqual([{ kind: "storage-unavailable", code: "57P01" }]);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(resolved).toEqual(["message-1", "message-1", "message-1"]);
  expect(pending.published).toEqual({ commits: 1, aborts: 0 });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(resolved).toHaveLength(3);
});

test("retries every waiting link in one pass", async () => {
  const storage = new AuthStorageError("unavailable");
  const { recovery, resolved, link } = harness([storage, storage, "committed", "not-committed"]);
  const first = link("message-1");
  const second = link("message-2");
  expect(await recovery.recover(first.link)).toBe("retrying");
  expect(await recovery.recover(second.link)).toBe("retrying");
  await vi.advanceTimersByTimeAsync(1_000);
  expect(resolved).toEqual(["message-1", "message-2", "message-1", "message-2"]);
  expect(first.published).toEqual({ commits: 1, aborts: 0 });
  expect(second.published).toEqual({ commits: 0, aborts: 1 });
});

test("drops and rethrows a link whose first resolution hits a bug", async () => {
  const bug = new TypeError("resolution bug");
  const { recovery, resolved, link } = harness([bug]);
  const pending = link("message-1");
  await expect(recovery.recover(pending.link)).rejects.toBe(bug);
  expect(pending.published).toEqual({ commits: 0, aborts: 1 });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(resolved).toHaveLength(1);
});

test("reports a bug during a background retry once and stops retrying that link", async () => {
  const { recovery, resolved, reports, link } = harness([
    new AuthStorageError("unavailable"),
    new TypeError("resolution bug"),
  ]);
  const pending = link("message-1");
  expect(await recovery.recover(pending.link)).toBe("retrying");
  await vi.advanceTimersByTimeAsync(1_000);
  expect(reports).toHaveLength(1);
  expect(pending.published).toEqual({ commits: 0, aborts: 1 });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(resolved).toHaveLength(2);
  expect(reports).toHaveLength(1);
});

test("close stops the retries", async () => {
  const { recovery, resolved, link } = harness([new AuthStorageError("unavailable")]);
  expect(await recovery.recover(link("message-1").link)).toBe("retrying");
  await recovery.close();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(resolved).toHaveLength(1);
});

test("close waits for the pass in flight", async () => {
  let finish: (outcome: "committed") => void = () => {};
  const outcomes: (Outcome | Promise<"committed">)[] = [new AuthStorageError("unavailable")];
  const resolved: string[] = [];
  const recovery = createIssuanceRecovery({
    resolve: async ({ messageId }) => {
      resolved.push(messageId);
      const outcome = outcomes.shift() ?? new Promise<"committed">((done) => (finish = done));
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
    emit: () => {},
    report: () => {},
  });
  const published = { commits: 0 };
  expect(
    await recovery.recover({
      messageId: "message-1",
      email: "alex@example.test",
      publication: { commit: () => published.commits++, abort: () => {} },
    }),
  ).toBe("retrying");
  await vi.advanceTimersByTimeAsync(1_000);
  expect(resolved).toHaveLength(2);
  let closed = false;
  const closing = recovery.close().then(() => {
    closed = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(closed).toBe(false);
  finish("committed");
  await closing;
  expect(published.commits).toBe(1);
});
