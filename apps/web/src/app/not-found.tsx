import type { Metadata } from 'next'
import { NotFoundPage } from '@/features/not-found'

export const metadata: Metadata = {
  title: 'Aircastle - Page not found',
  robots: { index: false },
}

export default NotFoundPage
