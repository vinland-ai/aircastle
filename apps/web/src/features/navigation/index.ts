import { navigationGroups } from '@/features/navigation/pages'

export { SidebarNavigation, PageSearch } from './navigation'
export { projectHref, useProjectParams, type ProjectParams } from './project'
export { navigationGroups }

export const navigationPages = navigationGroups.flatMap((group) =>
  group.items.map(({ slug, title }) => ({ slug, title })),
)

export type ProjectPageSlug = (typeof navigationPages)[number]['slug']

export function pageMetadata(slug: ProjectPageSlug) {
  const page = navigationPages.find((candidate) => candidate.slug === slug)
  return { title: `Aircastle - ${page?.title}` }
}
