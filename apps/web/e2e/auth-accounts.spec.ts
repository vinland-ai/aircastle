import { test, expect } from './auth-service'
import {
  capturedLink,
  expectFieldError,
  expectInbox,
  expectSetup,
  expectSignIn,
  invalidLink,
  message,
  signInConfirmation,
  signOut,
  submitSetup,
} from './auth-journey'
import {
  setupSubject,
  signInSubject,
  setupComplete,
  uniqueEmail,
  origin,
  heading,
  requestSetupLink,
  requestSignInLink,
  completeSetup,
  completeSetupAndSkip,
  rawRequest,
  hold,
  newSignedOutPage,
  tabTo,
  arrowTo,
} from './auth-behavior-journey'

test('B10 concurrent confirmation of two setup links creates exactly one account', async ({
  page,
  browser,
}) => {
  const emails = [uniqueEmail('first'), uniqueEmail('second')]
  const links = [await requestSetupLink(page, emails[0]!), await requestSetupLink(page, emails[1]!)]
  const browsers = [await newSignedOutPage(browser, page), await newSignedOutPage(browser, page)]
  try {
    for (const [index, { page: claimant }] of browsers.entries()) {
      await claimant.goto(links[index]!)
      await expect(
        claimant.getByText(`Continue as ${emails[index]}`, { exact: true }),
      ).toBeVisible()
    }
    await Promise.all(
      browsers.map(({ page: claimant }) =>
        claimant.getByRole('button', { name: 'Continue', exact: true }).click(),
      ),
    )
    const outcomes: string[] = []
    for (const { page: claimant } of browsers) {
      const won = heading(claimant, 'Create a workspace')
      const lost = claimant.getByText(setupComplete, { exact: true })
      await expect(won.or(lost)).toBeVisible()
      outcomes.push((await won.isVisible()) ? 'won' : 'lost')
    }
    expect(outcomes.toSorted()).toEqual(['lost', 'won'])
    const loser = browsers[outcomes.indexOf('lost')]!.page
    await loser.goto('/dash')
    await expectSignIn(loser)
    const winnerEmail = emails[outcomes.indexOf('won')]!
    const loserEmail = emails[outcomes.indexOf('lost')]!
    await requestSignInLink(page, winnerEmail)
    await page.goto('/sign-in')
    await expectSignIn(page)
    await page.getByRole('textbox', { name: 'Email' }).fill(loserEmail)
    await page.getByRole('button', { name: 'Send sign-in link', exact: true }).click()
    await expect(page.getByText(signInConfirmation, { exact: true })).toBeVisible()
    await page.goto('/development-inbox')
    await expectInbox(page)
    await expect(message(page, winnerEmail, signInSubject)).toHaveCount(1)
    await expect(message(page, loserEmail, signInSubject)).toHaveCount(0)
  } finally {
    for (const { context } of browsers) await context.close()
  }
})

test('B11 the same link confirmed concurrently in two browsers creates one session', async ({
  page,
  browser,
}) => {
  const email = uniqueEmail('same-link')
  const link = await requestSetupLink(page, email)
  const browsers = [await newSignedOutPage(browser, page), await newSignedOutPage(browser, page)]
  try {
    for (const { page: claimant } of browsers) {
      await claimant.goto(link)
      await expect(claimant.getByText(`Continue as ${email}`, { exact: true })).toBeVisible()
    }
    await Promise.all(
      browsers.map(({ page: claimant }) =>
        claimant.getByRole('button', { name: 'Continue', exact: true }).click(),
      ),
    )
    const outcomes: string[] = []
    for (const { page: claimant } of browsers) {
      const won = heading(claimant, 'Create a workspace')
      const lost = claimant.getByText(invalidLink, { exact: true })
      await expect(won.or(lost)).toBeVisible()
      outcomes.push((await won.isVisible()) ? 'won' : 'lost')
    }
    expect(outcomes.toSorted()).toEqual(['lost', 'won'])
    const loser = browsers[outcomes.indexOf('lost')]!.page
    await loser.goto('/dash')
    await expectSignIn(loser)
  } finally {
    for (const { context } of browsers) await context.close()
  }
})

test('B12 a stale setup tab submitted after setup completed reports completed setup', async ({
  page,
  browser,
}) => {
  await page.goto('/setup')
  await expectSetup(page)
  const winner = uniqueEmail('winner')
  const other = await newSignedOutPage(browser, page)
  try {
    await completeSetup(other.page, winner)
  } finally {
    await other.context.close()
  }
  const late = uniqueEmail('late')
  await submitSetup(page, 'Alex', late)
  await expect(page.getByText(setupComplete, { exact: true })).toBeVisible()
  await expect(page.getByText('Check your development inbox', { exact: true })).toHaveCount(0)
  await page.goto('/development-inbox')
  await expectInbox(page)
  await expect(page.getByRole('button').filter({ hasText: late })).toHaveCount(0)
  await expect(message(page, winner, setupSubject)).toHaveCount(1)
})

