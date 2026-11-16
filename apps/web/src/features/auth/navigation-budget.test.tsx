import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { displayHttp, ok } from '@/display-http'
import { failure, mountAuth, protectedPath, session } from './test-support'

describe('Auth calls per navigation', () => {
  const workspace = '11111111-1111-4111-8111-111111111111'
  const renewed = { ...session, user: { ...session.user, name: 'Renewed Name' } }
  function counted(access: 'member' | 'outsider' = 'member') {
    return displayHttp({
      'GET /api/auth/state': () => ok({ kind: 'authenticated', session }),
      'POST /api/auth/activity': () => ok(renewed),
      'POST /api/auth/entry': async (request) => {
        const body = await request.json()
        if (
          body.kind === 'visit' &&
          body.destination.kind !== 'workspaces' &&
          access === 'outsider'
        )
          return failure('forbidden', 403)
        return ok({
          destination: body.kind === 'visit' ? body.destination : { kind: 'workspaces' },
          session: renewed,
        })
      },
    })
  }
  const sent = (http: ReturnType<typeof displayHttp>) =>
    http.requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)

  const projectBase = `/dash/workspaces/${workspace}/projects/22222222-2222-4222-8222-222222222222`
  const entered = ['GET /api/auth/state', 'POST /api/auth/entry']

  it.each([
    ['/dash/workspaces', ['heading', 'Workspaces'], entered],
    [`/dash/workspaces/${workspace}/projects`, ['heading', 'Projects'], entered],
    [
      '/dash/workspaces/new',
      ['heading', 'Create a workspace'],
      ['GET /api/auth/state', 'POST /api/auth/activity'],
    ],
    ['/dash', ['heading', 'Workspaces'], entered],
    [projectBase, ['navigation', 'Main navigation'], entered],
    [`${projectBase}/`, ['navigation', 'Main navigation'], entered],
  ] as const)('%s renews once in at most two auth calls', async (path, [role, name], calls) => {
    const http = counted()
    await mountAuth(path, http)

    expect(await screen.findByRole(role, { name })).toBeTruthy()
    expect(sent(http)).toEqual(calls)
  })

  it('a denied visit asks once per hop and never reads the session separately', async () => {
    const http = counted('outsider')
    const { router } = await mountAuth(`/dash/workspaces/${workspace}/projects`, http)

    expect(await screen.findByRole('heading', { name: 'Workspaces' })).toBeTruthy()
    expect(router.state.location.pathname).toBe('/dash/workspaces')
    expect(sent(http)).toEqual([
      'GET /api/auth/state',
      'POST /api/auth/entry',
      'POST /api/auth/entry',
    ])
  })

  it('renders the account from the renewing call, not the earlier state read', async () => {
    const { user } = await mountAuth(protectedPath, counted())
    await user.click(await screen.findByRole('button', { name: 'Open account menu' }))

    expect(
      within(await screen.findByRole('menu')).getByText('Renewed Name', { exact: true }),
    ).toBeTruthy()
  })
})
