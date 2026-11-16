import { installMountProbe, readMountProbe } from './mount-probe'
import { test, expect } from './auth-service'
import {
  capturedLink,
  expectInbox,
  expectSignIn,
  message,
  signInConfirmation,
  signOut,
} from './auth-journey'
import {
  signInSubject,
  fixtureHttpErrors,
  uniqueEmail,
  origin,
  heading,
  confirmLink,
  completeSetupAndSkip,
  signInWithLink,
  rawRequest,
} from './auth-behavior-journey'

test('B31 hostile return targets never leave the configured origin', async ({ page }) => {
  const email = uniqueEmail('hostile-return')
  await completeSetupAndSkip(page, email)
  await signOut(page, 'Alex', email)
  const home = origin(page)
  const foreign: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== home) foreign.push(request.url())
  })
  const hostileTargets = [
    'https://evil.test',
    '//evil.test',
    '/\\evil.test',
    '/%2F%2Fevil.test',
    'https:evil.test',
    'javascript:alert(1)',
  ]
  const hostileQuery = new URLSearchParams(
    hostileTargets.flatMap((target) =>
      ['callbackURL', 'redirect', 'returnTo'].map((name) => [name, target]),
    ),
  ).toString()
  await page.goto(`/sign-in?${hostileQuery}`)
  await expectSignIn(page)
  const sent = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && new URL(request.url()).pathname === '/api/auth/sign-in',
  )
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('button', { name: 'Send sign-in link', exact: true }).click()
  expect((await sent).postDataJSON()).toEqual({ email })
  await expect(page.getByText(signInConfirmation, { exact: true })).toBeVisible()
  for (const returnTo of [...hostileTargets, { kind: 'url', url: 'https://evil.test' }]) {
    const response = await rawRequest(page, '/api/auth/sign-in', { email, returnTo })
    expect(response.status(), JSON.stringify(returnTo)).toBe(400)
    expect((await response.json()).kind).toBe('invalid-input')
  }
  await page.goto('/development-inbox')
  await expectInbox(page)
  await expect(message(page, email, signInSubject)).toHaveCount(1)
  const link = await capturedLink(page, email, signInSubject)
  await confirmLink(page, `${link}&${hostileQuery}`, email)
  await expect(page).toHaveURL(`${home}/dash/workspaces`)
  await expect(heading(page, 'Workspaces')).toBeVisible()
  expect(foreign).toEqual([])
})

test.describe('forbidden destinations', () => {
  test.use({ expectedHttpErrors: [...fixtureHttpErrors, '/api/auth/entry'] })

  test('B32 a signed-in visit to a workspace without access falls back to the dashboard', async ({
    page,
    authService,
  }) => {
    const project = await authService.provisionProject()
    await completeSetupAndSkip(page, uniqueEmail('forbidden'))
    await page.goto(`/dash/workspaces/${project.workspaceId}/projects`)
    await expect(page).toHaveURL(`${origin(page)}/dash/workspaces`)
    await expect(heading(page, 'Workspaces')).toBeVisible()
    await expect(heading(page, 'Projects')).toHaveCount(0)
  })
})

