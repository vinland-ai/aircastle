import type { AuthDestination, AuthFailure } from '@aircastle/contracts'

export interface AuthBrowserOptions {
  fetch?: typeof globalThis.fetch
}

export type HttpResult<Value> = { kind: 'ok'; value: Value } | AuthFailure

export function createAuthHttp(options: AuthBrowserOptions) {
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
