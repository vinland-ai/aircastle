import { expect, test } from "vite-plus/test";
import { boundedEvents } from "./diagnostics.ts";
import type { AuthEvent } from "./diagnostics.ts";

function limiter(start = 1_000_000) {
  let now = start;
  const emitted: AuthEvent[] = [];
  const emit = boundedEvents(
    (event) => emitted.push(event),
    () => now,
  );
  return {
    emit,
    emitted,
    at: (time: number) => {
      now = time;
    },
  };
}

const blocked: AuthEvent = { kind: "request-blocked", scopes: ["ip"] };
const failed: AuthEvent = { kind: "sign-in-failed", reason: "invalid-link" };

test("passes five identical events a minute and drops the rest", () => {
  const { emit, emitted } = limiter();
  for (let index = 0; index < 8; index++) emit(blocked);
  expect(emitted).toEqual([blocked, blocked, blocked, blocked, blocked]);
});

test("counts each distinct event separately", () => {
  const { emit, emitted } = limiter();
  for (let index = 0; index < 6; index++) {
    emit(blocked);
    emit(failed);
  }
  expect(emitted.filter((event) => event.kind === "request-blocked")).toHaveLength(5);
  expect(emitted.filter((event) => event.kind === "sign-in-failed")).toHaveLength(5);
});

test("starts a new minute sixty seconds after the last one began", () => {
  const { emit, emitted, at } = limiter(1_000_000);
  for (let index = 0; index < 6; index++) emit(blocked);
  at(1_059_999);
  emit(blocked);
  expect(emitted).toHaveLength(5);
  at(1_060_000);
  emit(blocked);
  expect(emitted).toHaveLength(6);
});

test("starts a new minute when the clock moves backwards", () => {
  const { emit, emitted, at } = limiter(1_000_000);
  for (let index = 0; index < 6; index++) emit(blocked);
  at(999_999);
  emit(blocked);
  expect(emitted).toHaveLength(6);
});
