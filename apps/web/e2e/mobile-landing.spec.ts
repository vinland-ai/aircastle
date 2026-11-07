import process from 'node:process'
import type { Locator, Page } from '@playwright/test'
import {
  phoneReplyToastAt,
  phoneScreenAt,
  phoneSheetAt,
  phoneTouchAt,
} from '../src/features/marketing/product-demo/phone-story'
import { askTiming } from '../src/features/marketing/product-demo/site-ask'
import { frameAt, loopDuration } from '../src/features/marketing/product-demo/timeline'
import { firstMoment, momentWhen, playPreview, siteOpensAt } from './preview-story'
import { test, expect } from './support'

const phone = { width: 390, height: 844 }

test.use({
  viewport: phone,
  ...(process.env.WEB_E2E_VIDEO === '1' ? { video: { mode: 'on' as const, size: phone } } : {}),
})

async function box(locator: Locator) {
  const value = await locator.boundingBox()
  if (!value) throw new Error('Element is not laid out')
  return value
}

async function expectInside(inner: Locator, outer: Locator, label: string) {
  const a = await box(inner)
  const b = await box(outer)
  expect(a.x, `${label} starts inside the phone window`).toBeGreaterThanOrEqual(b.x - 1)
  expect(a.x + a.width, `${label} ends inside the phone window`).toBeLessThanOrEqual(
    b.x + b.width + 1,
  )
  expect(a.y).toBeGreaterThanOrEqual(b.y - 1)
  expect(a.y + a.height).toBeLessThanOrEqual(b.y + b.height + 1)
}

async function expectNoSideScroll(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
    'the page never scrolls sideways',
  ).toBeLessThanOrEqual(390)
}

test('on a phone, the hero title wraps cleanly and the rotating word never reflows it', async ({
  page,
}) => {
  await page.clock.install({ time: 0 })
  await page.clock.pauseAt(1000)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  const title = page.getByRole('heading', { level: 1 })
  await expect(title).toBeVisible()
  await expectNoSideScroll(page)
  const titleBox = await box(title)
  expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(390 - 12)
  const fontSize = await title.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))
  expect(fontSize, 'a phone-sized title').toBeLessThanOrEqual(36)
  const heights = new Set<number>()
  const slotLines = new Set<number>()
  const words = new Set<string>()
  for (let turn = 0; turn < 5; turn += 1) {
    const now = await title.evaluate(async (element) => {
      const slot = element.querySelector('[aria-hidden="true"] > span')
      if (!slot) throw new Error('No rotating word')
      await Promise.all(
        slot.getAnimations({ subtree: true }).map((animation) => animation.finished),
      )
      return {
        word: slot.textContent ?? '',
        height: Math.round(element.getBoundingClientRect().height),
        slot: Math.round(slot.getBoundingClientRect().top),
      }
    })
    words.add(now.word)
    heights.add(now.height)
    slotLines.add(now.slot)
    await page.clock.runFor(4000)
  }
  expect(words.size, 'every rotating word was measured once settled').toBeGreaterThanOrEqual(4)
  expect(heights.size, 'the title keeps one height as the word rotates').toBe(1)
  expect(slotLines.size, 'the rotating word stays on its line').toBe(1)
  const actions = [
    page.getByRole('main').getByRole('link', { name: 'Get started', exact: true }),
    page.getByRole('main').getByRole('link', { name: 'See Aircastle in action', exact: true }),
  ]
  for (const action of actions) {
    const actionBox = await box(action)
    expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(390)
  }
  const [start, demo] = await Promise.all(actions.map(box))
  if (!start || !demo) throw new Error('Hero actions are not laid out')
  expect(demo.y, 'the demo link sits under Get started').toBeGreaterThan(start.y + start.height - 1)
  expect(Math.abs(demo.x - start.x), 'and lines up with its left edge').toBeLessThan(2)
  const summary = page.getByText(/^Aircastle is the headless CMS/)
  expect(
    parseFloat(await summary.evaluate((element) => getComputedStyle(element).fontSize)),
    'a phone-sized summary',
  ).toBeLessThanOrEqual(18)
  const credit = await box(page.getByText('Presented by'))
  const header = await box(page.getByRole('banner'))
  expect(credit.y - (header.y + header.height), 'the hero starts close to the header').toBeLessThan(
    56,
  )
})

