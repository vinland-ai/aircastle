import { test, expect } from './auth-service'
import {
  capturedLink,
  expectInbox,
  expectPublicPage,
  expectSetup,
  expectSignIn,
  message,
  signInConfirmation,
  signOut,
  submitSetup,
} from './auth-journey'
import {
  setupSubject,
  signInSubject,
  requestFailed,
  disabled,
  throttled,
  uniqueEmail,
  heading,
  requestSetupLink,
  confirmLink,
  completeSetupAndSkip,
  rawRequest,
  countdownSeconds,
} from './auth-behavior-journey'

test('B55 a failed sign-in request reports a retryable failure without claiming delivery', async ({
  page,
}) => {
  const email = uniqueEmail('sign-in-failure')
  await completeSetupAndSkip(page, email)
  await signOut(page, 'Alex', email)
  await page.route('**/api/auth/sign-in', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ kind: 'temporary-failure' }),
    }),
  )
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('button', { name: 'Send sign-in link', exact: true }).click()
  await expect(page.getByText(requestFailed, { exact: true })).toBeVisible()
  await expect(page.getByText(signInConfirmation, { exact: true })).toHaveCount(0)
  await page.unroute('**/api/auth/sign-in')
  await page.getByRole('button', { name: 'Send sign-in link', exact: true }).click()
  await expect(page.getByText(signInConfirmation, { exact: true })).toBeVisible()
  await expect(page.getByText(requestFailed, { exact: true })).toHaveCount(0)
})

test('B57 a failed confirmation explains how to continue without signing in', async ({ page }) => {
  const email = uniqueEmail('confirm-failure')
  const link = await requestSetupLink(page, email)
  await page.goto(link)
  await expect(page.getByText(`Continue as ${email}`, { exact: true })).toBeVisible()
  await page.route('**/api/auth/confirm', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ kind: 'temporary-failure' }),
    }),
  )
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(
    page.getByText('Could not confirm this link. Try again or request a new link.', {
      exact: true,
    }),
  ).toBeVisible()
  await expectPublicPage(page)
  await page.unroute('**/api/auth/confirm')
  await page.getByRole('link', { name: 'Return to setup', exact: true }).click()
  await expectSetup(page)
})

test('B60 a failed inbox message open offers Retry and recovers', async ({ page }) => {
  const email = uniqueEmail('inbox-open')
  await page.goto('/setup')
  await expectSetup(page)
  await submitSetup(page, 'Alex', email)
  await expect(page.getByText('Check your development inbox', { exact: true })).toBeVisible()
  await page.goto('/development-inbox')
  await expectInbox(page)
  await page.route('**/api/development-inbox/messages/*/open', (route) => route.abort())
  await message(page, email, setupSubject).click()
  await expect(
    page.getByText('Could not open this message. Try again.', { exact: true }),
  ).toBeVisible()
  await page.unroute('**/api/development-inbox/messages/*/open')
  await page
    .getByRole('region', { name: 'Reading pane', exact: true })
    .getByRole('button', { name: 'Retry', exact: true })
    .click()
  await expect(
    page
      .getByRole('region', { name: 'Reading pane', exact: true })
      .getByRole('link', { name: 'Continue', exact: true }),
  ).toBeVisible()
})

test('B63 a throttled setup request counts down and leaves the newest link valid', async ({
  page,
}) => {
  const email = uniqueEmail('countdown')
  await page.goto('/setup')
  await expectSetup(page)
  for (let index = 0; index < 5; index++) {
    expect((await rawRequest(page, '/api/auth/setup', { name: 'Alex', email })).status()).toBe(200)
  }
  await submitSetup(page, 'Alex', email)
  await expect(page.getByText(throttled)).toBeVisible()
  await expect(page.locator('form button[type="submit"]')).toBeDisabled()
  const first = await countdownSeconds(page)
  expect(first).toBeGreaterThan(1)
  expect(first).toBeLessThanOrEqual(300)
  await expect.poll(() => countdownSeconds(page), { timeout: 5_000 }).toBeLessThan(first)
  await expect(page.getByText('Check your development inbox', { exact: true })).toHaveCount(0)
  await page.goto('/development-inbox')
  await expectInbox(page)
  await expect(message(page, email, setupSubject)).toHaveCount(5)
  await confirmLink(page, await capturedLink(page, email, setupSubject), email)
  await expect(heading(page, 'Create a workspace')).toBeVisible()
})

