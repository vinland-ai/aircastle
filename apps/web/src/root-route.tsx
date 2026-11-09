import { createRootRoute } from '@tanstack/react-router'
import App from './App'
import { NotFoundPage } from '@/features/not-found'
import { landingDescription } from '@/metadata'

/** The root shared by the full app and the landing-only build: theme, metadata and the 404 page. */
export const rootRoute = createRootRoute({
  component: App,
  notFoundComponent: NotFoundPage,
  head: () => ({
    meta: [
      {
        name: 'description',
        content: landingDescription,
      },
    ],
  }),
})