const tapTargets: Record<string, string> = {
  row: '[data-phone-agent-card]',
  research: '[data-phone-research]',
  decision: '[data-demo-decision-option]',
  preview: '[data-phone-preview-button]',
  reference: '[data-phone-reference]',
  publish: '[data-phone-publish]',
  bell: '[data-demo-notifications]',
  'notification-preview': '[data-demo-notification-action][data-pressed]',
  'docs-publish': '[data-phone-publish]',
}

const overlays = [
  '[data-phone-sheet="ask"]',
  '[data-demo-research-panel][data-state="open"]',
  '[data-demo-notifications-menu]',
  '[data-phone-reply][data-state="shown"]',
  '[data-demo-ask-air]',
]

type Rect = { left: number; top: number; right: number; bottom: number }

type PhoneMoment = {
  screen: string
  sheet: string
  dialog: string | null
  touch: { x: number; y: number; target: string; kind: string } | null
  phone: Rect
  pressed: Rect | null
  opening: Rect[]
  overlays: { selector: string; rect: Rect }[]
  sheetOpacities: number[]
}

function readPhone(frame: Locator) {
  return frame.evaluate(
    (element, { tapTargets, overlays }) => {
      const rect = (node: Element) => {
        const { left, top, right, bottom } = node.getBoundingClientRect()
        return { left, top, right, bottom }
      }
      const touch = element.querySelector('[data-phone-touch]')
      const touchBox = touch?.getBoundingClientRect()
      const target = touch?.getAttribute('data-target') ?? ''
      const pressed = tapTargets[target] ? element.querySelector(tapTargets[target]) : null
      const opening = element.querySelector('[data-demo-site-opening]')
      return {
        screen: element.getAttribute('data-phone-screen') ?? '',
        sheet: element.getAttribute('data-phone-sheet-open') ?? '',
        dialog:
          element.querySelector('[data-phone-sheet="ask"]')?.getAttribute('data-state') ?? null,
        touch:
          touch && touchBox
            ? {
                x: touchBox.left + touchBox.width / 2,
                y: touchBox.top + touchBox.height / 2,
                target,
                kind: touch.getAttribute('data-phone-touch') ?? '',
              }
            : null,
        phone: rect(element),
        pressed: pressed ? rect(pressed) : null,
        opening: opening
          ? [...opening.getClientRects()].map((line) => ({
              left: line.left,
              top: line.top,
              right: line.right,
              bottom: line.bottom,
            }))
          : [],
        sheetOpacities: [
          ...element.querySelectorAll('[data-phone-sheet], [data-demo-research-panel]'),
        ].map((sheet) => Number(getComputedStyle(sheet).opacity)),
        overlays: overlays.flatMap((selector) =>
          [...element.querySelectorAll(selector)].map((node) => ({ selector, rect: rect(node) })),
        ),
      }
    },
    { tapTargets, overlays },
  ) as Promise<PhoneMoment>
}

function contains(outer: Rect, x: number, y: number, slack = 0) {
  return (
    x >= outer.left - slack &&
    x <= outer.right + slack &&
    y >= outer.top - slack &&
    y <= outer.bottom + slack
  )
}

/** Every moment the phone changes what it shows: its screen, its sheet, its touch or the Ask Air sheet's state. */
function phoneChanges() {
  const changes: { at: number; touch: string }[] = []
  let previous = ''
  for (let at = 0; at < loopDuration; at += 5) {
    const frame = frameAt(at)
    const touch = phoneTouchAt(frame)
    const touchKey = touch ? `${touch.kind}:${touch.target}` : ''
    const key = [phoneScreenAt(frame), phoneSheetAt(frame), touchKey, frame.dialog].join('|')
    if (key !== previous) changes.push({ at, touch: touchKey })
    previous = key
  }
  return changes
}