test('B14 signed-in visits to setup and sign-in redirect to the dashboard while the inbox stays open', async ({
  page,
}) => {
  const email = uniqueEmail('signed-in')
  await completeSetupAndSkip(page, email)
  for (const path of ['/setup', '/sign-in']) {
    await page.goto(path)
    await expect(page).toHaveURL(`${origin(page)}/dash/workspaces`)
    await expect(heading(page, 'Workspaces')).toBeVisible()
  }
  await page.goto('/development-inbox')
  await expectInbox(page)
  await expect(message(page, email, setupSubject)).toHaveCount(1)
  await page.goto('/dash/workspaces')
  await expect(heading(page, 'Workspaces')).toBeVisible()
})

test('B16 unknown and known email sign-in get the same response and only the known email gets a message', async ({
  page,
}) => {
  const email = uniqueEmail('known')
  const unknown = uniqueEmail('unknown')
  await completeSetupAndSkip(page, email)
  await signOut(page, 'Alex', email)
  const responses: { status: number; body: string; headers: Record<string, string> }[] = []
  for (const address of [unknown, email]) {
    await page.goto('/sign-in')
    await expectSignIn(page)
    const response = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === 'POST' &&
        new URL(candidate.url()).pathname === '/api/auth/sign-in',
    )
    await page.getByRole('textbox', { name: 'Email' }).fill(address)
    await page.getByRole('button', { name: 'Send sign-in link', exact: true }).click()
    const received = await response
    const headers = Object.fromEntries(
      Object.entries(await received.allHeaders()).filter(([name]) => name !== 'date'),
    )
    responses.push({ status: received.status(), body: await received.text(), headers })
    await expect(page.getByText(signInConfirmation, { exact: true })).toBeVisible()
  }
  expect(responses[0]).toEqual(responses[1])
  expect(responses[0]!.status).toBe(200)
  expect(responses[0]!.body).not.toMatch(/token/i)
  await page.goto('/development-inbox')
  await expectInbox(page)
  await expect(page.getByRole('button').filter({ hasText: unknown })).toHaveCount(0)
  await expect(message(page, email, signInSubject)).toHaveCount(1)
})

test('B42 empty and privileged setup input is rejected in the browser and by the server', async ({
  page,
}) => {
  await page.goto('/setup')
  await expectSetup(page)
  let sent = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/auth/setup') sent++
  })
  await page.locator('form button[type="submit"]').click()
  await expectFieldError(page.getByRole('textbox', { name: 'Name' }))
  await expectFieldError(page.getByRole('textbox', { name: 'Email' }))
  await submitSetup(page, 'Alex', '   ')
  await expectFieldError(page.getByRole('textbox', { name: 'Email' }))
  expect(sent).toBe(0)
  const email = uniqueEmail('privileged')
  for (const data of [
    { name: '', email: '' },
    { name: '   ', email },
    { name: 'Alex', email: 'not-an-email' },
    { name: 'Alex', email, authority: 'super_user' },
    { name: 'Alex', email, role: 'admin' },
  ]) {
    const response = await rawRequest(page, '/api/auth/setup', data)
    expect(response.status(), JSON.stringify(data)).toBe(400)
    expect((await response.json()).kind).toBe('invalid-input')
  }
  await page.goto('/development-inbox')
  await expectInbox(page)
  await expect(page.getByText('No messages yet', { exact: true })).toBeVisible()
})

test('B45 a trimmed unicode name of 120 code points keeps its internal spacing', async ({
  page,
}) => {
  const name = `Zoë  山田 ${'😀'.repeat(112)}`
  expect(Array.from(name).length).toBe(120)
  const email = uniqueEmail('unicode')
  await completeSetupAndSkip(page, email, `  ${name}  `)
  const session = await page.request.get('/api/auth/session')
  expect(session.status()).toBe(200)
  expect((await session.json()).value.user).toMatchObject({ name, email })
  await signOut(page, name, email)
})

test('B46 email length limits accept 254 characters and reject longer addresses', async ({
  page,
}) => {
  const local = 'a'.repeat(64)
  const longest = `${local}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(56)}.test`
  expect(longest.length).toBe(254)
  await page.goto('/setup')
  await expectSetup(page)
  const emailField = page.getByRole('textbox', { name: 'Email' })
  for (const tooLong of [
    `${local}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.test`,
    `${'a'.repeat(65)}@example.test`,
  ]) {
    await submitSetup(page, 'Alex', tooLong)
    await expectFieldError(emailField)
    const response = await rawRequest(page, '/api/auth/setup', { name: 'Alex', email: tooLong })
    expect(response.status()).toBe(400)
  }
  await page.goto('/setup')
  await expectSetup(page)
  await submitSetup(page, 'Alex', longest)
  await expect(page.getByText('Check your development inbox', { exact: true })).toBeVisible()
  await page.goto('/development-inbox')
  await expectInbox(page)
  const link = await capturedLink(page, longest, setupSubject)
  await page.goto(link)
  await expect(page.getByText(`Continue as ${longest}`, { exact: true })).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true)
})

