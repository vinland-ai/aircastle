import { useEffect, useState } from 'react'

import { themeFavicons, themeStorageKey } from '@/theme'
import { ThemeContext, type Theme } from './context'
function readTheme(value: string | null): Theme {
  return value === 'light' ? 'light' : 'dark'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      return readTheme(localStorage.getItem(themeStorageKey))
    } catch (error) {
      if (!(error instanceof DOMException)) throw error
      return 'dark'
    }
  })
  useEffect(() => {
    document.documentElement.classList.remove('light', 'dark')
    document.documentElement.classList.add(theme)
    document.documentElement.style.colorScheme = theme
    document.querySelector('link[rel="icon"]')?.setAttribute('href', themeFavicons[theme])
  }, [theme])
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === themeStorageKey || event.key === null)
        setThemeState(readTheme(event.newValue))
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  function setTheme(choice: Theme) {
    setThemeState(choice)
    try {
      localStorage.setItem(themeStorageKey, choice)
    } catch (error) {
      if (!(error instanceof DOMException)) throw error
    }
  }
  return <ThemeContext value={{ theme, setTheme }}>{children}</ThemeContext>
}