test('on a phone, the preview tells the same story on a phone-shaped screen, and every tap lands on what it presses', async ({
  page,
}) => {
  const story = await playPreview(page)
  const stage = story.stage
  await expect(stage).toHaveAttribute('data-demo-stage', 'phone')
  const frame = page.locator('[data-demo-phone]')
  await expect(frame).toBeVisible()
  await expectInside(frame, stage, 'the phone screen')
  const stageBox = await box(stage)
  const phoneBox = await box(frame)
  expect(phoneBox.width, 'the phone screen fills the column').toBeGreaterThan(340)
  expect(Math.abs(stageBox.height - phoneBox.height), 'the stage fits the phone').toBeLessThan(2)
  await expectNoSideScroll(page)

  const screens: string[] = []
  const sheets: string[] = []
  const taps = new Set<string>()
  let dragStart: PhoneMoment | null = null
  let dragEnd: PhoneMoment | null = null
  let backdropChecked = false
  let researchStripBack = false
  const changes = phoneChanges()
  const lastPress = firstMoment(
    (now) => phoneTouchAt(now)?.kind !== 'press',
    firstMoment((now) => phoneTouchAt(now)?.kind === 'press'),
  )
  const visits = [...changes.map(({ at }) => at + 20), lastPress - 15, loopDuration + 20].sort(
    (left, right) => left - right,
  )
  for (const at of visits) {
    await story.jumpTo(at)
    let now = await readPhone(frame)
    if ((now.touch?.kind === 'tap' && !taps.has(now.touch.target)) || now.touch?.kind === 'press') {
      await page.waitForTimeout(600)
      now = await readPhone(frame)
    }
    if (screens.at(-1) !== now.screen) screens.push(now.screen)
    if (now.sheet === 'research' && !sheets.includes('research')) {
      await page.waitForTimeout(600)
      expect(
        (await box(frame.locator('[data-phone-research]'))).height,
        "Canute's status strip folds away while his chat is open",
      ).toBeLessThan(1)
    }
    if (now.sheet === 'none' && sheets.at(-1) === 'research' && !researchStripBack) {
      await page.waitForTimeout(600)
      await expect(frame.locator('[data-phone-research]')).toBeVisible()
      researchStripBack = true
    }
    if (now.sheet !== 'none' && sheets.at(-1) !== now.sheet) sheets.push(now.sheet)
    if (now.touch)
      expect(
        contains(now.phone, now.touch.x, now.touch.y),
        `the touch on ${now.touch.target} is on the screen`,
      ).toBe(true)
    for (const opacity of now.sheetOpacities)
      expect(opacity, 'sheets slide in solid, never see-through').toBe(1)
    for (const overlay of now.overlays) {
      expect(overlay.rect.left, `${overlay.selector} starts on the screen`).toBeGreaterThanOrEqual(
        now.phone.left - 1,
      )
      expect(overlay.rect.right, `${overlay.selector} ends on the screen`).toBeLessThanOrEqual(
        now.phone.right + 1,
      )
    }
    if (now.touch?.kind === 'tap' && !taps.has(now.touch.target)) {
      expect(now.pressed, `${now.touch.target} is on the screen when tapped`).not.toBeNull()
      expect(
        contains(now.pressed!, now.touch.x, now.touch.y),
        `the ${now.touch.target} tap at ${Math.round(now.touch.x - now.phone.left)},${Math.round(now.touch.y - now.phone.top)} lands on it: ${JSON.stringify(now.pressed)} in ${JSON.stringify(now.phone)}`,
      ).toBe(true)
      taps.add(now.touch.target)
    }
    if (now.touch?.kind === 'press') {
      dragStart ??= now
      dragEnd = now
    }
    if (now.dialog === 'closing' && !backdropChecked) {
      await page.waitForTimeout(450)
      const backdrop = frame.locator('[data-phone-backdrop]')
      expect(
        Number(await backdrop.evaluate((element) => getComputedStyle(element).opacity)),
        'the blur lifts with the Ask Air sheet',
      ).toBeLessThan(0.05)
      backdropChecked = true
    }
  }

  expect(screens).toEqual(['posts', 'editor', 'site', 'docs', 'posts'])
  expect(sheets).toEqual(['ask', 'research', 'air'])
  expect([...taps].sort()).toEqual(Object.keys(tapTargets).sort())
  expect(backdropChecked, 'the Ask Air sheet closed in view').toBe(true)
  expect(researchStripBack, "Canute's status strip returns when his chat closes").toBe(true)
  const [firstLine] = dragStart?.opening ?? []
  const lastLine = dragEnd?.opening.at(-1)
  if (!dragStart || !dragEnd || !firstLine || !lastLine)
    throw new Error('The opening line was never selected')
  expect(
    contains(firstLine, dragStart.touch!.x, dragStart.touch!.y, 12),
    'the selection starts on the opening line',
  ).toBe(true)
  expect(
    contains(lastLine, dragEnd.touch!.x, dragEnd.touch!.y, 12),
    'and ends on its last word',
  ).toBe(true)
})

