import { isEmail } from "@aircastle/schema";
import { type } from "arktype";

/** Auth identities follow the schema package's email format, so stored content and sign-in agree. */
export const authEmail = type("string")
  .pipe((value) => value.trim())
  .narrow((email, context) => isEmail(email) || context.mustBe("a valid ASCII email address"))
  .pipe((email) => email.toLowerCase());

/** Postgres text cannot hold NUL, and drivers replace unpaired surrogates, so neither may reach storage. */
const authName = type("string")
  .pipe((value) => value.trim())
  .narrow((name, context) => {
    const length = Array.from(name).length;
    return (
      (length >= 1 && length <= 120 && !name.includes("\0") && !/\p{Cs}/u.test(name)) ||
      context.mustBe("1 through 120 Unicode code points without NUL or unpaired surrogates")
    );
  });

export const authSetupInput = type({ name: authName, email: authEmail }).onUndeclaredKey("reject");

export const authSignInInput = type({ email: authEmail }).onUndeclaredKey("reject");

const uuid = type("string.uuid");

/** A dashboard destination that needs a session. Ids are UUIDs, and pages are the project pages. */
export const protectedDestination = type
  .or(
    { kind: "'workspaces'" },
    { kind: "'workspace-projects'", workspaceId: uuid },
    {
      kind: "'project-page'",
      workspaceId: uuid,
      projectId: uuid,
      page: "'tasks' | 'collections' | 'media' | 'analytics' | 'users' | 'access-tokens' | 'settings'",
    },
  )
  .onDeepUndeclaredKey("reject");

export type ProtectedDestination = typeof protectedDestination.infer;

/** Where a signed-in browser goes next: a protected destination, or one the server picks. */
export type AuthDestination =
  | ProtectedDestination
  | { kind: "dashboard" }
  | { kind: "create-workspace" };

/** A signed-in browser's session as the server reports it. The token stays in the cookie. */
export interface AuthSession {
  user: { id: string; name: string; email: string; authority: "super_user" };
  expiresAt: number;
}

/** The instance state that `/auth/state` reports to a browser. */
export type AuthState =
  | { kind: "setup-required" | "signed-out" | "disabled" }
  | { kind: "authenticated"; session: AuthSession };

/** The account a confirmation link would act for, shown before the browser confirms it. */
export interface LinkPreview {
  email: string;
  purpose: "setup" | "sign-in";
}

/** Every failure an auth or inbox route answers with, as the browser receives it. */
export type AuthFailure =
  | {
      kind:
        | "not-found"
        | "unauthenticated"
        | "forbidden"
        | "email-not-allowed"
        | "setup-complete"
        | "setup-required"
        | "temporary-failure";
    }
  | { kind: "invalid-input"; fields?: Record<string, string> }
  | { kind: "invalid-link" | "superseded-link"; next: "setup" | "sign-in" }
  | { kind: "throttled"; retryAt: number };

/** An email the development inbox captured instead of sending. */
export interface EmailMessage {
  readonly messageId: string;
  readonly date: string;
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly html?: string;
  readonly text: string;
}

/** A captured email and whether anyone has opened it. */
export interface DevelopmentInboxEntry {
  readonly mail: EmailMessage;
  readonly read: boolean;
}
