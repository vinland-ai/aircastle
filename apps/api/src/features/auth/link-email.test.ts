import type { AuthLinkRecord } from "@aircastle/core";
import { expect, test } from "vite-plus/test";
import { linkEmail, linkLifetime } from "./link-email.ts";

const issuedAt = Date.UTC(2026, 0, 1);
const origin = "http://localhost:43121";
const link = (identity: AuthLinkRecord["identity"]): AuthLinkRecord => ({
  digest: "digest",
  messageId: "message-1",
  email: "alex@example.test",
  identity,
  issuedAt,
  expiresAt: issuedAt + linkLifetime,
  status: "active",
  returnTo: null,
});

test("a link lasts five minutes", () => {
  expect(linkLifetime).toBe(5 * 60_000);
});

test("a setup email links to setup and says when the link expires", () => {
  const mail = linkEmail(link({ purpose: "setup", name: "Alex" }), "token-1", origin);
  expect(mail).toMatchObject({
    messageId: "message-1",
    date: "2026-01-01T00:00:00.000Z",
    to: ["alex@example.test"],
    subject: "Create your Aircastle account",
  });
  expect(mail.text).toContain(`Continue: ${origin}/setup?token=token-1`);
  expect(mail.text).toContain("This link expires in 5 minutes.");
  expect(mail.html).toContain("<p>This link expires in 5 minutes.</p>");
});

test("a sign-in email links to sign-in and names the address", () => {
  const mail = linkEmail(link({ purpose: "sign-in", userId: "user-1" }), "token-2", origin);
  expect(mail.subject).toBe("Sign in to Aircastle");
  expect(mail.text).toBe(
    `Use this link to sign in.\n\nalex@example.test\nalex@example.test\n\nContinue: ${origin}/sign-in?token=token-2\n\nThis link expires in 5 minutes.`,
  );
});

test("a hostile display name stays text in the HTML part and unchanged in the text part", () => {
  const name = `<script>alert("x")</script> & 'friends'`;
  const mail = linkEmail(link({ purpose: "setup", name }), "a&b", origin);
  expect(mail.html).toContain(
    "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;friends&#39;<br>alex@example.test</p>",
  );
  expect(mail.html).not.toContain("<script>");
  expect(mail.html).toContain(`<a href="${origin}/setup?token=a%26b">Continue</a>`);
  expect(mail.text).toContain(`\n\n${name}\nalex@example.test\n\n`);
});