const outroStarts = firstMoment((now) => now.outroElapsed !== null)

test('on a phone, the closing card fits the phone screen', async ({ page }) => {
  const story = await playPreview(page)
  const outro = page.locator('[data-demo-phone] [data-demo-outro]')
  await story.jumpTo(outroStarts + 4000)
  await expect(outro).toHaveCount(1)
  await expectInside(outro.locator('[data-demo-outro-mark]'), story.stage, 'the closing mark')
  await expectInside(outro.locator('[data-demo-outro-wordmark]'), story.stage, 'the closing name')
  await expectNoSideScroll(page)
})

test('on a phone, the whole preview story plays through in its window, start to finish', async ({
  page,
}) => {
  const story = await playPreview(page)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const stage = story.stage
  await test.step('scroll down to the preview', async () => {
    await expect(stage).toHaveAttribute('data-demo-stage', 'phone')
  })
  const frame = page.locator('[data-demo-phone]')
  await test.step('Ask Air takes the request in a sheet', async () => {
    await story.jumpTo(momentWhen((now) => now.dialog === 'open'))
    await expect(frame.locator('[data-phone-sheet="ask"]')).toBeVisible()
  })
  await test.step('the agents open the post in the editor', async () => {
    await story.jumpTo(momentWhen((now) => phoneScreenAt(now) === 'editor'))
    await expect(frame).toHaveAttribute('data-phone-screen', 'editor')
  })
  await test.step("Canute's research rises as a sheet", async () => {
    await story.jumpTo(momentWhen((now) => phoneSheetAt(now) === 'research'))
    await expect(frame).toHaveAttribute('data-phone-sheet-open', 'research')
  })
  await test.step('the post is previewed on the live site', async () => {
    await story.jumpTo(momentWhen((now) => phoneScreenAt(now) === 'site'))
    await expect(frame).toHaveAttribute('data-phone-screen', 'site')
  })
  await test.step('Air takes the line to its team', async () => {
    await story.jumpTo(momentWhen((now) => phoneSheetAt(now) === 'air'))
    await expect(frame).toHaveAttribute('data-phone-sheet-open', 'air')
    await story.jumpTo(momentWhen((now) => phoneReplyToastAt(now)))
    await expect(frame.locator('[data-phone-reply]')).toHaveAttribute('data-state', 'shown')
  })
  await test.step('the docs page is previewed and published', async () => {
    await story.jumpTo(momentWhen((now) => phoneScreenAt(now) === 'docs'))
    await expect(frame).toHaveAttribute('data-phone-screen', 'docs')
    await story.jumpTo(siteOpensAt + askTiming.docsPublishClicked + 20)
    await expect(frame.locator('[data-phone-status]')).toHaveText('Published')
  })
  await test.step('the closing card names Aircastle', async () => {
    await story.jumpTo(outroStarts + 4000)
    const wordmark = frame.locator('[data-demo-outro-wordmark]')
    await expect(wordmark).toBeVisible()
    await expect
      .poll(() => wordmark.evaluate((element) => Number(getComputedStyle(element).opacity)))
      .toBe(1)
    const name = await box(wordmark)
    const window = await box(stage)
    expect(name.x).toBeGreaterThanOrEqual(window.x)
    expect(name.x + name.width).toBeLessThanOrEqual(window.x + window.width)
  })
  await expectNoSideScroll(page)
})
