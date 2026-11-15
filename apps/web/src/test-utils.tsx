import { displayHttp, ok } from '@/display-http'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { createAppRouter } from './router'

const protectedPath =
  '/dash/workspaces/11111111-1111-4111-8111-111111111111/projects/22222222-2222-4222-8222-222222222222/collections'
const session = {
  user: {
    id: 'shell-display-user',
    name: 'Shell Test User',
    email: 'shell@example.test',
    authority: 'super_user',
  },
  expiresAt: Date.UTC(2030, 0, 15),
}

export function authenticatedDisplayHttp() {
  return displayHttp({
    'GET /api/auth/state': () => ok({ kind: 'authenticated', session }),
    'POST /api/auth/activity': () => ok(session),
    'POST /api/auth/entry': async (request) => {
      const entry = await request.json()
      return ok({
        destination: entry.kind === 'visit' ? entry.destination : { kind: 'workspaces' },
        session,
      })
    },
  })
}

export async function renderApp(path = protectedPath, http = authenticatedDisplayHttp()) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }), {
    fetch: http.fetch,
  })
  await act(async () => {
    await router.load()
    render(<RouterProvider router={router} />)
  })
  await screen.findByRole('main')
  return { router, user: userEvent.setup() }
}
