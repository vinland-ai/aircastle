const authRoutes = [
  "GET /api/auth/state",
  "GET /api/auth/session",
  "GET /api/development-inbox/messages",
  "POST /api/auth/setup",
  "POST /api/auth/sign-in",
  "POST /api/auth/confirm",
  "POST /api/auth/confirm/preview",
  "POST /api/auth/sign-out",
  "POST /api/auth/activity",
  "POST /api/auth/entry",
  "POST /api/development-inbox/messages/:id/open",
] as const;

export type AuthRoute = (typeof authRoutes)[number];

/** Every method and path the development runtime answers. Anything else is 404 before the Host and Origin checks. */
export const dispatched = authRoutes.map((route) => {
  const space = route.indexOf(" ");
  return { method: route.slice(0, space), path: route.slice(space + 1) };
});

/** Which route a request names, with the raw, still-encoded message id for the open route. */
export function matchRoute(
  method: string,
  path: string,
): { route: AuthRoute; id: string | undefined } | undefined {
  const opened =
    method === "POST"
      ? /^\/api\/development-inbox\/messages\/([^/]+)\/open$/.exec(path)?.[1]
      : undefined;
  if (opened !== undefined)
    return { route: "POST /api/development-inbox/messages/:id/open", id: opened };
  const named = `${method} ${path}`;
  const route = authRoutes.find((candidate) => candidate === named);
  return route === undefined ? undefined : { route, id: undefined };
}

/** Whether Host and Origin name the configured browser origin. A POST must carry Origin. */
export function fromBrowserOrigin(request: Request, origin: URL): boolean {
  const supplied = request.headers.get("origin");
  return (
    (request.headers.get("host") ?? new URL(request.url).host) === origin.host &&
    (supplied === null || supplied === origin.origin) &&
    (request.method !== "POST" || supplied === origin.origin)
  );
}
