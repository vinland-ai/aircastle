import type {
  AuthDestination,
  AuthFailure,
  AuthSession,
  AuthState,
  DevelopmentInboxEntry,
  LinkPreview,
  ProtectedDestination,
} from '@aircastle/contracts'

export interface AuthBrowserOptions {
  fetch?: typeof globalThis.fetch
}

export type HttpResult<Value> = { kind: 'ok'; value: Value } | AuthFailure

type Purpose = LinkPreview['purpose']

/** What a signed-in browser asks `/auth/entry` to resolve, check or record. */
export type EntryBody =
  | { kind: 'resolve' }
  | { kind: 'visit'; destination: ProtectedDestination }
  | { kind: 'skip-onboarding' }

/** Where `/auth/entry` sends the browser, with the renewed session. */
export type Entered = { destination: AuthDestination; session: AuthSession }

/** An account request: the validated form input and the destination to return to, if any. */
export type AccountRequest = { email: string; name?: string; returnTo?: ProtectedDestination }

/**
 * One method per auth and inbox endpoint, each with its HTTP verb and result type. A request
 * without a body is a GET; every other request POSTs JSON.
 */
export function createAuthApi(options: AuthBrowserOptions) {
  const request = createRequest(options)
  return {
    state: (signal?: AbortSignal) => request<AuthState>('/auth/state', undefined, signal),
    preview: (purpose: Purpose, token: string, signal?: AbortSignal) =>
      request<LinkPreview>('/auth/confirm/preview', { purpose, token }, signal),
    confirm: (purpose: Purpose, token: string) =>
      request<{ destination: AuthDestination }>('/auth/confirm', { purpose, token }),
    requestLink: (purpose: Purpose, input: AccountRequest) =>
      request<{ confirmation: 'setup-inbox' | 'sign-in-inbox' }>(`/auth/${purpose}`, input),
    activity: (signal?: AbortSignal) => request<AuthSession>('/auth/activity', {}, signal),
    entry: (body: EntryBody, signal?: AbortSignal) => request<Entered>('/auth/entry', body, signal),
    signOut: () => request<{ destination: string }>('/auth/sign-out', {}),
    inbox: {
      list: () => request<readonly DevelopmentInboxEntry[]>('/development-inbox/messages'),
      open: (id: string) =>
        request<DevelopmentInboxEntry>(
          `/development-inbox/messages/${encodeURIComponent(id)}/open`,
          {},
        ),
    },
  }
}

function createRequest(options: AuthBrowserOptions) {
  const transport = options.fetch ?? globalThis.fetch.bind(globalThis)
  return async function request<Value>(
    path: string,
    body?: object,
    signal?: AbortSignal,
  ): Promise<HttpResult<Value>> {
    try {
      const response = await transport(`/api${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        signal: signal ?? null,
        ...(body === undefined
          ? {}
          : {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }),
      })
      const result: HttpResult<Value> = await response.json()
      return response.ok && result.kind === 'ok'
        ? result
        : result.kind === 'ok'
          ? { kind: 'temporary-failure' }
          : result
    } catch {
      return { kind: 'temporary-failure' }
    }
  }
}

export function destinationPath(destination: AuthDestination): string {
  switch (destination.kind) {
    case 'dashboard':
      return '/dash'
    case 'create-workspace':
      return '/dash/workspaces/new'
    case 'workspaces':
      return '/dash/workspaces'
    case 'workspace-projects':
      return `/dash/workspaces/${encodeURIComponent(destination.workspaceId)}/projects`
    case 'project-page':
      return `/dash/workspaces/${encodeURIComponent(destination.workspaceId)}/projects/${encodeURIComponent(destination.projectId)}/${encodeURIComponent(destination.page)}`
  }
}
