import { useRouteContext } from '@tanstack/react-router'

/** The browser auth and the current navigation's view, from the root route's context. */
export const useAuth = () => useRouteContext({ from: '__root__' })
