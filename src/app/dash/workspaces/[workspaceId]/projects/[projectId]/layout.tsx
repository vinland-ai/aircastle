import { Suspense } from 'react'
import { AppShell } from '@/components/shell'

export default function ProjectLayout({
  children,
}: LayoutProps<'/dash/workspaces/[workspaceId]/projects/[projectId]'>) {
  return (
    <Suspense>
      <AppShell>{children}</AppShell>
    </Suspense>
  )
}
