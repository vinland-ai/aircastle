import {
  authEmail,
  authSetupInput,
  authSignInInput,
  protectedDestination,
} from "@aircastle/contracts";
import type { AuthDestination, ProtectedDestination } from "@aircastle/contracts";
import { type } from "arktype";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

export type Email = Expect<Equal<typeof authEmail.infer, string>>;
export type Setup = Expect<Equal<typeof authSetupInput.infer, { name: string; email: string }>>;
export type SignIn = Expect<Equal<typeof authSignInInput.infer, { email: string }>>;
export type Destination = Expect<Equal<typeof protectedDestination.infer, ProtectedDestination>>;
export type ProjectPage = Expect<
  Equal<
    Extract<ProtectedDestination, { kind: "project-page" }>["page"],
    "tasks" | "collections" | "media" | "analytics" | "users" | "access-tokens" | "settings"
  >
>;
export type ServerChosen = Expect<
  Equal<
    Exclude<AuthDestination, ProtectedDestination>,
    { kind: "dashboard" } | { kind: "create-workspace" }
  >
>;

export const assertedEmail: string = authEmail.assert(" Person@Example.com ");

export function validateEmail(value: unknown): string {
  const result = authEmail(value);
  if (result instanceof type.errors) return result.summary;
  return result.toLowerCase();
}

export function validateSetup(value: unknown): { name: string; email: string } | string[] {
  const result = authSetupInput(value);
  if (result instanceof type.errors) return result.map((issue) => issue.path.join("."));
  return result;
}

export function validateSignIn(value: unknown): { email: string } | string {
  const result = authSignInInput(value);
  if (result instanceof type.errors) return result.summary;
  return result;
}

export function validateDestination(value: unknown): ProtectedDestination | string {
  const result = protectedDestination(value);
  if (result instanceof type.errors) return result.summary;
  return result;
}
