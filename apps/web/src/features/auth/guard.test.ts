import type { AuthSession, AuthState, LinkPreview } from '@aircastle/contracts'
import { describe, expect, it } from 'vite-plus/test'
import { access } from './access'
import { decideHop, type AuthCalls, type Entered, type Memory } from './guard'
import type { HttpResult } from './http'

const session: AuthSession = {
  user: { id: 'u', name: 'Alex', email: 'alex@example.test', authority: 'super_user' },
  expiresAt: 0,
}
const empty: Memory = { requested: undefined, confirmation: undefined }
const workspaceId = '11111111-1111-4111-8111-111111111111'
const projectId = '22222222-2222-4222-8222-222222222222'
const base = `/dash/workspaces/${workspaceId}/projects/${projectId}`

function fakeCalls(answers: {
  state?: HttpResult<AuthState>
  preview?: HttpResult<LinkPreview>
  activity?: HttpResult<AuthSession>
  entry?: HttpResult<Entered>
}) {
  const made: string[] = []
  const unavailable = { kind: 'temporary-failure' } as const
  const calls: AuthCalls = {
    state: async () => {
      made.push('state')
      return answers.state ?? unavailable
    },
    preview: async () => {
      made.push('preview')
      return answers.preview ?? unavailable
    },
    activity: async () => {
      made.push('activity')
      return answers.activity ?? unavailable
    },
    entry: async () => {
      made.push('entry')
      return answers.entry ?? unavailable
    },
  }
  return { made, calls }
}

describe('decideHop', () => {
  it('a project base visit renders and hands its view to the canonical page', async () => {
    const destination = {
      kind: 'project-page',
      workspaceId,
      projectId,
      page: 'collections',
    } as const
    const { made, calls } = fakeCalls({
      state: { kind: 'ok', value: { kind: 'authenticated', session } },
      entry: { kind: 'ok', value: { destination, session } },
    })
    const hop = await decideHop(
      {
        access: access.projectPage('collections'),
        params: { workspaceId, projectId },
        path: base,
        token: undefined,
      },
      empty,
      undefined,
      calls,
    )

    expect(made).toEqual(['state', 'entry'])
    expect(hop).toEqual({
      kind: 'render',
      view: { kind: 'authenticated', session },
      memory: empty,
      handoff: {
        path: `${base}/collections`,
        kind: 'view',
        view: { kind: 'authenticated', session },
      },
    })
  })

  it('a signed-out visit remembers the destination and hands its state to sign-in', async () => {
    const { made, calls } = fakeCalls({ state: { kind: 'ok', value: { kind: 'signed-out' } } })
    const hop = await decideHop(
      { access: access.workspaces, params: {}, path: '/dash/workspaces', token: undefined },
      empty,
      undefined,
      calls,
    )

    expect(made).toEqual(['state'])
    expect(hop).toEqual({
      kind: 'redirect',
      to: '/sign-in',
      memory: { requested: { kind: 'workspaces' }, confirmation: undefined },
      handoff: { path: '/sign-in', kind: 'state', state: { kind: 'signed-out' } },
    })
  })

  it('a link visit remembers its preview and redirects to the same page without the token', async () => {
    const preview = {
      kind: 'ok',
      value: { email: 'alex@example.test', purpose: 'sign-in' },
    } as const
    const { made, calls } = fakeCalls({
      state: { kind: 'ok', value: { kind: 'signed-out' } },
      preview,
    })
    const hop = await decideHop(
      { access: access.signIn, params: {}, path: '/sign-in', token: 'link-token' },
      empty,
      undefined,
      calls,
    )

    expect(made).toEqual(['state', 'preview'])
    expect(hop).toEqual({
      kind: 'redirect',
      to: '/sign-in',
      memory: {
        requested: undefined,
        confirmation: { purpose: 'sign-in', token: 'link-token', preview },
      },
      handoff: undefined,
    })
  })

  it('a handed view renders without asking the server', async () => {
    const { made, calls } = fakeCalls({})
    const view = { kind: 'authenticated', session } as const
    const hop = await decideHop(
      { access: access.session, params: {}, path: '/dash/workspaces/new', token: undefined },
      empty,
      { path: '/dash/workspaces/new', kind: 'view', view },
      calls,
    )

    expect(made).toEqual([])
    expect(hop).toEqual({ kind: 'render', view, memory: empty, handoff: undefined })
  })

  it('a forbidden visit hands its signed-in state to the dashboard', async () => {
    const state = { kind: 'authenticated', session } as const
    const { made, calls } = fakeCalls({
      state: { kind: 'ok', value: state },
      entry: { kind: 'forbidden' },
    })
    const hop = await decideHop(
      {
        access: access.workspaceProjects,
        params: { workspaceId },
        path: `/dash/workspaces/${workspaceId}/projects`,
        token: undefined,
      },
      empty,
      undefined,
      calls,
    )

    expect(made).toEqual(['state', 'entry'])
    expect(hop).toEqual({
      kind: 'redirect',
      to: '/dash',
      memory: empty,
      handoff: { path: '/dash', kind: 'state', state },
    })
  })
})
