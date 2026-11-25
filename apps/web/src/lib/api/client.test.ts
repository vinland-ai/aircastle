import { afterAll, expect, test } from 'bun:test'

const authorizations: (string | null)[] = []

const api = Bun.serve({
  port: 0,
  routes: {
    '/v1/me': (request) => {
      authorizations.push(request.headers.get('Authorization'))
      return Response.json({ id: 'user_2abc' })
    },
  },
  fetch: () => new Response(null, { status: 404 }),
})

process.env.NEXT_PUBLIC_API_URL = api.url.origin
const { getMe } = await import('./generated')
const { setTokenGetter } = await import('./client-config')

afterAll(() => api.stop())

test('getMe calls the configured API with the session token as a bearer token', async () => {
  setTokenGetter(async () => 'session-token')

  const { data } = await getMe()

  expect(data?.id).toBe('user_2abc')
  expect(authorizations.at(-1)).toBe('Bearer session-token')
})

test('getMe sends no Authorization header when signed out', async () => {
  setTokenGetter(async () => null)

  await getMe()

  expect(authorizations.at(-1)).toBeNull()
})
