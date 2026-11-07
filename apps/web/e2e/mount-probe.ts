import type { Page } from '@playwright/test'

type Probe = 'initial-shell' | 'signed-out-shell' | 'protected-pages'

export async function installMountProbe(page: Page, probe: Probe) {
  await page.addInitScript((probe) => {
    if (probe === 'protected-pages') {
      const seen = { projects: false, shell: false }
      Object.assign(window, { protectedMounts: seen })
      new MutationObserver(() => {
        for (const title of document.querySelectorAll('h1'))
          if (title.textContent === 'Projects') seen.projects = true
        if (document.querySelector('[aria-label="Main navigation"]')) seen.shell = true
      }).observe(document, { childList: true, subtree: true, characterData: true })
      return
    }
    const flashes: string[] = []
    Object.assign(window, { authShellFlashes: flashes })
    const selector =
      probe === 'initial-shell'
        ? '[data-theme-scope="dashboard"], [aria-label="Open account menu"], [aria-label="Main navigation"]'
        : '[data-theme-scope="dashboard"], [aria-label="Open account menu"]'
    new MutationObserver(() => {
      if (document.querySelector(selector)) flashes.push(location.pathname)
    }).observe(document, { childList: true, subtree: true, attributes: true })
  }, probe)
}

export async function readMountProbe(page: Page, probe: Probe) {
  return page.evaluate(
    (probe) =>
      Reflect.get(window, probe === 'protected-pages' ? 'protectedMounts' : 'authShellFlashes'),
    probe,
  )
}
