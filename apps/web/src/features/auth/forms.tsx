import { useEffect, useRef, useState, type FormEvent } from 'react'
import { authSetupInput, authSignInInput } from '@aircastle/contracts'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { AtSignIcon } from 'lucide-react'
import { useAuth } from './context'
import type { AccountRequest, HttpResult } from './http'

type Purpose = 'setup' | 'sign-in'
type FieldErrors = { name?: string; email?: string }

type Outcome =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'throttled'; retryAt: number; at: number }
  | { kind: 'failed'; message: string }

const idle: Outcome = { kind: 'idle' }

function readForm(
  purpose: Purpose,
  values: FormData,
): { kind: 'valid'; input: AccountRequest } | { kind: 'invalid'; fields: FieldErrors } {
  const input =
    purpose === 'setup'
      ? authSetupInput({ name: values.get('name'), email: values.get('email') })
      : authSignInInput({ email: values.get('email') })
  if (!('summary' in input)) return { kind: 'valid', input }
  const fields: FieldErrors = {}
  for (const error of input) {
    if (error.path[0] === 'name') fields.name = 'Enter a name with 1 through 120 characters.'
    if (error.path[0] === 'email') fields.email = 'Enter a valid email address.'
  }
  return { kind: 'invalid', fields }
}

function outcomeFrom(
  result: HttpResult<unknown>,
  at: number,
): { outcome: Outcome; fields: FieldErrors } {
  if (result.kind === 'ok') return { outcome: { kind: 'sent' }, fields: {} }
  if (result.kind === 'email-not-allowed')
    return { outcome: idle, fields: { email: 'This email is not allowed for initial setup' } }
  if (result.kind === 'throttled')
    return { outcome: { kind: 'throttled', retryAt: result.retryAt, at }, fields: {} }
  const message =
    result.kind === 'setup-complete'
      ? 'Setup is complete. Sign in to continue'
      : 'Could not create your sign-in email. Try again.'
  return { outcome: { kind: 'failed', message }, fields: {} }
}

function useSecondsLeft(outcome: Outcome) {
  const throttle = outcome.kind === 'throttled' ? outcome : undefined
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!throttle) return
    const timer = window.setInterval(() => {
      const current = Date.now()
      setNow(current)
      if (current >= throttle.retryAt) window.clearInterval(timer)
    }, 100)
    return () => window.clearInterval(timer)
  }, [throttle])
  return throttle
    ? Math.max(0, Math.ceil((throttle.retryAt - Math.max(now, throttle.at)) / 1000))
    : 0
}

export function AuthForm({ purpose }: { purpose: Purpose }) {
  const { auth } = useAuth()
  const [errors, setErrors] = useState<FieldErrors>({})
  const [outcome, setOutcome] = useState<Outcome>(idle)
  const submitting = useRef(false)
  const seconds = useSecondsLeft(outcome)
  const pending = outcome.kind === 'sending'
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || (outcome.kind === 'throttled' && Date.now() < outcome.retryAt)) return
    const form = readForm(purpose, new FormData(event.currentTarget))
    if (form.kind === 'invalid') {
      setErrors(form.fields)
      return
    }
    submitting.current = true
    setErrors({})
    setOutcome({ kind: 'sending' })
    const result = await auth.api.requestLink(purpose, {
      ...form.input,
      ...(auth.returnTo ? { returnTo: auth.returnTo } : {}),
    })
    submitting.current = false
    const next = outcomeFrom(result, Date.now())
    setErrors(next.fields)
    setOutcome(next.outcome)
  }
  return (
    <>
      <form noValidate onSubmit={submit}>
        <AccountFields purpose={purpose} errors={errors} pending={pending} seconds={seconds} />
      </form>
      {outcome.kind === 'failed' && <p role="alert">{outcome.message}</p>}
      {seconds > 0 && (
        <p role="alert">
          Too many requests. Try again in {seconds} {seconds === 1 ? 'second' : 'seconds'}.
        </p>
      )}
      {outcome.kind === 'sent' && (
        <div role="status" className="space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
          <p>
            {purpose === 'setup'
              ? 'Check your development inbox'
              : 'If this account exists, a sign-in link is available in the development inbox.'}
          </p>
          <a className="underline underline-offset-4" href="/development-inbox">
            Open development inbox
          </a>
        </div>
      )}
    </>
  )
}

function AccountFields({
  purpose,
  errors,
  pending,
  seconds,
}: {
  purpose: Purpose
  errors: FieldErrors
  pending: boolean
  seconds: number
}) {
  return (
    <FieldGroup className="gap-3">
      {purpose === 'setup' && (
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="name">Name</FieldLabel>
          <InputGroup className="h-12 text-base">
            <InputGroupInput
              id="name"
              name="name"
              className="text-base md:text-base"
              autoComplete="name"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? 'name-error' : undefined}
            />
          </InputGroup>
          {errors.name && <FieldError id="name-error">{errors.name}</FieldError>}
        </Field>
      )}
      <Field data-invalid={!!errors.email}>
        <FieldLabel className={purpose === 'sign-in' ? 'sr-only' : undefined} htmlFor="email">
          Email
        </FieldLabel>
        <InputGroup className="h-12 text-base">
          <InputGroupInput
            id="email"
            name="email"
            autoFocus={purpose === 'sign-in'}
            placeholder="your.email@example.com"
            type="email"
            autoComplete="email"
            className="text-base md:text-base"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'email-error' : undefined}
          />
          <InputGroupAddon align="inline-start">
            <AtSignIcon aria-hidden="true" />
          </InputGroupAddon>
        </InputGroup>
        {errors.email && <FieldError id="email-error">{errors.email}</FieldError>}
      </Field>
      <Button className="h-12 w-full text-base" type="submit" disabled={pending || seconds > 0}>
        {pending ? 'Sending…' : purpose === 'setup' ? 'Continue' : 'Send sign-in link'}
      </Button>
    </FieldGroup>
  )
}
