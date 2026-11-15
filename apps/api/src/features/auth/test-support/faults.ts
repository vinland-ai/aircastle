import { AuthStorageError } from "@aircastle/core";
import type { AuthStore } from "@aircastle/core";
import type { DevelopmentInbox } from "../../development-inbox/index.ts";

/**
 * Where a storage fault strikes. Session and replacement faults throw after their writes, before
 * the transaction completes, so it rolls back. A commit fault throws inside the transaction after
 * its work. An ack fault throws commit-unknown after the transaction completed. None of these is
 * real wire loss or a deferred-constraint failure.
 */
export type StorageFault = "none" | "session" | "replacement" | "commit" | "ack";

/** A storage fault a test switches during the test, shared by every store it wraps. */
export function storageFaults() {
  let fault: StorageFault = "none";
  return {
    inject: (next: StorageFault) => {
      fault = next;
    },
    wrap: (store: AuthStore): AuthStore => ({
      ...store,
      transaction: async (work) => {
        const result = await store.transaction(async (transaction) => {
          const value = await work({
            ...transaction,
            insertSession: async (record) => {
              const saved = await transaction.insertSession(record);
              if (fault === "session") throw new AuthStorageError("unavailable");
              return saved;
            },
            replaceLink: async (record) => {
              await transaction.replaceLink(record);
              if (fault === "replacement") throw new AuthStorageError("unavailable");
            },
          });
          if (fault === "commit") throw new AuthStorageError("unavailable");
          return value;
        });
        if (fault === "ack") throw new AuthStorageError("commit-unknown");
        return result;
      },
    }),
  };
}

/** Makes message preparation fail while switched on, shared by every inbox it wraps. */
export function captureFaults() {
  let failing = false;
  return {
    fail: (enabled: boolean) => {
      failing = enabled;
    },
    wrap: (inbox: DevelopmentInbox): DevelopmentInbox => ({
      ...inbox,
      prepare: async (mail) => {
        if (failing) throw new Error("test capture preparation failure");
        return inbox.prepare(mail);
      },
    }),
  };
}
