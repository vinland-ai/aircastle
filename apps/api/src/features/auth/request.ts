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

export function parseAccount(
  body: unknown,
  purpose: "setup" | "sign-in",
):
  | { kind: "valid"; value: AccountInput }
  | { kind: "invalid-input"; fields: Record<string, string> } {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { kind: "invalid-input", fields: { email: "Enter a valid email" } };
  const { returnTo, ...account } = body as Record<string, unknown>;
  const parsed = purpose === "setup" ? authSetupInput(account) : authSignInInput(account);
  if (parsed instanceof type.errors) {
    const fields: Record<string, string> = {};
    for (const error of parsed) fields[String(error.path[0] ?? "email")] = error.message;
    return { kind: "invalid-input", fields };
  }
  let target: ProtectedDestination | null = null;
  if (returnTo !== undefined) {
    const parsedTarget = protectedDestination(returnTo);
    if (parsedTarget instanceof type.errors)
      return { kind: "invalid-input", fields: { returnTo: "Choose an allowed destination" } };
    target = parsedTarget;
  }
  if (purpose === "setup" && "name" in parsed && typeof parsed.name === "string")
    return {
      kind: "valid",
      value: { purpose, name: parsed.name, email: parsed.email, returnTo: target },
    };
  if (purpose === "sign-in")
    return { kind: "valid", value: { purpose, email: parsed.email, returnTo: target } };
  return { kind: "invalid-input", fields: { name: "Enter your name" } };
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