test('B64 unknown-email sign-in requests are throttled like known ones without blocking other emails', async ({
  page,
}) => {
  const email = uniqueEmail('known-limit')
  const unknown = uniqueEmail('unknown-limit')
  await completeSetupAndSkip(page, email)
  await signOut(page, 'Alex', email)
  for (let index = 0; index < 5; index++) {
    expect((await rawRequest(page, '/api/auth/sign-in', { email: unknown })).status()).toBe(200)
  }
  await page.getByRole('textbox', { name: 'Email' }).fill(unknown)
  await page.getByRole('button', { name: 'Send sign-in link', exact: true }).click()
  await expect(page.getByText(throttled)).toBeVisible()
  await expect(page.getByText(signInConfirmation, { exact: true })).toHaveCount(0)
  await page.goto('/sign-in')
  await expectSignIn(page)
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('button', { name: 'Send sign-in link', exact: true }).click()
  await expect(page.getByText(signInConfirmation, { exact: true })).toBeVisible()
  await page.goto('/development-inbox')
  await expectInbox(page)
  await expect(message(page, email, signInSubject)).toHaveCount(1)
  await expect(page.getByRole('button').filter({ hasText: unknown })).toHaveCount(0)
})

test('B65 changing the recipient cannot bypass the per-source request limit', async ({ page }) => {
  await page.goto('/setup')
  await expectSetup(page)
  for (let index = 0; index < 10; index++) {
    const response = await rawRequest(page, '/api/auth/setup', {
      name: 'Alex',
      email: uniqueEmail(`source-${index}`),
    })
    expect(response.status()).toBe(200)
  }
  const fresh = uniqueEmail('fresh')
  await submitSetup(page, 'Alex', fresh)
  await expect(page.getByText(throttled)).toBeVisible()
  await page.goto('/development-inbox')
  await expectInbox(page)
  await expect(page.getByRole('button').filter({ hasText: setupSubject })).toHaveCount(10)
  await expect(page.getByRole('button').filter({ hasText: fresh })).toHaveCount(0)
})

test('B66 throttling is temporary and a request is accepted once the window passes', async ({
  page,
  authService,
}) => {
  const email = uniqueEmail('recover')
  await page.goto('/setup')
  await expectSetup(page)
  for (let index = 0; index < 5; index++) {
    expect((await rawRequest(page, '/api/auth/setup', { name: 'Alex', email })).status()).toBe(200)
  }
  await submitSetup(page, 'Alex', email)
  await expect(page.getByText(throttled)).toBeVisible()
  await authService.advance(300_000)
  await page.reload()
  await expectSetup(page)
  await submitSetup(page, 'Alex', email)
  await expect(page.getByText('Check your development inbox', { exact: true })).toBeVisible()
  await page.goto('/development-inbox')
  await expectInbox(page)
  await expect(message(page, email, setupSubject)).toHaveCount(6)
})

test.describe('disabled mode', () => {
  test.use({ authEnvironment: { AIRCASTLE_ENV: 'production' } })

  test('B67 without local mode every auth page shows the configuration message and the inbox is closed', async ({
    page,
  }) => {
    for (const path of ['/setup', '/sign-in', '/dash', '/dash/workspaces', '/development-inbox']) {
      await page.goto(path)
      await expect(page.getByText(disabled, { exact: true })).toBeVisible()
      await expectPublicPage(page)
      await expect(page.getByRole('textbox')).toHaveCount(0)
    }
    expect((await page.request.get('/api/development-inbox/messages')).status()).toBe(404)
    const setup = await rawRequest(page, '/api/auth/setup', {
      name: 'Alex',
      email: uniqueEmail('disabled'),
    })
    expect(setup.status()).toBe(404)
  })
})
