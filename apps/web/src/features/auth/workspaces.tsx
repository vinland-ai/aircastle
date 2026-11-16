import { useState, type ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
import { AccountControls } from '@/components/shell'
import { Button } from '@/components/ui/button'
import { useAuth, useSignedIn } from './context'
import { destinationPath } from './http'

function WorkspaceFrame({ title, children }: { title: string; children: ReactNode }) {
  const { session, signOut, signOutFailed } = useSignedIn()
  return (
    <>
      {signOutFailed && <p role="alert">Could not sign out. Try again.</p>}
      <main data-theme-scope="dashboard" className="min-h-svh">
        <header className="flex items-center justify-between border-b px-6 py-4">
          <a href="/dash/workspaces" aria-label="Aircastle">
            <span aria-hidden="true" className="brand-logo block size-7" />
          </a>
          <div className="flex items-center gap-4">
            <AccountControls account={{ user: session.user, signOut }} />
          </div>
        </header>
        <div className="mx-auto max-w-5xl space-y-6 px-6 py-12">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {children}
        </div>
      </main>
    </>
  )
}

const createWorkspaceLink = (
  <a href="/dash/workspaces/new" className="underline underline-offset-4">
    Create workspace
  </a>
)

export function WorkspacesPage() {
  return <WorkspaceFrame title="Workspaces">{createWorkspaceLink}</WorkspaceFrame>
}

export function ProjectsPage() {
  return (
    <WorkspaceFrame title="Projects">
      {createWorkspaceLink}
      <a className="block underline underline-offset-4" href="/dash/workspaces">
        Workspaces
      </a>
    </WorkspaceFrame>
  )
}

export function CreateWorkspacePage() {
  const { auth } = useAuth()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  async function skipOnboarding() {
    if (pending) return
    setPending(true)
    const result = await auth.api.entry({ kind: 'skip-onboarding' })
    setPending(false)
    if (result.kind === 'ok')
      await router.navigate({ href: destinationPath(result.value.destination) })
    else if (result.kind === 'unauthenticated') await router.navigate({ to: '/sign-in' })
    else setError(true)
  }
  return (
    <WorkspaceFrame title="Create a workspace">
      <div className="flex gap-3">
        <Button disabled={pending} onClick={skipOnboarding}>
          Skip
        </Button>
        <Button variant="ghost" disabled={pending} onClick={skipOnboarding}>
          Close
        </Button>
      </div>
      {error && <p role="alert">Could not continue. Try again.</p>}
    </WorkspaceFrame>
  )
}
