'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AtSignIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { CloudArt } from './cloud-art'

/** The early-access sign-in page. It answers every submitted email with an early-access notice and sends nothing. */
export function SignInPage() {
  const [refusals, setRefusals] = useState(0)
  return (
    <main
      data-theme-scope="marketing"
      className="relative min-h-svh overflow-hidden lg:grid lg:grid-cols-2"
    >
      <div className="relative hidden lg:block">
        <CloudArt />
      </div>
      <div className="relative flex min-h-svh min-w-0 flex-col justify-center bg-background px-6 py-24 sm:px-8">
        <div className="mx-auto flex w-full min-w-0 max-w-[28rem] flex-col gap-5">
          <Link
            href="/"
            aria-label="Aircastle home"
            className="brand-link mb-6 self-start rounded-md focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid"
          >
            <span aria-hidden="true" className="brand-logo block size-10 shrink-0" />
          </Link>
          <h1 className="mb-3 text-[2rem] leading-tight font-[400] tracking-tight">Sign in</h1>
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
                Aircastle is in private early access. You&apos;re not on the access list yet.
              </span>
            )}
          </p>
        </div>
      </div>
    </main>
  )
}
