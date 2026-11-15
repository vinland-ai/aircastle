import { protectedDestination, type ProtectedDestination } from '@aircastle/contracts'

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

/** Visits the destination if the shared contract accepts it. Ids reach the server in lower case. */
const visit = (destination: unknown): Guard =>
  protectedDestination.allows(destination) ? { kind: 'visit', destination } : { kind: 'denied' }

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
  workspaceProjects: protectedRoute((params) =>
    visit({ kind: 'workspace-projects', workspaceId: params.workspaceId?.toLowerCase() }),
  ),
  projectPage: (page: ProjectPage) =>
    protectedRoute((params) =>
      visit({
        kind: 'project-page',
        workspaceId: params.workspaceId?.toLowerCase(),
        projectId: params.projectId?.toLowerCase(),
        page,
      }),
    ),
} as const satisfies Record<string, RouteAccess | ((page: ProjectPage) => RouteAccess)>

/**
 * Access for a path that matches no route. Under `/dash`, in any casing, the not-found page needs a
 * session so a signed-out visit goes to sign-in; elsewhere it is public.
 */
export const unmatchedAccess = (pathname: string): RouteAccess =>
  /^\/dash(?:\/|$)/i.test(pathname) ? access.session : access.public
