import { useState } from 'react'
import { AtSignIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { SignInHeading, SignInLayout } from './layout'

/** The landing build's sign-in, which answers every submitted email with an early-access notice and sends nothing. */
export function EarlyAccessSignInPage() {
  const [refusals, setRefusals] = useState(0)
  return (
    <SignInLayout earlyAccess>
      <SignInHeading>Sign in</SignInHeading>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          setRefusals((count) => count + 1)
        }}
      >
        <FieldGroup className="gap-3">
          <Field>
            <FieldLabel className="sr-only" htmlFor="email">
              Email
            </FieldLabel>
            <InputGroup className="h-12 text-base">
              <InputGroupInput
                id="email"
                name="email"
                placeholder="your.email@example.com"
                type="email"
                autoComplete="email"
                required
                onChange={() => setRefusals(0)}
                className="text-base md:text-base"
              />
              <InputGroupAddon align="inline-start">
                <AtSignIcon aria-hidden="true" />
              </InputGroupAddon>
            </InputGroup>
          </Field>
          <Button className="h-12 w-full text-base" type="submit">
            Send sign-in link
          </Button>
        </FieldGroup>
      </form>
      <p role="status" className="text-base text-foreground sm:whitespace-nowrap">
        {refusals > 0 && (
          <span key={refusals}>
            Aircastle is in private early access. You're not on the access list yet.
          </span>
        )}
      </p>
    </SignInLayout>
  )
}
