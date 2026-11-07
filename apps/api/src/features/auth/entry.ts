import type { AuthDestination, AuthEntryRecord, ProtectedDestination } from "@aircastle/core";
import type { EntryInput } from "./request.ts";

export type EntryResolution =
  | { kind: "ok"; destination: AuthDestination; entry: AuthEntryRecord }
  | { kind: "forbidden" };

/**
 * Where a signed-in user goes next, and the entry state to save. An allowed requested destination
 * wins and counts as offering onboarding. A denied visit is forbidden. Otherwise skipping goes to
 * the workspaces, a remembered workspace is reused while it is still allowed, and the first entry
 * offers workspace creation once. `allowed` runs where the caller authorizes, in this order.
 */
export async function resolveEntry(
  input: EntryInput,
  entry: AuthEntryRecord,
  allowed: (destination: ProtectedDestination) => Promise<boolean>,
): Promise<EntryResolution> {
  const target =
    input.kind === "visit"
      ? input.destination
      : input.kind === "resolve"
        ? input.requested
        : undefined;
  if (target && (await allowed(target))) {
    return {
      kind: "ok",
      destination: target,
      entry: {
        onboardingOffered: true,
        lastWorkspaceId: target.kind === "workspaces" ? entry.lastWorkspaceId : target.workspaceId,
      },
    };
  }
  if (input.kind === "visit") return { kind: "forbidden" };
  if (input.kind === "skip-onboarding") {
    return {
      kind: "ok",
      destination: { kind: "workspaces" },
      entry: { ...entry, onboardingOffered: true },
    };
  }
  if (entry.lastWorkspaceId) {
    const remembered: ProtectedDestination = {
      kind: "workspace-projects",
      workspaceId: entry.lastWorkspaceId,
    };
    const permitted = await allowed(remembered);
    return {
      kind: "ok",
      destination: permitted ? remembered : { kind: "workspaces" },
      entry: { onboardingOffered: true, lastWorkspaceId: permitted ? entry.lastWorkspaceId : null },
    };
  }
  return {
    kind: "ok",
    destination: { kind: entry.onboardingOffered ? "workspaces" : "create-workspace" },
    entry: { ...entry, onboardingOffered: true },
  };
}