test.describe('protected path variants', () => {
  test.use({ expectedHttpErrors: [...fixtureHttpErrors, '/api/auth/entry'] })

  function variants(workspaceId: string, projectId: string) {
    return [
      `/dash/workspaces/${workspaceId}/projects/`,
      `/dash/workspaces/${workspaceId}/PROJECTS`,
      `/DASH/workspaces/${workspaceId}/projects`,
      `/Dash/workspaces/${workspaceId}/projects/${projectId}/collections`,
      '/dash/workspaces/not-a-uuid/projects',
      `/dash/workspaces/${workspaceId}/projects/${projectId}/tasks/`,
    ]
  }

  test('B33 signed-out visits to protected path variants go to sign-in without mounting the page', async ({
    page,
    authService,
  }) => {
    const project = await authService.provisionProject()
    const email = uniqueEmail('variants-signed-out')
    await completeSetupAndSkip(page, email)
    await signOut(page, 'Alex', email)
    await installMountProbe(page, 'protected-pages')
    for (const path of variants(project.workspaceId, project.projectId)) {
      await page.goto(path)
      await expectSignIn(page)
      expect(await readMountProbe(page, 'protected-pages'), path).toEqual({
        projects: false,
        shell: false,
      })
    }
  })

  test('B34 signed-in visits without access to protected path variants are denied without mounting the page', async ({
    page,
    authService,
  }) => {
    const project = await authService.provisionProject()
    await completeSetupAndSkip(page, uniqueEmail('variants-outsider'))
    await installMountProbe(page, 'protected-pages')
    for (const path of variants(project.workspaceId, project.projectId)) {
      await page.goto(path)
      await expect(page).toHaveURL(`${origin(page)}/dash/workspaces`)
      await expect(heading(page, 'Workspaces')).toBeVisible()
      expect(await readMountProbe(page, 'protected-pages'), path).toEqual({
        projects: false,
        shell: false,
      })
    }
  })

  test('B35 a member reaches the canonical projects and project pages', async ({
    page,
    authService,
  }) => {
    const project = await authService.provisionProject()
    const email = uniqueEmail('variants-member')
    await completeSetupAndSkip(page, email)
    await authService.grantWorkspace(email, project.workspaceId)
    await installMountProbe(page, 'protected-pages')
    const projects = `/dash/workspaces/${project.workspaceId}/projects`
    await page.goto(projects)
    await expect(page).toHaveURL(`${origin(page)}${projects}`)
    await expect(heading(page, 'Projects')).toBeVisible()
    expect(await readMountProbe(page, 'protected-pages')).toEqual({ projects: true, shell: false })
    const collections = `${projects}/${project.projectId}/collections`
    await page.goto(collections)
    await expect(page).toHaveURL(`${origin(page)}${collections}`)
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
    expect(await readMountProbe(page, 'protected-pages')).toEqual({ projects: false, shell: true })
  })

  test('B36 a case-variant project page is checked again after access is removed or the session ends', async ({
    page,
    authService,
  }) => {
    const project = await authService.provisionProject()
    const email = uniqueEmail('variants-revoked')
    await completeSetupAndSkip(page, email)
    await authService.grantWorkspace(email, project.workspaceId)
    const variant = `/Dash/workspaces/${project.workspaceId}/projects/${project.projectId}/collections`
    const navigation = page.getByRole('navigation', { name: 'Main navigation' })

    await page.goto(variant)
    await expect(navigation).toBeVisible()
    await authService.revokeWorkspace(email, project.workspaceId)
    await navigation.getByRole('link', { name: 'Collections', exact: true }).click()
    await expect(page).toHaveURL(`${origin(page)}/dash/workspaces`)
    await expect(heading(page, 'Workspaces')).toBeVisible()
    await expect(navigation).toHaveCount(0)

    await authService.grantWorkspace(email, project.workspaceId)
    await page.goto(variant)
    await expect(navigation).toBeVisible()
    const second = await page.context().newPage()
    await second.goto('/dash/workspaces')
    await expect(heading(second, 'Workspaces')).toBeVisible()
    await signOut(second, 'Alex', email)
    await navigation.getByRole('link', { name: 'Collections', exact: true }).click()
    await expectSignIn(page)
    await expect(navigation).toHaveCount(0)
  })
})

test('B77 a member signing in without a requested page returns to the last visited workspace', async ({
  page,
  authService,
}) => {
  const project = await authService.provisionProject()
  const email = uniqueEmail('member')
  await completeSetupAndSkip(page, email)
  await authService.grantWorkspace(email, project.workspaceId)
  const projects = `/dash/workspaces/${project.workspaceId}/projects`
  await page.goto(projects)
  await expect(heading(page, 'Projects')).toBeVisible()
  await signOut(page, 'Alex', email)
  await signInWithLink(page, email)
  await expect(page).toHaveURL(`${origin(page)}${projects}`)
  await expect(heading(page, 'Projects')).toBeVisible()
})
