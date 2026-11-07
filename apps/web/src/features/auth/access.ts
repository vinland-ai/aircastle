import type { ProtectedDestination } from '@aircastle/contracts'

/** A project page that a protected route can name, as the API accepts it. */
export type ProjectPage = Extract<ProtectedDestination, { kind: 'project-page' }>['page']

/** What a signed-in visit must prove before a protected route mounts. */
export type Guard =
  | { kind: 'denied' }
  | { kind: 'resolve' }
  | { kind: 'session' }
  | { kind: 'visit'; destination: ProtectedDestination }

/**
 * A route's access, declared on the route as `staticData.access` and read from the matched leaf.
 * A protected guard returns `denied` when the route's params are invalid.
 */
export type RouteParams = Readonly<{ workspaceId?: string; projectId?: string }>

export type RouteAccess =
  | { kind: 'public' | 'inbox' }
  | { kind: 'account'; purpose: 'setup' | 'sign-in' }
  | { kind: 'protected'; guard: (params: RouteParams) => Guard }

const uuid =
  /^(?:[\dA-Fa-f]{8}-[\dA-Fa-f]{4}-[1-8][\dA-Fa-f]{3}-[89ABab][\dA-Fa-f]{3}-[\dA-Fa-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/

const id = (value: string | undefined) =>
  value !== undefined && uuid.test(value) ? value.toLowerCase() : undefined

const protectedRoute = (guard: (params: RouteParams) => Guard) =>
  ({ kind: 'protected', guard }) as const satisfies RouteAccess

/** Access declarations for the router's routes. */
export const access = {
  public: { kind: 'public' },
  denied: protectedRoute(() => ({ kind: 'denied' })),
  setup: { kind: 'account', purpose: 'setup' },
  signIn: { kind: 'account', purpose: 'sign-in' },
  inbox: { kind: 'inbox' },
  dashboard: protectedRoute(() => ({ kind: 'resolve' })),
  session: protectedRoute(() => ({ kind: 'session' })),
  workspaces: protectedRoute(() => ({ kind: 'visit', destination: { kind: 'workspaces' } })),
  workspaceProjects: protectedRoute((params) => {
    const workspaceId = id(params.workspaceId)
    return workspaceId
      ? { kind: 'visit', destination: { kind: 'workspace-projects', workspaceId } }
      : { kind: 'denied' }
  }),
  projectPage: (page: ProjectPage) =>
    protectedRoute((params) => {
      const workspaceId = id(params.workspaceId)
      const projectId = id(params.projectId)
      return workspaceId && projectId
        ? { kind: 'visit', destination: { kind: 'project-page', workspaceId, projectId, page } }
        : { kind: 'denied' }
    }),
} as const satisfies Record<string, RouteAccess | ((page: ProjectPage) => RouteAccess)>

/**
 * Access for a path that matches no route. Under `/dash`, in any casing, the not-found page needs a
 * session so a signed-out visit goes to sign-in; elsewhere it is public.
 */
export const unmatchedAccess = (pathname: string): RouteAccess =>
  /^\/dash(?:\/|$)/i.test(pathname) ? access.session : access.public
