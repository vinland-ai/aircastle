import { redirect } from '@tanstack/react-router'
import type { RouteAccess, RouteParams } from './access'
import { decideHop, type AuthView, type Handoff, type Memory } from './guard'
import { createAuthApi, type AuthBrowserOptions } from './http'

export function createBrowserAuth(options: AuthBrowserOptions = {}) {
  const api = createAuthApi(options)
  let memory: Memory = { requested: undefined, confirmation: undefined }
  let handoff: Handoff | undefined
  return {
    api,
    get returnTo() {
      return memory.requested
    },
    clearConfirmation() {
      memory = { ...memory, confirmation: undefined }
    },
    settle() {
      handoff = undefined
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
        state: () => api.state(signal),
        preview: (purpose, value) => api.preview(purpose, value, signal),
        activity: () => api.activity(signal),
        entry: (body) => api.entry(body, signal),
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
