import type { Metadata } from 'next'
import { SignInPage } from '@/features/sign-in'

export const metadata: Metadata = {
  title: 'Aircastle - Sign in',
}

export default function SignInRoute() {
  return <SignInPage />
}
