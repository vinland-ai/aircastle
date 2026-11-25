export const themeStorageKey = 'aircastle-theme'

/** The favicon for each theme, so the app and error recovery swap to the same files. */
export const themeFavicons = {
  light: '/brand/favicon-light.svg',
  dark: '/brand/favicon-dark.svg',
} as const

/** Runs before first paint to apply the saved theme, dark by default. */
export const themeScript = `(() => {
  let theme = 'dark'
  try {
    const stored = localStorage.getItem('${themeStorageKey}')
    if (stored === 'light') theme = 'light'
    else if (stored !== 'dark') localStorage.setItem('${themeStorageKey}', 'dark')
  } catch {}
  document.documentElement.classList.add(theme)
  document.documentElement.style.colorScheme = theme
})()`
