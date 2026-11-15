import { test, expect } from './auth-service'
import {
  expectPublicPage,
  expectSetup,
  expectSignIn,
  invalidLink,
  signOut,
  supersededLink,
} from './auth-journey'
import {
  uniqueEmail,
  heading,
  requestSetupLink,
  requestSignInLink,
  confirmLink,
  completeSetupAndSkip,
  rawRequest,
  hold,
} from './auth-behavior-journey'

test('B37 a superseded link that has expired shows the generic error and offers sign-in', async ({
  page,
  authService,
}) => {
  const email = uniqueEmail('superseded-expired')
  await completeSetupAndSkip(page, email)
  await signOut(page, 'Alex', email)
  const old = await requestSignInLink(page, email)
  const newest = await requestSignInLink(page, email)
  expect(newest).not.toBe(old)
  await authService.advance(300_000)
  await page.goto(old)
  await expect(page.getByText(invalidLink, { exact: true })).toBeVisible()
  await expect(page.getByText(supersededLink, { exact: true })).toHaveCount(0)
  await expect(page).toHaveURL(/\/sign-in$/)
  await expectPublicPage(page)
  await page.getByRole('link', { name: 'Sign in', exact: true }).click()
  await expectSignIn(page)
  await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible()
})

test('B38 a setup link opened as a sign-in link is invalid and stays usable for setup', async ({
  page,
}) => {
  const email = uniqueEmail('purpose')
  const link = await requestSetupLink(page, email)
  const swapped = new URL(link)
  swapped.pathname = '/sign-in'
  await page.goto(swapped.href)
  await expect(page.getByText(invalidLink, { exact: true })).toBeVisible()
  await expect(page.getByText(`Continue as ${email}`, { exact: true })).toHaveCount(0)
  await expect(page).toHaveURL(/\/sign-in$/)
  await page.getByRole('link', { name: 'Return to setup', exact: true }).click()
  await expectSetup(page)
  await confirmLink(page, link, email)
  await expect(heading(page, 'Create a workspace')).toBeVisible()
})

test('B39 a link replaced while its confirmation page is open cannot sign in', async ({ page }) => {
  const email = uniqueEmail('replaced-open')
  const link = await requestSetupLink(page, email)
  await page.goto(link)
  await expect(page.getByText(`Continue as ${email}`, { exact: true })).toBeVisible()
  const replacement = await rawRequest(page, '/api/auth/setup', { name: 'Alex', email })
  expect(replacement.status()).toBe(200)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByText(supersededLink, { exact: true })).toBeVisible()
  await expectPublicPage(page)
  await page.goto('/dash')
  await expectSetup(page)
})

test('B40 a link that expires while its confirmation page is open cannot sign in', async ({
  page,
  authService,
}) => {
  const email = uniqueEmail('expired-open')
  const link = await requestSetupLink(page, email)
  await page.goto(link)
  await expect(page.getByText(`Continue as ${email}`, { exact: true })).toBeVisible()
  await authService.advance(300_000)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByText(invalidLink, { exact: true })).toBeVisible()
  await expectPublicPage(page)
  await page.goto('/dash')
  await expectSetup(page)
})

test('B53 a double-clicked Continue confirms once and enters the dashboard', async ({ page }) => {
  const email = uniqueEmail('double-continue')
  const link = await requestSetupLink(page, email)
  await page.goto(link)
  await expect(page.getByText(`Continue as ${email}`, { exact: true })).toBeVisible()
  const held = hold(page, '**/api/auth/confirm')
  await held.installed
  const proceed = page.getByRole('button', { name: 'Continue', exact: true })
  await proceed.dblclick()
  await expect(proceed).toBeDisabled()
  expect(held.count()).toBe(1)
  held.release()
  await expect(page).toHaveURL(/\/dash\/workspaces\/new$/)
  await expect(heading(page, 'Create a workspace')).toBeVisible()
  expect(held.count()).toBe(1)
  await expect(page.getByText(invalidLink, { exact: true })).toHaveCount(0)
})
