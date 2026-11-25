import type { Metadata } from 'next'
import { ThemeProvider } from '@/features/theme'
import { landingDescription, landingTitle } from '@/metadata'
import { themeScript } from '@/theme'
import './globals.css'

export const metadata: Metadata = {
  title: landingTitle,
  description: landingDescription,
  icons: { icon: { url: '/brand/favicon.svg', type: 'image/svg+xml' } },
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
