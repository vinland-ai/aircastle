import { Suspense } from 'react'
import { AppShell } from '@/components/shell'
import { DashboardSkeleton } from '@/components/dashboard-skeleton'

export function generateStaticParams() {
  return [{ workspaceId: 'demo', projectId: 'demo' }]
}

export default function ProjectLayout({
  children,
}: LayoutProps<'/dash/workspaces/[workspaceId]/projects/[projectId]'>) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <AppShell>{children}</AppShell>
    </Suspense>
  )
}
