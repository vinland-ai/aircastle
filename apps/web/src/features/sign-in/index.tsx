import { AuthForm, ConfirmationPage, useAuth } from '@/features/auth'
import { SignInHeading, SignInLayout } from './layout'

export { EarlyAccessSignInPage } from './early-access'

export function SignInPage({ purpose = 'sign-in' }: { purpose?: 'setup' | 'sign-in' }) {
  const { view } = useAuth()
  return (
    <SignInLayout>
      {view.kind === 'confirming' ? (
        <ConfirmationPage key={view.confirmation.token} confirmation={view.confirmation} />
      ) : (
        <>
          <SignInHeading>
            {purpose === 'setup' ? 'Create your super user account' : 'Sign in'}
          </SignInHeading>
          <AuthForm purpose={purpose} />
        </>
      )}
    </SignInLayout>
  )
}
