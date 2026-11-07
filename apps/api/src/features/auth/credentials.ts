import { randomUUID } from "node:crypto";
import { AuthStorageError } from "@aircastle/core";
import type {
  AuthLinkRecord,
  AuthStore,
  AuthTransaction,
  ProtectedDestination,
  ReportError,
} from "@aircastle/core";
import type { DevelopmentInbox, DevelopmentInboxPublication } from "../development-inbox/index.ts";
import { storageUnavailable } from "./diagnostics.ts";
import { createIssuanceRecovery } from "./issuance-recovery.ts";
import type { PreparedLink } from "./issuance-recovery.ts";
import { linkEmail, linkLifetime } from "./link-email.ts";
import { eligibility, linkVerdict, lockSetupThenEmail, nextStep } from "./links.ts";
import type { LinkVerdict, SetupState } from "./links.ts";
import type { AuthEvent } from "./diagnostics.ts";
import type { AccountInput, LinkInput } from "./request.ts";
import { startSession } from "./sessions.ts";
import { digest, newToken } from "./token.ts";

interface CredentialOptions {
  storage: AuthStore;
  inbox: DevelopmentInbox;
  clock: () => number;
  emit: (event: AuthEvent) => void;
  report: ReportError;
  origin: string;
  initialEmail?: string;
}

export function createCredentials(options: CredentialOptions) {
  const recovery = createIssuanceRecovery({
    resolve: (issuance) => options.storage.resolveIssuance(issuance),
    emit: options.emit,
    report: options.report,
  });
  return {
    issue: (input: AccountInput) => issue(options, recovery, input),
    async preview(input: LinkInput | null) {
      return options.storage.transaction(async (tx) => {
        const result = await inspect(options, tx, input);
        return result.kind === "valid"
          ? {
              kind: "preview" as const,
              email: result.record.email,
              purpose: result.record.identity.purpose,
            }
          : result;
      });
    },
    confirm: (input: LinkInput | null) => confirm(options, input),
    close: () => recovery.close(),
  };
}

async function inspect(
  options: CredentialOptions,
  tx: AuthTransaction,
  input: LinkInput | null,
): Promise<LinkVerdict & { setup: SetupState }> {
  const preliminary = input ? await tx.link(digest(input.token)) : null;
  const setup = await lockSetupThenEmail(tx, preliminary?.email);
  const record = input && preliminary ? await tx.link(digest(input.token)) : null;
  let verdict = linkVerdict(input, record, setup, options.clock());
  if (
    verdict.kind === "valid" &&
    verdict.record.identity.purpose === "sign-in" &&
    !(await tx.userById(verdict.record.identity.userId))
  )
    verdict = { kind: "failure", failure: { kind: "invalid-link", next: nextStep(setup) } };
  if (verdict.kind === "failure")
    options.emit({ kind: "sign-in-failed", reason: verdict.failure.kind });
  return { ...verdict, setup };
}

async function issue(
  options: CredentialOptions,
  recovery: ReturnType<typeof createIssuanceRecovery>,
  input: AccountInput,
) {
  let prepared: PreparedLink | undefined;
  try {
    const outcome = await options.storage.transaction(async (tx) => {
      const setup = await lockSetupThenEmail(tx, input.email);
      const eligible = await eligibility(input, setup, options.initialEmail, tx.userByEmail);
      if (eligible.kind === "unknown-identity") {
        options.emit({ kind: "sign-in-failed", reason: "unknown-identity" });
        return { kind: "issued" as const };
      }
      if (eligible.kind !== "eligible") return { kind: eligible.kind };
      const { identity } = eligible;
      const token = newToken();
      const at = options.clock();
      const record: AuthLinkRecord = {
        digest: digest(token),
        messageId: randomUUID(),
        email: input.email,
        identity,
        issuedAt: at,
        expiresAt: at + linkLifetime,
        status: "active",
        returnTo: input.returnTo,
      };
      let publication: DevelopmentInboxPublication;
      try {
        publication = await options.inbox.prepare(linkEmail(record, token, options.origin));
      } catch {
        options.emit({ kind: "delivery-failed" });
        return { kind: "temporary-failure" as const };
      }
      prepared = { messageId: record.messageId, email: record.email, publication };
      await tx.replaceLink(record);
      return { kind: "issued" as const };
    });
    if (outcome.kind === "issued") prepared?.publication.commit();
    else prepared?.publication.abort();
    return outcome;
  } catch (error) {
    if (!(error instanceof AuthStorageError)) {
      prepared?.publication.abort();
      throw error;
    }
    options.emit(storageUnavailable(error));
    if (prepared && error.kind === "commit-unknown")
      return (await recovery.recover(prepared)) === "committed"
        ? { kind: "issued" as const }
        : { kind: "temporary-failure" as const };
    prepared?.publication.abort();
    return { kind: "temporary-failure" as const };
  }
}

/** Redeems a link, creating the setup user and a session in one transaction. */
async function confirm(options: CredentialOptions, input: LinkInput | null) {
  return options.storage.transaction(async (tx) => {
    const result = await inspect(options, tx, input);
    if (result.kind === "failure") return result;
    const { record } = result;
    const at = options.clock();
    if (!(await tx.consumeLink(record.digest)))
      return {
        kind: "failure" as const,
        failure: {
          kind: "invalid-link" as const,
          next: nextStep(result.setup),
        },
      };
    const user =
      record.identity.purpose === "setup"
        ? await tx.insertUser({
            id: randomUUID(),
            name: record.identity.name,
            email: record.email,
            createdAt: at,
            updatedAt: at,
          })
        : await tx.userById(record.identity.userId);
    if (!user) throw new AuthStorageError("unavailable");
    if (record.identity.purpose === "setup") await tx.completeSetup(user.id);
    const { token } = await startSession(tx, user, at);
    let destination: ProtectedDestination | { kind: "dashboard" } = { kind: "dashboard" };
    if (record.returnTo && (await tx.authorize(user.id, record.returnTo))) {
      destination = record.returnTo;
      const entry = await tx.entry(user.id);
      await tx.saveEntry(user.id, { ...entry, onboardingOffered: true });
    }
    return { kind: "confirmed" as const, token, destination };
  });
}
