import type { AuthLinkRecord } from "@aircastle/core";
import type { EmailMessage } from "@aircastle/contracts";

/** How long an issued link stays redeemable, in milliseconds. */
export const linkLifetime = 300_000;

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );

/**
 * The email that carries a setup or sign-in link. The HTML part escapes the name, address and
 * URL, so a hostile display name cannot add markup to the inbox.
 */
export function linkEmail(record: AuthLinkRecord, token: string, origin: string): EmailMessage {
  const setup = record.identity.purpose === "setup";
  const heading = setup
    ? "Confirm your email to create your account."
    : "Use this link to sign in.";
  const name = record.identity.purpose === "setup" ? record.identity.name : record.email;
  const url = `${origin}/${setup ? "setup" : "sign-in"}?token=${encodeURIComponent(token)}`;
  const expiry = `This link expires in ${linkLifetime / 60_000} minutes.`;
  return {
    messageId: record.messageId,
    date: new Date(record.issuedAt).toISOString(),
    from: "Aircastle <no-reply@aircastle.test>",
    to: [record.email],
    subject: setup ? "Create your Aircastle account" : "Sign in to Aircastle",
    text: `${heading}\n\n${name}\n${record.email}\n\nContinue: ${url}\n\n${expiry}`,
    html: `<p>${heading}</p><p>${escapeHtml(name)}<br>${escapeHtml(record.email)}</p><p><a href="${escapeHtml(url)}">Continue</a></p><p>${expiry}</p>`,
  };
}
