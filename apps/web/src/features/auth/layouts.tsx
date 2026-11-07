import { Outlet, useRouter } from '@tanstack/react-router'
import App from '@/App'
import { AppShell } from '@/components/shell'
import { Button } from '@/components/ui/button'
import { useAuth, useSignedIn } from './context'

export function AuthRoot() {
  const { view } = useAuth()
  const router = useRouter()
  return (
    <App>
      {view.kind === 'disabled' ? (
        <main className="p-8">
          Local authentication is not enabled. For local development, set AIRCASTLE_ENV=development.
        </main>
      ) : view.kind === 'failure' ? (
        <main className="space-y-4 p-8">
          <p role="alert">Could not load your session. Please try again.</p>
          <Button onClick={() => void router.invalidate()}>Retry</Button>
        </main>
      ) : (
        <Outlet />
      )}
    </App>
  )
}

export function DashboardLayout() {
  const { session, signOut, signOutFailed } = useSignedIn()
  return (
    <AppShell account={{ user: session.user, signOut }}>
      {signOutFailed && <p role="alert">Could not sign out. Try again.</p>}
      <Outlet />
    </AppShell>
  )
}
