import { redirect } from '@tanstack/react-router'
import type { RouteAccess, RouteParams } from './access'
import { decideHop, type AuthView, type Entered, type Handoff, type Memory } from './guard'
import { createAuthHttp, type AuthBrowserOptions } from './http'

export function createBrowserAuth(options: AuthBrowserOptions = {}) {
  const request = createAuthHttp(options)
  let memory: Memory = { requested: undefined, confirmation: undefined }
  let handoff: Handoff | undefined
  return {
    request,
    get returnTo() {
      return memory.requested
    },
    clearConfirmation() {
      memory = { ...memory, confirmation: undefined }
    },
    settle() {
      handoff = undefined
    },
    async entry(body: object) {
      return request<Entered>('/auth/entry', body)
    },
    /**
     * Runs one hop of a navigation. It takes the handoff left for this path, decides the hop, and
     * commits the memory and next handoff only if no newer navigation aborted it.
     */
    async enter(
      route: { access: RouteAccess; params: RouteParams },
      path: string,
      search: Record<string, unknown>,
      signal: AbortSignal,
    ): Promise<AuthView> {
      const handed = handoff?.path === path ? handoff : undefined
      handoff = undefined
      const token = typeof search.token === 'string' && search.token ? search.token : undefined
      const hop = await decideHop({ ...route, path, token }, memory, handed, {
        state: () => request('/auth/state', undefined, signal),
        preview: (purpose, value) =>
          request('/auth/confirm/preview', { purpose, token: value }, signal),
        activity: () => request('/auth/activity', {}, signal),
        entry: (body) => request('/auth/entry', body, signal),
      })
      if (signal.aborted) return { kind: 'failure' }
      memory = hop.memory
      handoff = hop.handoff
      if (hop.kind === 'redirect') throw redirect({ href: hop.to, replace: true })
      return hop.view
    },
  }
}

export type BrowserAuth = ReturnType<typeof createBrowserAuth>
