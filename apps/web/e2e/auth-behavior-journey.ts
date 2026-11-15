import { randomUUID } from 'node:crypto'
import type { Browser, Locator, Page, Route } from '@playwright/test'
import { expect } from './auth-service'
import {
  capturedLink,
  expectInbox,
  expectSetup,
  expectSignIn,
  signInConfirmation,
  submitSetup,
} from './auth-journey'

export const setupSubject = 'Create your Aircastle account'
export const signInSubject = 'Sign in to Aircastle'
export const setupComplete = 'Setup is complete. Sign in to continue'
export const requestFailed = 'Could not create your sign-in email. Try again.'
export const disabled =
  'Local authentication is not enabled. For local development, set AIRCASTLE_ENV=development.'
export const throttled = /^Too many requests\. Try again in (\d+) seconds?\.$/
export const fixtureHttpErrors = [
  '/api/auth/confirm/preview',
  '/api/auth/confirm',
  '/api/auth/setup',
  '/api/auth/sign-in',
  '/api/auth/session',
  '/api/auth/activity',
  '/api/development-inbox/messages',
]
export const fourteenDays = 1_209_600_000

export function uniqueEmail(label: string) {
  return `${label}-${randomUUID()}@example.test`
}

export function origin(page: Page) {
  return new URL(page.url()).origin
}

export function heading(page: Page, name: string) {
  return page.getByRole('heading', { name, exact: true })
}

export async function requestSetupLink(page: Page, email: string, name = 'Alex') {
  await page.goto('/setup')
  await expectSetup(page)
  await submitSetup(page, name, email)
  await expect(page.getByText('Check your development inbox', { exact: true })).toBeVisible()
  await page.goto('/development-inbox')
  await expectInbox(page)
  return capturedLink(page, email, setupSubject)
}

export async function requestSignInLink(page: Page, email: string) {
  await page.goto('/sign-in')
  await expectSignIn(page)
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('button', { name: 'Send sign-in link', exact: true }).click()
  await expect(page.getByText(signInConfirmation, { exact: true })).toBeVisible()
  await page.goto('/development-inbox')
  await expectInbox(page)
  return capturedLink(page, email, signInSubject)
}

export async function confirmLink(page: Page, link: string, email: string) {
  await page.goto(link)
  await expect(page.getByText(`Continue as ${email}`, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
}

export async function completeSetup(page: Page, email: string, name = 'Alex') {
  await confirmLink(page, await requestSetupLink(page, email, name), email)
  await expect(page).toHaveURL(/\/dash\/workspaces\/new$/)
  await expect(heading(page, 'Create a workspace')).toBeVisible()
}

export async function completeSetupAndSkip(page: Page, email: string, name = 'Alex') {
  await completeSetup(page, email, name)
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
  await expect(page).toHaveURL(/\/dash\/workspaces$/)
  await expect(heading(page, 'Workspaces')).toBeVisible()
}

export async function signInWithLink(page: Page, email: string) {
  await confirmLink(page, await requestSignInLink(page, email), email)
}

export async function rawRequest(page: Page, path: string, data: object) {
  return page.request.post(path, { data, headers: { origin: origin(page) } })
}

export function hold(page: Page, pattern: string) {
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const routes: Route[] = []
  const installed = page.route(pattern, async (route) => {
    routes.push(route)
    await released
    await route.continue()
  })
  return { installed, release, count: () => routes.length }
}

export async function newSignedOutPage(browser: Browser, page: Page) {
  const context = await browser.newContext({ baseURL: origin(page) })
  return { context, page: await context.newPage() }
}

export async function tabTo(page: Page, target: Locator) {
  for (let presses = 0; presses < 40; presses++) {
    await page.keyboard.press('Tab')
    if (await target.evaluate((element) => element === document.activeElement)) return
  }
  throw new Error('Keyboard focus never reached the target control')
}

export async function arrowTo(page: Page, target: Locator) {
  for (let presses = 0; presses < 10; presses++) {
    if (await target.evaluate((element) => element === document.activeElement)) return
    await page.keyboard.press('ArrowDown')
  }
  throw new Error('Keyboard focus never reached the menu item')
}

export async function countdownSeconds(page: Page) {
  const text = await page.getByText(throttled).textContent()
  return Number(throttled.exec(text ?? '')?.[1])
}
