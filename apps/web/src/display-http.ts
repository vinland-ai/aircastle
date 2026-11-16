type Handler = (request: Request) => Response | Promise<Response>

export function ok(value: unknown) {
  return Response.json({ kind: 'ok', value })
}

export function displayHttp(routes: Record<string, Handler> = {}, baseUrl = window.location.href) {
  const requests: Request[] = []
  const handlers: Record<string, Handler> = {
    'GET /api/auth/state': () => ok({ kind: 'signed-out' }),
    ...routes,
  }
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input instanceof Request ? input : new URL(input, baseUrl), init)
    requests.push(request.clone())
    const handler = handlers[`${request.method} ${new URL(request.url).pathname}`]
    return handler
      ? handler(request.clone())
      : Response.json({ kind: 'temporary-failure' }, { status: 503 })
  }
  function calls(path: string, method = 'POST') {
    return requests.filter(
      (request) => request.method === method && new URL(request.url).pathname === `/api${path}`,
    )
  }
  return { fetch, calls, requests }
}
