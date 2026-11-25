'use client'

import { useEffect } from 'react'
import { RecoveryPage } from '@/features/error-recovery'
import { applyTheme, readTheme } from '@/features/theme'
import { themeScript } from '@/theme'
import './globals.css'

export default function GlobalError() {
  useEffect(() => applyTheme(readTheme()), [])
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <RecoveryPage />
      </body>
    </html>
  )
}
