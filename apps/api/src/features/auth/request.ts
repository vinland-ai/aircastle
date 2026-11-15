import { type } from "arktype";
import { authSetupInput, authSignInInput, protectedDestination } from "@aircastle/contracts";
import type { ProtectedDestination } from "@aircastle/core";
import { isToken } from "./token.ts";

export type LinkInput = { purpose: "setup" | "sign-in"; token: string };
export type AccountInput =
  | { purpose: "setup"; name: string; email: string; returnTo: ProtectedDestination | null }
  | { purpose: "sign-in"; email: string; returnTo: ProtectedDestination | null };

const authEntryInput = type
  .or(
    { kind: "'resolve'", "requested?": protectedDestination },
    { kind: "'skip-onboarding'" },
    { kind: "'visit'", destination: protectedDestination },
  )
  .onDeepUndeclaredKey("reject");

export type EntryInput = typeof authEntryInput.infer;

/** The entry request, or null when the body is not one. */
export function parseEntry(body: unknown): EntryInput | null {
  const input = authEntryInput(body);
  return input instanceof type.errors ? null : input;
}

/** The account fields for a purpose, without the transport's `returnTo`. */
function accountFields(account: Record<string, unknown>, purpose: "setup" | "sign-in") {
  if (purpose === "setup") {
    const setup = authSetupInput(account);
    return setup instanceof type.errors ? setup : { purpose, ...setup };
  }
  const signIn = authSignInInput(account);
  return signIn instanceof type.errors ? signIn : { purpose, ...signIn };
}

/** Account field errors come before a `returnTo` error. */
export function parseAccount(
  body: unknown,
  purpose: "setup" | "sign-in",
):
  | { kind: "valid"; value: AccountInput }
  | { kind: "invalid-input"; fields: Record<string, string> } {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { kind: "invalid-input", fields: { email: "Enter a valid email" } };
  const { returnTo, ...account } = body as Record<string, unknown>;
  const fields = accountFields(account, purpose);
  if (fields instanceof type.errors) {
    const errors: Record<string, string> = {};
    for (const error of fields) errors[String(error.path[0] ?? "email")] = error.message;
    return { kind: "invalid-input", fields: errors };
  }
  const target = returnTo === undefined ? null : protectedDestination(returnTo);
  if (target instanceof type.errors)
    return { kind: "invalid-input", fields: { returnTo: "Choose an allowed destination" } };
  return { kind: "valid", value: { ...fields, returnTo: target } };
}

/** A link body with a known purpose and a token of the shape `newToken` makes, or null. */
export function parseLink(body: unknown): LinkInput | null {
  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    "purpose" in body &&
    (body.purpose === "setup" || body.purpose === "sign-in") &&
    "token" in body &&
    typeof body.token === "string" &&
    isToken(body.token) &&
    Object.keys(body).every((key) => key === "purpose" || key === "token")
  )
    return { purpose: body.purpose, token: body.token };
  return null;
}

export async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
