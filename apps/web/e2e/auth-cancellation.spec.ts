import { test, expect } from './auth-service'
import { expectPublicPage, expectSetup } from './auth-journey'
import { requestSetupLink, uniqueEmail } from './auth-behavior-journey'

test('D1 a superseded token preview leaves no stale confirmation on the next setup visit', async ({
  page,
}, info) => {
  const link = await requestSetupLink(page, uniqueEmail('cancelled-preview'))
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Marketing navigation' })).toBeVisible()
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let requested = false
  let finished!: () => void
  const released = new Promise<void>((resolve) => {
    finished = resolve
  })
  await page.route('**/api/auth/confirm/preview', async (route) => {
    requested = true
    await held
    try {
      await route.continue()
    } finally {
      finished()
    }
  })
  async function navigate(path: string) {
    await page.evaluate((path) => {
      window.history.pushState(null, '', path)
      window.dispatchEvent(new PopStateEvent('popstate'))
    }, path)
  }
  try {
    await navigate(link)
    await expect.poll(() => requested).toBe(true)
    await expectPublicPage(page)
    if (info.project.use.video && info.project.use.video !== 'off')
      await page.screenshot({ path: info.outputPath('preview-held.png') })
    await navigate('/')
    await expect(page.getByRole('navigation', { name: 'Marketing navigation' })).toBeVisible()
    release()
    await released
    if (info.project.use.video && info.project.use.video !== 'off')
      await page.screenshot({ path: info.outputPath('superseding-home.png') })
    await navigate('/setup')
    await expectSetup(page)
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByText(/Continue as /)).toHaveCount(0)
    if (info.project.use.video && info.project.use.video !== 'off')
      await page.screenshot({ path: info.outputPath('clean-setup.png') })
  } finally {
    release()
  }
})
