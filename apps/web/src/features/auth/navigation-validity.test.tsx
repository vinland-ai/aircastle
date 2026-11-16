import { act, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { displayHttp, ok } from '@/display-http'
import {
  deferredResponse,
  expectNoShell,
  failure,
  mountAuth,
  protectedPath,
  session,
} from './test-support'

describe('[auth:R7] a checked view lasts one navigation', () => {
  const variants = [
    ['a case-variant prefix', protectedPath.replace('/dash/', '/Dash/')],
    ['a case-variant leaf', protectedPath.replace('/collections', '/COLLECTIONS')],
  ] as const
  function revocable() {
    const server = { signedIn: true, member: true }
    const http = displayHttp({
      'GET /api/auth/state': () =>
        ok(server.signedIn ? { kind: 'authenticated', session } : { kind: 'signed-out' }),
      'POST /api/auth/activity': () =>
        server.signedIn ? ok(session) : failure('unauthenticated', 401),
      'POST /api/auth/entry': async (request) => {
        if (!server.signedIn) return failure('unauthenticated', 401)
        const body = await request.json()
        if (body.kind === 'visit' && body.destination.kind !== 'workspaces' && !server.member)
          return failure('forbidden', 403)
        return ok({
          destination: body.kind === 'visit' ? body.destination : { kind: 'workspaces' },
          session,
        })
      },
    })
    return { server, http }
  }
  async function visitThenFollowSidebar(
    variant: string,
    end: (server: { signedIn: boolean; member: boolean }) => void,
  ) {
    const { server, http } = revocable()
    const mounted = await mountAuth(variant, http)
    const navigation = await screen.findByRole('navigation', { name: 'Main navigation' })
    end(server)
    await mounted.user.click(within(navigation).getByRole('link', { name: 'Collections' }))
    return { ...mounted, http }
  }

  it.each(variants)(
    'after %s, a session that ended is sent to sign-in on the canonical page',
    async (_, variant) => {
      const { router, http } = await visitThenFollowSidebar(variant, (server) => {
        server.signedIn = false
      })

      expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy()
      expect(router.state.location.pathname).toBe('/sign-in')
      expect(http.calls('/auth/state', 'GET')).toHaveLength(2)
      expectNoShell()
    },
  )

  it.each(variants)(
    'after %s, removed workspace access is denied on the canonical page',
    async (_, variant) => {
      const { router } = await visitThenFollowSidebar(variant, (server) => {
        server.member = false
      })

      expect(await screen.findByRole('heading', { name: 'Workspaces' })).toBeTruthy()
      expect(router.state.location.pathname).toBe('/dash/workspaces')
      expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull()
    },
  )

  it('after a case variant and a public page, a session that ended is sent to sign-in', async () => {
    const { server, http } = revocable()
    const { history, router } = await mountAuth(variants[0][1], http)
    await screen.findByRole('navigation', { name: 'Main navigation' })
    await act(async () => history.push('/'))
    expect(await screen.findByRole('navigation', { name: 'Marketing navigation' })).toBeTruthy()
    server.signedIn = false
    await act(async () => history.push(protectedPath))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/sign-in')
    expectNoShell()
  })

  it('a project base visit that a newer navigation supersedes leaves nothing for the next visit', async () => {
    const server = { signedIn: true }
    const held = deferredResponse()
    const http = displayHttp({
      'GET /api/auth/state': () =>
        ok(server.signedIn ? { kind: 'authenticated', session } : { kind: 'signed-out' }),
      'POST /api/auth/entry': async (request) => {
        const { destination } = await request.json()
        await held.promise
        return ok({ destination, session })
      },
    })
    const { history, router } = await mountAuth('/', http)
    await screen.findByRole('navigation', { name: 'Marketing navigation' })
    await act(async () => history.push(protectedPath.replace(/\/collections$/, '')))
    await waitFor(() => expect(http.calls('/auth/entry')).toHaveLength(1))
    await act(async () => history.push('/'))
    await waitFor(() => expect(router.state.status).toBe('idle'))
    await act(async () => {
      held.resolve(new Response(null))
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    server.signedIn = false
    await act(async () => history.push(protectedPath))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/sign-in')
    expectNoShell()
  })
})
