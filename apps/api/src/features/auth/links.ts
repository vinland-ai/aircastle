import type { AuthLinkRecord, AuthTransaction, AuthUserRecord } from "@aircastle/core";
import type { AccountInput, LinkInput } from "./request.ts";

export type SetupState = "open" | "complete";

type LinkFailure =
  | { kind: "invalid-link" | "superseded-link"; next: "setup" | "sign-in" }
  | { kind: "setup-complete" };

export type LinkVerdict =
  | { kind: "valid"; record: AuthLinkRecord }
  | { kind: "failure"; failure: LinkFailure };

/** Where a browser goes after a failed link: setup while it is open, otherwise sign-in. */
export const nextStep = (setup: SetupState) => (setup === "open" ? "setup" : "sign-in");

/**
 * Judges a link in precedence order. A missing, malformed, mismatched, expired or consumed link is
 * invalid. A superseded link is reported as superseded only while unexpired. A setup link that
 * lost the setup claim reports setup complete.
 */
export function linkVerdict(
  input: LinkInput | null,
  record: AuthLinkRecord | null,
  setup: SetupState,
  now: number,
): LinkVerdict {
  const next = nextStep(setup);
  if (
    !input ||
    !record ||
    record.identity.purpose !== input.purpose ||
    record.expiresAt <= now ||
    record.status === "consumed"
  )
    return { kind: "failure", failure: { kind: "invalid-link", next } };
  if (record.status === "superseded")
    return { kind: "failure", failure: { kind: "superseded-link", next } };
  if (record.identity.purpose === "setup" && setup === "complete")
    return { kind: "failure", failure: { kind: "setup-complete" } };
  return { kind: "valid", record };
}

/** An unknown identity is answered as issued, so known and unknown emails look the same. */
export type Eligibility =
  | { kind: "eligible"; identity: AuthLinkRecord["identity"] }
  | { kind: "setup-complete" | "email-not-allowed" | "setup-required" | "unknown-identity" };

/**
 * Who may request a link. Setup is open to the configured initial email, or to anyone without
 * one. Sign-in needs completed setup and looks the account up only then.
 */
export async function eligibility(
  input: AccountInput,
  setup: SetupState,
  initialEmail: string | undefined,
  userByEmail: (email: string) => Promise<AuthUserRecord | null>,
): Promise<Eligibility> {
  if (input.purpose === "setup") {
    if (setup === "complete") return { kind: "setup-complete" };
    if (initialEmail && input.email !== initialEmail) return { kind: "email-not-allowed" };
    return { kind: "eligible", identity: { purpose: "setup", name: input.name } };
  }
  if (setup === "open") return { kind: "setup-required" };
  const user = await userByEmail(input.email);
  if (!user) return { kind: "unknown-identity" };
  return { kind: "eligible", identity: { purpose: "sign-in", userId: user.id } };
}

/**
 * Takes the setup claim before the email lock. Issuance and redemption share this order, so they
 * cannot deadlock.
 */
export async function lockSetupThenEmail(
  tx: AuthTransaction,
  email: string | undefined,
): Promise<SetupState> {
  const setup = await tx.lockSetupClaim();
  if (email !== undefined) await tx.lockEmail(email);
  return setup;
}
