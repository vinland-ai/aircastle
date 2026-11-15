import { useRouteContext, useRouter } from '@tanstack/react-router'
import { useState } from 'react'

/** The browser auth and the current navigation's view, from the root route's context. */
export const useAuth = () => useRouteContext({ from: '__root__' })

/**
 * The session and sign-out for a protected page. A protected page renders only after its guard
 * returned an authenticated view, so any other view is a bug.
 */
export function useSignedIn() {
  const { auth, view } = useAuth()
  const router = useRouter()
  const [signOutFailed, setSignOutFailed] = useState(false)
  if (view.kind !== 'authenticated') throw new Error('A protected page rendered without a session')
  async function signOut() {
    const result = await auth.api.signOut()
    if (result.kind === 'ok') await router.navigate({ to: '/sign-in', replace: true })
    else setSignOutFailed(true)
  }
  return { session: view.session, signOut, signOutFailed }
}