test('B50 an invalid sign-in email shows a field error without sending a request', async ({
  page,
}) => {
  const email = uniqueEmail('sign-in-input')
  await completeSetupAndSkip(page, email)
  await signOut(page, 'Alex', email)
  let sent = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/auth/sign-in') sent++
  })
  const emailField = page.getByRole('textbox', { name: 'Email' })
  for (const invalid of ['', '   ', 'not an email', 'alex@localhost']) {
    await emailField.fill(invalid)
    await page.getByRole('button', { name: 'Send sign-in link', exact: true }).click()
    await expectFieldError(emailField)
    await expect(page.getByText(signInConfirmation, { exact: true })).toHaveCount(0)
  }
  expect(sent).toBe(0)
})

test('B52 a double-submitted setup form sends one link', async ({ page }) => {
  const email = uniqueEmail('double-submit')
  await page.goto('/setup')
  await expectSetup(page)
  const held = hold(page, '**/api/auth/setup')
  await held.installed
  await page.getByRole('textbox', { name: 'Name' }).fill('Alex')
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.locator('form button[type="submit"]').dblclick()
  await expect(page.locator('form button[type="submit"]')).toBeDisabled()
  await page.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit())
  await page.keyboard.press('Enter')
  expect(held.count()).toBe(1)
  held.release()
  await expect(page.getByText('Check your development inbox', { exact: true })).toBeVisible()
  expect(held.count()).toBe(1)
  await page.goto('/development-inbox')
  await expectInbox(page)
  await expect(message(page, email, setupSubject)).toHaveCount(1)
})

test('B70 setup, confirmation, onboarding, sign-out and sign-in work with the keyboard only', async ({
  page,
}) => {
  const email = uniqueEmail('keyboard')
  await page.goto('/setup')
  await expectSetup(page)
  await tabTo(page, page.getByRole('textbox', { name: 'Name' }))
  await page.keyboard.type('Alex')
  await tabTo(page, page.getByRole('textbox', { name: 'Email' }))
  await page.keyboard.type(email)
  await page.keyboard.press('Enter')
  const inboxLink = page.getByRole('link', { name: 'Open development inbox', exact: true })
  await expect(inboxLink).toBeVisible()
  await tabTo(page, inboxLink)
  await page.keyboard.press('Enter')
  await expectInbox(page)
  const setupMessage = message(page, email, setupSubject)
  await tabTo(page, setupMessage)
  await page.keyboard.press('Enter')
  const continueLink = page
    .getByRole('region', { name: 'Reading pane', exact: true })
    .getByRole('link', { name: 'Continue', exact: true })
  await expect(continueLink).toBeVisible()
  await tabTo(page, continueLink)
  await page.keyboard.press('Enter')
  await expect(page.getByText(`Continue as ${email}`, { exact: true })).toBeVisible()
  await tabTo(page, page.getByRole('button', { name: 'Continue', exact: true }))
  await page.keyboard.press('Enter')
  await expect(heading(page, 'Create a workspace')).toBeVisible()
  await tabTo(page, page.getByRole('button', { name: 'Skip', exact: true }))
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/dash\/workspaces$/)
  await expect(heading(page, 'Workspaces')).toBeVisible()
  await tabTo(page, page.getByRole('button', { name: 'Open account menu', exact: true }))
  await page.keyboard.press('Enter')
  const logOut = page.getByRole('menu').getByRole('menuitem', { name: 'Log out', exact: true })
  await expect(logOut).toBeVisible()
  await arrowTo(page, logOut)
  await page.keyboard.press('Enter')
  await expectSignIn(page)

  const emailField = page.getByRole('textbox', { name: 'Email' })
  await expect(emailField).toBeFocused()
  await page.keyboard.type(email)
  await page.keyboard.press('Enter')
  await expect(page.getByText(signInConfirmation, { exact: true })).toBeVisible()
  await tabTo(page, inboxLink)
  await page.keyboard.press('Enter')
  await expectInbox(page)
  const signInMessage = message(page, email, signInSubject)
  await tabTo(page, signInMessage)
  await page.keyboard.press('Enter')
  await expect(continueLink).toBeVisible()
  await tabTo(page, continueLink)
  await page.keyboard.press('Enter')
  await expect(page.getByText(`Continue as ${email}`, { exact: true })).toBeVisible()
  await tabTo(page, page.getByRole('button', { name: 'Continue', exact: true }))
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/dash\/workspaces$/)
  await expect(heading(page, 'Workspaces')).toBeVisible()
})
