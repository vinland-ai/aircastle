import { createRoute, createRouter, redirect, type RouterHistory } from '@tanstack/react-router'
import { MarketingPage } from '@/features/marketing'
import { SignInPage } from '@/features/sign-in'
import { landingTitle, signInTitle } from '@/metadata'
import { rootRoute } from './root-route'

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
  component: () => <SignInPage earlyAccess />,
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
 * It serves the landing page and an early-access sign-in, and sends every other path to `/`.
 */
export function createAppRouter(history: RouterHistory) {
  return createRouter({
    routeTree: rootRoute.addChildren([indexRoute, signInRoute, everyOtherRoute]),
    history,
    disableGlobalCatchBoundary: true,
  })
}
