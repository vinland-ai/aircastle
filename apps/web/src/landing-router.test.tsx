import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { createAppRouter } from './landing-router'

const earlyAccessMessage =
  "Aircastle is in private early access. You're not on the access list yet."

async function renderLanding(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }))
  await router.load()
  render(<RouterProvider router={router} />)
  await screen.findByRole('main')
  return { router, user: userEvent.setup() }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('landing-only router', () => {
  it.each([
    '/dash',
    '/dash/workspaces/demo/projects/demo/collections',
    '/terms-of-service',
    '/privacy-policy',
    '/blog/meet-air',
    '/docs',
  ])('sends %s to the landing page', async (path) => {
    const { router } = await renderLanding(path)

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(await screen.findByRole('navigation', { name: 'Marketing navigation' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Toggle Sidebar' })).toBeNull()
  })

  it('sends Open Aircastle, Get started and See Aircastle in action to sign-in, and hides Docs', async () => {
    await renderLanding('/')

    for (const name of ['Open Aircastle', 'Get started', 'See Aircastle in action']) {
      expect(screen.getByRole('link', { name }).getAttribute('href')).toBe('/sign-in')
    }
    expect(screen.queryByRole('link', { name: 'Documentation' })).toBeNull()
  })

  it('answers every sign-in with the early-access message and sends nothing', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const { router, user } = await renderLanding('/sign-in')
    const email = screen.getByRole('textbox', { name: 'Email' })
    const status = screen.getByRole('status')

    expect(screen.queryByRole('link', { name: 'Terms of Service' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Privacy Policy' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Learn more' })).toBeNull()
    expect(email.hasAttribute('required')).toBe(true)

    await user.type(email, 'reader@example.com{Enter}')
    expect(status.textContent).toBe(earlyAccessMessage)

    await user.type(email, 'x')
    expect(status.textContent).toBe('')

    await user.click(screen.getByRole('button', { name: 'Send sign-in link' }))
    expect(status.textContent).toBe(earlyAccessMessage)
    expect(router.state.location.pathname).toBe('/sign-in')
    expect(fetch).not.toHaveBeenCalled()
  })
})
