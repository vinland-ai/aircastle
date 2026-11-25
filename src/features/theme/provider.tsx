'use client'

import { useEffect, useSyncExternalStore } from 'react'

import { themeFavicons, themeStorageKey } from '@/theme'
import { ThemeContext, type Theme } from './context'

const listeners = new Set<() => void>()
let unsavedTheme: Theme = 'dark'

function readTheme(): Theme {
  try {
    return localStorage.getItem(themeStorageKey) === 'light' ? 'light' : 'dark'
  } catch (error) {
    if (!(error instanceof DOMException)) throw error
    return unsavedTheme
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.classList.add(theme)
  document.documentElement.style.colorScheme = theme
  document.querySelector('link[rel="icon"]')?.setAttribute('href', themeFavicons[theme])
}

function subscribe(listener: () => void) {
  const sync = (event: StorageEvent) => {
    if (event.key !== themeStorageKey && event.key !== null) return
    applyTheme(readTheme())
    listener()
  }
  listeners.add(listener)
  window.addEventListener('storage', sync)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', sync)
  }
}

function setTheme(theme: Theme) {
  unsavedTheme = theme
  try {
    localStorage.setItem(themeStorageKey, theme)
  } catch (error) {
    if (!(error instanceof DOMException)) throw error
  }
  applyTheme(theme)
  listeners.forEach((listener) => listener())
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribe, readTheme, () => 'dark' as const)
  useEffect(() => applyTheme(readTheme()), [])
  return <ThemeContext value={{ theme, setTheme }}>{children}</ThemeContext>
}
