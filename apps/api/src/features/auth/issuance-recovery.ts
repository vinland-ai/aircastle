import { AuthStorageError, ErrorSummary } from "@aircastle/core";
import type { AuthStore, ReportError } from "@aircastle/core";
import type { DevelopmentInboxPublication } from "../development-inbox/index.ts";
import { storageUnavailable } from "./diagnostics.ts";
import type { AuthEvent } from "./diagnostics.ts";

/** An issued link whose message waits until its commit is known. */
export interface PreparedLink {
  messageId: string;
  email: string;
  publication: DevelopmentInboxPublication;
}

/**
 * Resolves links whose commit acknowledgment was lost. Each message is published only once its
 * issuance marker is known to be committed, and aborted once it is known not to be.
 */
export function createIssuanceRecovery(options: {
  resolve: AuthStore["resolveIssuance"];
  emit: (event: AuthEvent) => void;
  report: ReportError;
}) {
  const waiting = new Map<string, PreparedLink>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let pass: Promise<void> | undefined;

  async function settle(link: PreparedLink): Promise<"committed" | "not-committed"> {
    let outcome: "committed" | "not-committed";
    try {
      outcome = await options.resolve({ messageId: link.messageId, email: link.email });
    } catch (error) {
      if (!(error instanceof AuthStorageError)) {
        waiting.delete(link.messageId);
        link.publication.abort();
      }
      throw error;
    }
    if (outcome === "committed") link.publication.commit();
    else link.publication.abort();
    waiting.delete(link.messageId);
    return outcome;
  }

  function schedule() {
    if (closed || timer || waiting.size === 0) return;
    timer = setTimeout(() => {
      timer = undefined;
      pass = (async () => {
        for (const link of waiting.values()) {
          try {
            await settle(link);
          } catch (error) {
            if (error instanceof AuthStorageError) options.emit(storageUnavailable(error));
            else options.report(ErrorSummary.of(error));
          }
        }
      })().finally(() => {
        pass = undefined;
        schedule();
      });
    }, 1_000);
    timer.unref();
  }

  return {
    /**
     * Tries once now. After a storage error it retries every second in the background, picking up
     * links added meanwhile. Any other error drops the link and is rethrown.
     */
    recover: async (link: PreparedLink): Promise<"committed" | "not-committed" | "retrying"> => {
      waiting.set(link.messageId, link);
      try {
        return await settle(link);
      } catch (error) {
        if (!(error instanceof AuthStorageError)) throw error;
        schedule();
        return "retrying";
      }
    },
    /** Stops retrying and waits for the pass in flight. */
    close: async () => {
      closed = true;
      if (timer) clearTimeout(timer);
      await pass;
    },
  };
}
