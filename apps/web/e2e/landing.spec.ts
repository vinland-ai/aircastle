import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect } from './support'
import { origins } from './origins'

const buildDir = fileURLToPath(new URL('../reports/build/landing/', import.meta.url))
const landingUrl = (pathname: string) => new URL(pathname, origins.landing.url).href
const earlyAccessMessage =
  "Aircastle is in private early access. You're not on the access list yet."
const gatedPaths = [
  '/dash',
  '/dash/workspaces/demo/projects/demo/collections',
  '/dash/workspaces/acme/projects/blog/settings?tab=members#danger',
  '/sign-in/magic-link',
  '/blog',
  '/blog/meet-air',
  '/docs',
  '/terms-of-service',
  '/privacy-policy',
  '/api/health',
  '/no-such-page',
]

async function builtFiles() {
  const entries = await readdir(buildDir, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(buildDir, join(entry.parentPath, entry.name)))
}

function recordRequests(page: Page) {
  const requests: { method: string; type: string; url: URL }[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.protocol === 'data:' || url.protocol === 'blob:') return
    requests.push({ method: request.method(), type: request.resourceType(), url })
  })
  return requests
}

async function expectOnlyStaticRequests(requests: ReturnType<typeof recordRequests>) {
  const files = await builtFiles()
  expect(requests.length).toBeGreaterThan(0)
  for (const { method, type, url } of requests) {
    const label = `${method} ${type} ${url.href}`
    expect(url.origin, label).toBe(origins.landing.url)
    expect(method, label).toBe('GET')
    if (type !== 'document') expect(files, label).toContain(decodeURI(url.pathname.slice(1)))
  }
}

async function expectLanding(page: Page) {
  await expect(page).toHaveURL(landingUrl('/'))
  await expect(page.getByRole('navigation', { name: 'Marketing navigation' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Autopilot for everything')
  await expect(page.locator('[data-theme-scope="dashboard"]')).toHaveCount(0)
}

async function linkTargets(page: Page) {
  return page
    .locator('a[href]')
    .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href))
}

test.describe('landing-only build', () => {
  test('landing links stay on the landing page, sign-in, or the Vinland site', async ({ page }) => {
    const requests = recordRequests(page)
    await page.goto(landingUrl('/'))
    await expectLanding(page)
    await expect(page.getByRole('link', { name: 'Documentation' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Open Aircastle' })).toHaveAttribute(
      'href',
      '/sign-in',
    )
    for (const href of await linkTargets(page)) {
      const url = new URL(href)
      if (url.origin === origins.landing.url) {
        expect(['/', '/sign-in'], href).toContain(url.pathname)
      } else {
        expect(url.href, href).toBe('https://vinland.com.au/')
      }
    }

    await page.goto(landingUrl('/sign-in'))
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
    await expect(page.getByText('Terms of Service')).toHaveCount(0)
    await expect(page.getByText('Privacy Policy')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Learn more' })).toHaveCount(0)
    for (const href of await linkTargets(page)) expect(href).toBe(landingUrl('/'))
    await expectOnlyStaticRequests(requests)
  })

  for (const path of gatedPaths) {
    test(`a direct visit to ${path} lands on the landing page`, async ({ page }) => {
      const requests = recordRequests(page)
      await page.goto(landingUrl(path))
      await expectLanding(page)
      await expectOnlyStaticRequests(requests)
    })
  }

  for (const name of ['Get started', 'See Aircastle in action']) {
    test(`${name} opens the early-access sign-in`, async ({ page }) => {
      const requests = recordRequests(page)
      await page.goto(landingUrl('/'))
      await expectLanding(page)
      await page.getByRole('main').getByRole('link', { name }).click()
      await expect(page).toHaveURL(landingUrl('/sign-in'))
      await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
      await expectOnlyStaticRequests(requests)
    })
  }

  for (const [width, lines] of [
    [1440, 1],
    [1024, 1],
    [640, 1],
    [390, 2],
  ] as const) {
    test(`at ${width}px the early-access message takes ${lines} line${lines > 1 ? 's' : ''} and stays on screen`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.goto(landingUrl('/sign-in'))
      await page.getByRole('textbox', { name: 'Email' }).fill('reader@example.com')
      await page.getByRole('button', { name: 'Send sign-in link' }).click()
      const status = page.getByRole('status')
      await expect(status).toHaveText(earlyAccessMessage)
      const { height, lineHeight, right } = await status.evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        lineHeight: parseFloat(getComputedStyle(element).lineHeight),
        right: element.querySelector('span')!.getBoundingClientRect().right,
      }))
      expect(Math.round(height / lineHeight)).toBe(lines)
      expect(right).toBeLessThanOrEqual(width)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      )
    })
  }

  test('signing in shows the early-access message without a network request', async ({ page }) => {
    await page.goto(landingUrl('/sign-in'))
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
    const requests = recordRequests(page)
    const email = page.getByRole('textbox', { name: 'Email' })
    const submit = page.getByRole('button', { name: 'Send sign-in link' })

    await submit.click()
    await expect(email).toBeFocused()
    await expect(page.getByText(earlyAccessMessage)).toHaveCount(0)

    await email.fill('reader@example.com')
    await submit.click()
    await expect(page.getByRole('status')).toHaveText(earlyAccessMessage)
    await email.fill('reader@example.org')
    await expect(page.getByRole('status')).toHaveText('')
    await email.press('Enter')
    await expect(page.getByRole('status')).toHaveText(earlyAccessMessage)
    await expect(page).toHaveURL(landingUrl('/sign-in'))
    expect(requests.map(({ method, url }) => `${method} ${url.href}`)).toEqual([])
  })

  test('the landing bundle names no API or local endpoint and leaves out the dashboard shell', async () => {
    const files = await builtFiles()
    const text = files.filter((file) => /\.(html|js|css)$/.test(file))
    expect(text.length).toBeGreaterThan(1)
    for (const file of text) {
      const source = await readFile(join(buildDir, file), 'utf8')
      for (const forbidden of [
        '/api',
        'localhost:',
        '127.0.0.1',
        'Toggle Sidebar',
        'Open account menu',
      ]) {
        expect(source.includes(forbidden), `${file} must not contain ${forbidden}`).toBe(false)
      }
    }
  })

  test('every asset the landing bundle names is a built file', async () => {
    const files = await builtFiles()
    const named = new Set<string>()
    for (const file of files.filter((name) => /\.(html|js|css)$/.test(name))) {
      const source = await readFile(join(buildDir, file), 'utf8')
      for (const [path] of source.matchAll(/\/(?:assets|brand|demo)\/[\w./-]+\.\w+/g)) {
        named.add(path.slice(1))
      }
    }
    expect(named.size).toBeGreaterThan(10)
    expect([...named].filter((path) => !files.includes(path))).toEqual([])
  })
})
