import { createHash, randomBytes } from "node:crypto";

/** A new unguessable bearer token: 32 random bytes as 43 base64url characters. */
export const newToken = () => randomBytes(32).toString("base64url");

/** The SHA-256 hex digest under which a bearer token is stored. */
export const digest = (token: string) => createHash("sha256").update(token).digest("hex");

/** Whether a value has the shape `newToken` makes. No other value can match a stored digest. */
export const isToken = (value: string) => /^[A-Za-z0-9_-]{43}$/.test(value);
