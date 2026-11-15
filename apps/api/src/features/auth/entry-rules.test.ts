import type { AuthEntryRecord, ProtectedDestination } from "@aircastle/core";
import { describe, expect, test } from "vite-plus/test";
import { resolveEntry } from "./entry.ts";

const workspaceId = "0b9f4a52-3c1d-4e8a-9f6b-2d7c5e1a8b30";
const otherWorkspaceId = "6e2d8c14-7a5b-4f39-8d0e-1c3b9a7f5e42";
const projectId = "9a1c3e5f-7b2d-4c6e-8f0a-1b3d5f7a9c2e";
const fresh: AuthEntryRecord = { onboardingOffered: false, lastWorkspaceId: null };
const offered: AuthEntryRecord = { onboardingOffered: true, lastWorkspaceId: null };

function access(...destinations: ProtectedDestination[]) {
  const asked: ProtectedDestination[] = [];
  const keys = new Set(destinations.map((destination) => JSON.stringify(destination)));
  return {
    asked,
    allowed: async (destination: ProtectedDestination) => {
      asked.push(destination);
      return keys.has(JSON.stringify(destination));
    },
  };
}

const projects: ProtectedDestination = { kind: "workspace-projects", workspaceId };
const page: ProtectedDestination = { kind: "project-page", workspaceId, projectId, page: "media" };

describe("resolveEntry", () => {
  test("offers workspace creation on the first entry and the workspaces afterwards", async () => {
    expect(await resolveEntry({ kind: "resolve" }, fresh, access().allowed)).toEqual({
      kind: "ok",
      destination: { kind: "create-workspace" },
      entry: offered,
    });
    expect(await resolveEntry({ kind: "resolve" }, offered, access().allowed)).toEqual({
      kind: "ok",
      destination: { kind: "workspaces" },
      entry: offered,
    });
  });

  test("skipping onboarding goes to the workspaces and keeps the remembered workspace", async () => {
    const entry = { onboardingOffered: false, lastWorkspaceId: workspaceId };
    expect(await resolveEntry({ kind: "skip-onboarding" }, entry, access().allowed)).toEqual({
      kind: "ok",
      destination: { kind: "workspaces" },
      entry: { onboardingOffered: true, lastWorkspaceId: workspaceId },
    });
  });

  test("returns to a remembered workspace while it is still allowed", async () => {
    const remembered = { onboardingOffered: true, lastWorkspaceId: workspaceId };
    const granted = access(projects);
    expect(await resolveEntry({ kind: "resolve" }, remembered, granted.allowed)).toEqual({
      kind: "ok",
      destination: projects,
      entry: remembered,
    });
    expect(granted.asked).toEqual([projects]);
  });

  test("falls back to the workspaces and forgets a remembered workspace that is gone", async () => {
    const remembered = { onboardingOffered: false, lastWorkspaceId: workspaceId };
    expect(await resolveEntry({ kind: "resolve" }, remembered, access().allowed)).toEqual({
      kind: "ok",
      destination: { kind: "workspaces" },
      entry: { onboardingOffered: true, lastWorkspaceId: null },
    });
  });

  test("an allowed requested destination outranks onboarding and records its workspace", async () => {
    const granted = access(page);
    expect(
      await resolveEntry({ kind: "resolve", requested: page }, fresh, granted.allowed),
    ).toEqual({
      kind: "ok",
      destination: page,
      entry: { onboardingOffered: true, lastWorkspaceId: workspaceId },
    });
    expect(granted.asked).toEqual([page]);
  });

  test("an allowed visit to the workspace list keeps the remembered workspace", async () => {
    const remembered = { onboardingOffered: false, lastWorkspaceId: otherWorkspaceId };
    const workspaces: ProtectedDestination = { kind: "workspaces" };
    expect(
      await resolveEntry(
        { kind: "visit", destination: workspaces },
        remembered,
        access(workspaces).allowed,
      ),
    ).toEqual({
      kind: "ok",
      destination: workspaces,
      entry: { onboardingOffered: true, lastWorkspaceId: otherWorkspaceId },
    });
  });

  test("a denied visit is forbidden", async () => {
    const denied = access();
    expect(await resolveEntry({ kind: "visit", destination: page }, fresh, denied.allowed)).toEqual(
      {
        kind: "forbidden",
      },
    );
    expect(denied.asked).toEqual([page]);
  });

  test("a denied requested destination falls back to the remembered workspace", async () => {
    const remembered = { onboardingOffered: true, lastWorkspaceId: workspaceId };
    const granted = access(projects);
    expect(
      await resolveEntry({ kind: "resolve", requested: page }, remembered, granted.allowed),
    ).toEqual({ kind: "ok", destination: projects, entry: remembered });
    expect(granted.asked).toEqual([page, projects]);
  });
});
