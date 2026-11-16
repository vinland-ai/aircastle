import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router'
import App from './App'
import { MarketingPage } from '@/features/marketing'
import { NotFoundPage } from '@/features/not-found'
import { EarlyAccessSignInPage } from '@/features/sign-in'
import { landingDescription, landingTitle, signInTitle } from '@/metadata'

const rootRoute = createRootRoute({
  component: () => (
    <App>
      <Outlet />
    </App>
  ),
  notFoundComponent: NotFoundPage,
  head: () => ({ meta: [{ name: 'description', content: landingDescription }] }),
})
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  head: () => ({ meta: [{ title: landingTitle }] }),
  component: () => <MarketingPage earlyAccess />,
})
const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-in',
  head: () => ({ meta: [{ title: signInTitle }] }),
  component: EarlyAccessSignInPage,
})
const everyOtherRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$',
  beforeLoad: () => {
    throw redirect({ to: '/', replace: true })
  },
})

/**
 * The landing-only build's router, which replaces `router.tsx` when Vite builds with `--mode landing`.
 * It serves the landing page and an early-access sign-in without authentication, and sends every other path to `/`.
 */
export function createAppRouter(history: RouterHistory) {
  return createRouter({
    routeTree: rootRoute.addChildren([indexRoute, signInRoute, everyOtherRoute]),
    history,
    disableGlobalCatchBoundary: true,
  })
}
