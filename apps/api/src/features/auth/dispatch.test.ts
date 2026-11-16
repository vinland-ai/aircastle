import { describe, expect, test } from "vite-plus/test";
import { dispatched, fromBrowserOrigin, matchRoute } from "./dispatch.ts";

describe("matchRoute", () => {
  test.each(dispatched.filter(({ path }) => !path.includes(":id")))(
    "names the listed route $method $path",
    ({ method, path }) => {
      expect(matchRoute(method, path)).toEqual({ route: `${method} ${path}`, id: undefined });
    },
  );

  test("keeps the open route's message id raw for the handler to decode", () => {
    expect(matchRoute("POST", "/api/development-inbox/messages/a%20b/open")).toEqual({
      route: "POST /api/development-inbox/messages/:id/open",
      id: "a%20b",
    });
    expect(matchRoute("POST", "/api/development-inbox/messages/%E0%A4%A/open")?.id).toBe(
      "%E0%A4%A",
    );
  });

  test.each([
    ["GET", "/api/auth/setup"],
    ["POST", "/api/auth/state"],
    ["PUT", "/api/auth/sign-in"],
    ["POST", "/api/auth/setup/"],
    ["POST", "/api/auth/%73ign-in"],
    ["POST", "/api/auth/SETUP"],
    ["GET", "/api/auth/confirm"],
    ["POST", "/api/auth/sign-up/email"],
    ["GET", "/api/auth/get-session"],
    ["GET", "/api/development-inbox/messages/message-1/open"],
    ["POST", "/api/development-inbox/messages/a/b/open"],
    ["POST", "/api/development-inbox/messages//open"],
  ])("leaves %s %s unmatched", (method, path) => {
    expect(matchRoute(method, path)).toBeUndefined();
  });
});

describe("fromBrowserOrigin", () => {
  const origin = new URL("http://localhost:43121");
  const request = (method: string, headers: Record<string, string>) =>
    new Request("http://localhost:43121/api/auth/state", { method, headers });

  test("accepts the browser origin's own Host and Origin", () => {
    const headers = { host: "localhost:43121", origin: "http://localhost:43121" };
    expect(fromBrowserOrigin(request("GET", headers), origin)).toBe(true);
    expect(fromBrowserOrigin(request("POST", headers), origin)).toBe(true);
  });

  test("lets a GET omit Origin but not a POST", () => {
    expect(fromBrowserOrigin(request("GET", { host: "localhost:43121" }), origin)).toBe(true);
    expect(fromBrowserOrigin(request("POST", { host: "localhost:43121" }), origin)).toBe(false);
  });

  test.each([
    { origin: "https://evil.test" },
    { origin: "null" },
    { origin: "http://localhost:43121/" },
    { host: "evil.test" },
    { host: "localhost.evil.test:43121" },
    { host: "localhost:43122" },
  ])("rejects the forgery %j", (forged) => {
    for (const method of ["GET", "POST"]) {
      const headers = { host: "localhost:43121", origin: "http://localhost:43121", ...forged };
      expect(fromBrowserOrigin(request(method, headers), origin)).toBe(false);
    }
  });
});
