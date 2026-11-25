'use client'

import { RecoveryPage } from '@/features/error-recovery'
import { themeScript } from '@/theme'
import './globals.css'

export default function GlobalError() {
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
