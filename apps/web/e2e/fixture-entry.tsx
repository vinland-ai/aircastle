import { displayHttp, ok } from '../src/display-http'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createBrowserHistory } from '@tanstack/react-router'
import { AppErrorBoundary } from '../src/features/error-recovery'
import { createAppRouter } from '../src/router'
import { shellData } from './fixtures'
import '../src/index.css'

const { user } = shellData(new URLSearchParams(location.search).get('scenario'))
const session = {
  user: { ...user, id: 'display-only-shell-user', authority: 'super_user' },
  expiresAt: Date.UTC(2030, 0, 15),
}
const display = displayHttp(
  {
    'GET /api/auth/state': () =>
      ok(
        location.pathname === '/sign-in'
          ? { kind: 'signed-out' }
          : { kind: 'authenticated', session },
      ),
    'POST /api/auth/activity': () => ok(session),
    'POST /api/auth/entry': async (request) => {
      const entry = await request.json()
      return ok({
        session,
        destination:
          entry.kind === 'visit'
            ? entry.destination
            : {
                kind: 'project-page',
                workspaceId: '11111111-1111-4111-8111-111111111111',
                projectId: '22222222-2222-4222-8222-222222222222',
                page: 'collections',
              },
      })
    },
  },
  location.href,
)
const router = createAppRouter(createBrowserHistory(), { fetch: display.fetch })

document
  .querySelectorAll('head > title, head > meta[name="description"]')
  .forEach((element) => element.remove())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <RouterProvider router={router} />
    </AppErrorBoundary>
  </StrictMode>,
)
