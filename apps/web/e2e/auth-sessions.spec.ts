import { installMountProbe, readMountProbe, resetShellProbe } from './mount-probe'
import { test, expect } from './auth-service'
import { expectInbox, expectPublicPage, expectSetup, expectSignIn, signOut } from './auth-journey'
import {
  fixtureHttpErrors,
  fourteenDays,
  uniqueEmail,
  heading,
  completeSetupAndSkip,
  signInWithLink,
  newSignedOutPage,
} from './auth-behavior-journey'

test('B76 an open inbox polling in the background does not extend the session', async ({
  page,
  authService,
}) => {
  await completeSetupAndSkip(page, uniqueEmail('polling'))
  await page.goto('/development-inbox')
  await expectInbox(page)
  await authService.advance(fourteenDays - 60_000)
  for (let polls = 0; polls < 2; polls++) {
    await page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/development-inbox/messages',
    )
  }
  await authService.advance(60_000)
  await page.goto('/dash/workspaces')
  await expectSignIn(page)
  await expectPublicPage(page)
})

test('B18 replaying the session cookie after sign-out does not restore access', async ({
  page,
}) => {
  const email = uniqueEmail('replay')
  await completeSetupAndSkip(page, email)
  const cookies = await page.context().cookies()
  expect(cookies.filter((cookie) => cookie.httpOnly).length).toBeGreaterThan(0)
  await signOut(page, 'Alex', email)
  await page.context().addCookies(cookies)
  await page.goto('/dash/workspaces')
  await expectSignIn(page)
  await expectPublicPage(page)
})

test('B19 signing out again from a second tab after the first tab signed out succeeds', async ({
  page,
}) => {
  const email = uniqueEmail('repeat')
  await completeSetupAndSkip(page, email)
  const second = await page.context().newPage()
  await second.goto('/dash/workspaces')
  await expect(heading(second, 'Workspaces')).toBeVisible()
  await signOut(page, 'Alex', email)
  await signOut(second, 'Alex', email)
  await expect(second.getByText('Could not sign out. Try again.')).toHaveCount(0)
})

test('B20 the back button after sign-out does not show the protected page', async ({ page }) => {
  await installMountProbe(page, 'signed-out-shell')
  const email = uniqueEmail('back')
  await completeSetupAndSkip(page, email)
  await page.getByRole('link', { name: 'Create workspace', exact: true }).click()
  await expect(heading(page, 'Create a workspace')).toBeVisible()
  await signOut(page, 'Alex', email)
  await resetShellProbe(page)
  await page.goBack()
  await expectSignIn(page)
  await expectPublicPage(page)
  expect(await readMountProbe(page, 'signed-out-shell')).toEqual([])
})

test('B21 another open tab follows the sign-out on its next navigation', async ({ page }) => {
  const email = uniqueEmail('tabs')
  await completeSetupAndSkip(page, email)
  const second = await page.context().newPage()
  await second.goto('/dash/workspaces')
  await expect(heading(second, 'Workspaces')).toBeVisible()
  await signOut(page, 'Alex', email)
  await second.getByRole('link', { name: 'Create workspace', exact: true }).click()
  await expectSignIn(second)
  await expectPublicPage(second)
})

test('B22 signing out in one browser leaves another browser signed in', async ({
  page,
  browser,
}) => {
  const email = uniqueEmail('other-browser')
  await completeSetupAndSkip(page, email)
  const other = await newSignedOutPage(browser, page)
  try {
    await signInWithLink(other.page, email)
    await expect(other.page).toHaveURL(/\/dash\/workspaces$/)
    await expect(heading(other.page, 'Workspaces')).toBeVisible()
    await signOut(page, 'Alex', email)
    await other.page.reload()
    await expect(heading(other.page, 'Workspaces')).toBeVisible()
    await other.page.goto('/dash/workspaces/new')
    await expect(heading(other.page, 'Create a workspace')).toBeVisible()
  } finally {
    await other.context.close()
  }
})

test('B24 a session left inactive for 14 days is signed out on the next visit', async ({
  page,
  authService,
}) => {
  await completeSetupAndSkip(page, uniqueEmail('expiry'))
  await authService.advance(fourteenDays)
  await page.goto('/dash/workspaces')
  await expectSignIn(page)
  await expectPublicPage(page)
})

test('B25 foreground navigation renews the 14-day session deadline', async ({
  page,
  authService,
}) => {
  await completeSetupAndSkip(page, uniqueEmail('renew'))
  const thirteenDays = fourteenDays - 86_400_000
  await authService.advance(thirteenDays)
  await page.goto('/dash/workspaces')
  await expect(heading(page, 'Workspaces')).toBeVisible()
  await authService.advance(thirteenDays)
  await page.goto('/dash/workspaces')
  await expect(heading(page, 'Workspaces')).toBeVisible()
  await authService.advance(fourteenDays)
  await page.goto('/dash/workspaces')
  await expectSignIn(page)
})

test.describe('session check failure', () => {
  test.use({ expectedHttpErrors: [...fixtureHttpErrors, '/api/auth/state'] })

  test('B56 an unavailable session check shows Retry and recovers', async ({ page }) => {
    await page.route('**/api/auth/state', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ kind: 'temporary-failure' }),
      }),
    )
    await page.goto('/dash')
    await expect(
      page.getByText('Could not load your session. Please try again.', { exact: true }),
    ).toBeVisible()
    await expectPublicPage(page)
    await page.unroute('**/api/auth/state')
    await page.getByRole('button', { name: 'Retry', exact: true }).click()
    await expectSetup(page)
  })
})

test.describe('sign-out failure', () => {
  test.use({ expectedHttpErrors: [...fixtureHttpErrors, '/api/auth/sign-out'] })

  test('B58 a failed sign-out keeps the session and a retry signs out', async ({ page }) => {
    const email = uniqueEmail('sign-out-failure')
    await completeSetupAndSkip(page, email)
    await page.route('**/api/auth/sign-out', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ kind: 'temporary-failure' }),
      }),
    )
    await page.getByRole('button', { name: 'Open account menu', exact: true }).click()
    await page.getByRole('menu').getByRole('menuitem', { name: 'Log out', exact: true }).click()
    await expect(page.getByText('Could not sign out. Try again.', { exact: true })).toBeVisible()
    await expect(page).toHaveURL(/\/dash\/workspaces$/)
    await page.unroute('**/api/auth/sign-out')
    await page.reload()
    await expect(heading(page, 'Workspaces')).toBeVisible()
    await signOut(page, 'Alex', email)
  })
})
