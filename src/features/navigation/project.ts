'use client'


import { useParams } from 'next/navigation'

export interface ProjectParams {
  workspaceId: string
  projectId: string
}

export function useProjectParams() {
  return useParams<ProjectParams & Record<string, string>>()
}

export function projectHref({ workspaceId, projectId }: ProjectParams, slug: string) {
  return `/dash/workspaces/${workspaceId}/projects/${projectId}/${slug}`
}
