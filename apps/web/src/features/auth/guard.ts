import type {
  AuthDestination,
  AuthSession,
  AuthState,
  LinkPreview,
  ProtectedDestination,
} from '@aircastle/contracts'
import type { Guard, RouteAccess, RouteParams } from './access'
import { destinationPath, type HttpResult } from './http'

type Purpose = LinkPreview['purpose']

export type Confirmation = { purpose: Purpose; token: string; preview: HttpResult<LinkPreview> }

export type AuthView =
  | { kind: 'public' }
  | { kind: 'authenticated'; session: AuthSession }
  | { kind: 'disabled' }
  | { kind: 'failure' }
type SessionView = Extract<AuthView, { kind: 'authenticated' }>

/** What one hop hands the next hop at `path`, so that hop skips the calls already made. */
export type Handoff = { path: string } & (
  | { kind: 'state'; state: AuthState }
  | { kind: 'view'; view: SessionView }
)

/** What the guard remembers between navigations. */
export interface Memory {
  requested: ProtectedDestination | undefined
  confirmation: Confirmation | undefined
}

/** A decided hop, with the memory and handoff it leaves. The caller commits them. */
export type Hop = { memory: Memory; handoff: Handoff | undefined } & (
  | { kind: 'render'; view: AuthView }
  | { kind: 'redirect'; to: string }
)

export type Entered = { destination: AuthDestination; session: AuthSession }
type EntryRequest =
  | { kind: 'resolve' }
  | { kind: 'visit'; destination: ProtectedDestination }

/** The server calls a hop may make. */
export interface AuthCalls {
  state: () => Promise<HttpResult<AuthState>>
  preview: (purpose: Purpose, token: string) => Promise<HttpResult<LinkPreview>>
  activity: () => Promise<HttpResult<AuthSession>>
  entry: (body: EntryRequest) => Promise<HttpResult<Entered>>
}

/** The matched route of one hop, its path, and the link token in its search, if any. */
export interface Visit {
  access: RouteAccess
  params: RouteParams
  path: string
  token: string | undefined
}

const render = (view: AuthView, memory: Memory, handoff?: Handoff): Hop => ({
  kind: 'render',
  view,
  memory,
  handoff,
})

const redirect = (to: string, memory: Memory, handoff?: Handoff): Hop => ({
  kind: 'redirect',
  to,
  memory,
  handoff,
})

const showsConfirmation = ({ access, token }: Visit, memory: Memory) =>
  access.kind === 'account' && !token && memory.confirmation?.purpose === access.purpose

/**
 * Decides one hop of a navigation without touching the router or module state. A hop reads the
 * instance state unless a handoff supplies it, then makes at most one preview or renewing call.
 */
export async function decideHop(
  visit: Visit,
  memory: Memory,
  handed: Handoff | undefined,
  calls: AuthCalls,
): Promise<Hop> {
  if (visit.access.kind === 'public' || showsConfirmation(visit, memory))
    return render({ kind: 'public' }, memory)
  if (handed?.kind === 'view') return render(handed.view, memory)
  const state = handed ? ({ kind: 'ok', value: handed.state } as const) : await calls.state()
  if (state.kind !== 'ok') return render({ kind: 'failure' }, memory)
  return decideWithState(visit, state.value, memory, calls)
}

async function decideWithState(
  visit: Visit,
  state: AuthState,
  memory: Memory,
  calls: AuthCalls,
): Promise<Hop> {
  const { access, token } = visit
  const settled: Memory = { ...memory, confirmation: undefined }
  if (state.kind === 'disabled') return render({ kind: 'disabled' }, settled)
  if (access.kind === 'account' && token) {
    const preview = await calls.preview(access.purpose, token)
    return redirect(visit.path, {
      ...memory,
      confirmation: { purpose: access.purpose, token, preview },
    })
  }
  if (access.kind === 'inbox') {
    if (state.kind === 'authenticated') await calls.activity()
    return render({ kind: 'public' }, settled)
  }
  const guard: Guard = access.kind === 'protected' ? access.guard(visit.params) : { kind: 'denied' }
  return state.kind === 'authenticated'
    ? decideSignedIn(visit.path, guard, state, settled, calls)
    : decideSignedOut(visit.path, guard, state, settled)
}

function decideSignedOut(path: string, guard: Guard, state: AuthState, memory: Memory): Hop {
  const remembered: Memory = {
    ...memory,
    requested: guard.kind === 'visit' ? guard.destination : memory.requested,
  }
  const target = state.kind === 'setup-required' ? '/setup' : '/sign-in'
  return path === target
    ? render({ kind: 'public' }, remembered)
    : redirect(target, remembered, { path: target, kind: 'state', state })
}

async function decideSignedIn(
  path: string,
  guard: Guard,
  state: AuthState,
  memory: Memory,
  calls: AuthCalls,
): Promise<Hop> {
  const toDashboard = redirect('/dash', memory, { path: '/dash', kind: 'state', state })
  const toSignIn = redirect('/sign-in', memory, {
    path: '/sign-in',
    kind: 'state',
    state: { kind: 'signed-out' },
  })
  if (guard.kind === 'denied') return toDashboard
  if (guard.kind === 'session') {
    const activity = await calls.activity()
    if (activity.kind === 'unauthenticated') return toSignIn
    if (activity.kind !== 'ok') return render({ kind: 'failure' }, memory)
    return render({ kind: 'authenticated', session: activity.value }, memory)
  }
  const entry = await calls.entry(
    guard.kind === 'resolve' ? guard : { kind: 'visit', destination: guard.destination },
  )
  if (entry.kind === 'unauthenticated') return toSignIn
  if (entry.kind === 'forbidden') return toDashboard
  if (entry.kind !== 'ok') return render({ kind: 'failure' }, memory)
  const view = { kind: 'authenticated', session: entry.value.session } as const
  if (guard.kind === 'resolve') {
    const to = destinationPath(entry.value.destination)
    return redirect(to, { ...memory, requested: undefined }, { path: to, kind: 'view', view })
  }
  const canonical = destinationPath(guard.destination)
  return render(
    view,
    memory,
    canonical === path ? undefined : { path: canonical, kind: 'view', view },
  )
}
