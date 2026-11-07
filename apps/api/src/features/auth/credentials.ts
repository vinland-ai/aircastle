import { randomUUID } from "node:crypto";
import { AuthStorageError, ErrorSummary } from "@aircastle/core";
import type {
  AuthLinkRecord,
  AuthStore,
  AuthTransaction,
  ProtectedDestination,
  ReportError,
} from "@aircastle/core";
import type { DevelopmentInbox, DevelopmentInboxPublication } from "../development-inbox/index.ts";
import { storageUnavailable } from "./diagnostics.ts";
import { linkEmail, linkLifetime } from "./link-email.ts";
import { eligibility, linkVerdict, lockSetupThenEmail, nextStep } from "./links.ts";
import type { LinkVerdict } from "./links.ts";
import type { AuthEvent } from "./diagnostics.ts";
import type { AccountInput, LinkInput } from "./request.ts";
import { startSession } from "./sessions.ts";
import { digest, newToken } from "./token.ts";

export function createCredentials(options: {
  storage: AuthStore;
  inbox: DevelopmentInbox;
  clock: () => number;
  emit: (event: AuthEvent) => void;
  report: ReportError;
  origin: string;
  initialEmail?: string;
}) {
  const pending = new Map<string, { email: string; publication: DevelopmentInboxPublication }>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let reconciling: Promise<void> | undefined;

  async function resolve(messageId: string): Promise<"committed" | "not-committed"> {
    const capture = pending.get(messageId);
    if (!capture) throw new AuthStorageError("unavailable");
    const result = await options.storage
      .resolveIssuance({ messageId, email: capture.email })
      .catch((error: unknown) => {
        if (!(error instanceof AuthStorageError)) {
          pending.delete(messageId);
          capture.publication.abort();
        }
        throw error;
      });
    if (result === "committed") capture.publication.commit();
    else capture.publication.abort();
    pending.delete(messageId);
    return result;
  }

  function schedule() {
    if (closed || timer || pending.size === 0) return;
    timer = setTimeout(() => {
      timer = undefined;
      reconciling = (async () => {
        for (const messageId of pending.keys()) {
          try {
            await resolve(messageId);
          } catch (error) {
            if (error instanceof AuthStorageError) options.emit(storageUnavailable(error));
            else options.report(ErrorSummary.of(error));
          }
        }
      })().finally(() => {
        reconciling = undefined;
        schedule();
      });
    }, 1_000);
    timer.unref();
  }

  async function inspect(tx: AuthTransaction, input: LinkInput | null): Promise<LinkVerdict> {
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
    return verdict;
  }

  return {
    async issue(input: AccountInput) {
      let publication: DevelopmentInboxPublication | undefined;
      let messageId: string | undefined;
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
          try {
            publication = await options.inbox.prepare(linkEmail(record, token, options.origin));
          } catch {
            options.emit({ kind: "delivery-failed" });
            return { kind: "temporary-failure" as const };
          }
          messageId = record.messageId;
          await tx.replaceLink(record);
          return { kind: "issued" as const };
        });
        if (outcome.kind === "issued") publication?.commit();
        else publication?.abort();
        return outcome;
      } catch (error) {
        if (!(error instanceof AuthStorageError)) {
          publication?.abort();
          throw error;
        }
        options.emit(storageUnavailable(error));
        if (publication && messageId && error.kind === "commit-unknown") {
          pending.set(messageId, { email: input.email, publication });
          try {
            if ((await resolve(messageId)) === "committed") return { kind: "issued" as const };
          } catch (resolveError) {
            if (!(resolveError instanceof AuthStorageError)) throw resolveError;
            schedule();
          }
        } else publication?.abort();
        return { kind: "temporary-failure" as const };
      }
    },
    async preview(input: LinkInput | null) {
      return options.storage.transaction(async (tx) => {
        const result = await inspect(tx, input);
        return result.kind === "valid"
          ? {
              kind: "preview" as const,
              email: result.record.email,
              purpose: result.record.identity.purpose,
            }
          : result;
      });
    },
    /** Redeems a link, creating the setup user and a session in one transaction. */
    async confirm(input: LinkInput | null) {
      return options.storage.transaction(async (tx) => {
        const result = await inspect(tx, input);
        if (result.kind === "failure") return result;
        const { record } = result;
        const at = options.clock();
        if (!(await tx.consumeLink(record.digest)))
          return {
            kind: "failure" as const,
            failure: {
              kind: "invalid-link" as const,
              next: record.identity.purpose === "setup" ? ("setup" as const) : ("sign-in" as const),
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
        const { token, pair } = await startSession(tx, user, at);
        let destination: ProtectedDestination | { kind: "dashboard" } = { kind: "dashboard" };
        if (record.returnTo && (await tx.authorize(user.id, record.returnTo))) {
          destination = record.returnTo;
          const entry = await tx.entry(user.id);
          await tx.saveEntry(user.id, { ...entry, onboardingOffered: true });
        }
        return { kind: "confirmed" as const, token, pair, destination };
      });
    },
    async close() {
      closed = true;
      if (timer) clearTimeout(timer);
      await reconciling;
    },
  };
}
