import { test, expect } from './auth-service'

test('[shell:R2] real built entry positive control', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Marketing navigation' })).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
})
