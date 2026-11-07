import type { Locator } from '@playwright/test'
import { openingLine, rewrittenLine } from '../src/features/marketing/product-demo/body-draft'
import { docsDecisionState, sourcesReadBy } from '../src/features/marketing/product-demo/research'
import {
  askInstruction,
  askKeystroke,
  askTiming,
} from '../src/features/marketing/product-demo/site-ask'
import {
  frameAt,
  loopDuration,
  playbackRate,
  prompt,
} from '../src/features/marketing/product-demo/timeline'
import { box, firstMoment, inside, momentWhen, playPreview, siteOpensAt } from './preview-story'
import { test, expect } from './support'

/** Real milliseconds that play this many milliseconds of the preview's timeline. */
function story(timeline: number) {
  return Math.ceil(timeline / playbackRate)
}

/** Scrolls the preview into view and waits until it is playing, since it only plays once it is mostly on screen. */
async function playInView(scope: Locator) {
  await scope.scrollIntoViewIfNeeded()
  await expect(scope.page().locator('[data-demo-stage]')).toHaveAttribute(
    'data-demo-playing',
    'true',
  )
}

test('product preview sits below the hero without a visible label', async ({ page }) => {
  await page.goto('/')
  const preview = page.getByRole('region', { name: 'Aircastle preview' })
  await expect(preview).toBeVisible()
  await expect(preview.locator(':scope > p').filter({ hasText: /^Preview$/ })).toHaveCount(0)
  const heroBox = await page.getByRole('link', { name: 'Get started', exact: true }).boundingBox()
  const previewBox = await preview.boundingBox()
  if (!heroBox || !previewBox) throw new Error('Landing page is not laid out')
  expect(previewBox.y).toBeGreaterThan(heroBox.y + heroBox.height)
})

test('landing content and preview match a Paper-sized column with a shorter frame', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const heading = await page.getByRole('heading', { level: 1 }).boundingBox()
  const frame = await page
    .getByRole('region', { name: 'Aircastle preview' })
    .locator('[data-demo-frame]')
    .boundingBox()
  if (!heading || !frame) throw new Error('Landing page is not laid out')
  expect(frame.width).toBeGreaterThan(1060)
  expect(frame.width).toBeLessThanOrEqual(1100)
  expect(heading.x).toBeCloseTo(frame.x, 0)
  expect(frame.height / frame.width).toBeLessThan(0.6)
})

test('product preview shows the posts collection without motion', async ({ page }) => {
  await page.goto('/')
  const frame = page.getByRole('region', { name: 'Aircastle preview' }).locator('[data-demo-frame]')
  await expect(
    frame.locator('[data-demo-table]').getByText('Blog posts', { exact: true }),
  ).toBeVisible()
  await expect(frame.getByText('How we cut build times by 40%', { exact: true })).toBeVisible()
  await expect(frame.locator('[data-demo-dialog]')).toHaveCount(0)
  expect(await frame.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0)
})

test('product preview mirrors the dashboard shell with a collapsed sidebar', async ({ page }) => {
  await page.goto('/')
  const frame = page.getByRole('region', { name: 'Aircastle preview' }).locator('[data-demo-frame]')
  const header = frame.locator('[data-demo-header]')
  await expect(header).toContainText('Acme Inc')
  await expect(header.getByText('Pro', { exact: true })).toBeVisible()
  await expect(header).toContainText('Acme Platforms')
  await expect(header).toContainText('Connect')
  await expect(header).toContainText('Search...')
  await expect(header).not.toContainText('Upgrade')
  await expect(header).not.toContainText('Free')
  const bell = header.locator('[data-demo-notifications] svg.lucide-bell')
  await expect(bell).toHaveCount(1)
  const order = await header.evaluate((element) => {
    const left = (selector: string) =>
      element.querySelector(selector)?.getBoundingClientRect().left ?? -1
    return [
      left('svg.lucide-book-open'),
      [...element.querySelectorAll('svg.lucide-sun, svg.lucide-moon')]
        .map((icon) => icon.getBoundingClientRect())
        .find((box) => box.width > 0)?.left ?? -1,
      left('[data-demo-notifications]'),
      left('[data-demo-account]'),
    ]
  })
  expect(order.every((value) => value >= 0)).toBe(true)
  expect(order).toEqual([...order].sort((first, second) => first - second))
  const rail = frame.locator('[data-demo-sidebar]')
  await expect(rail.locator('svg')).toHaveCount(8)
  const railBox = await rail.boundingBox()
  const frameBox = await frame.boundingBox()
  if (!railBox || !frameBox) throw new Error('Preview is not laid out')
  expect(railBox.width / frameBox.width).toBeLessThan(0.06)
})

test('product preview table shows truncated plain-text bodies and a count badge', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const frame = page.getByRole('region', { name: 'Aircastle preview' }).locator('[data-demo-frame]')
  await expect(frame.locator('[data-demo-count]')).toHaveText('7')
  await expect(frame.locator('[data-demo-table]').getByText('Body', { exact: true })).toBeVisible()
  const bodies = frame.locator('[data-demo-body]')
  await expect(bodies).toHaveCount(6)
  const firstBody = bodies.first()
  await expect(firstBody).toHaveCSS('text-overflow', 'ellipsis')
  expect(await firstBody.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
    true,
  )
  await expect(firstBody.locator('*')).toHaveCount(0)
})

test('the preview holds a still frame with reduced motion', async ({ page }) => {
  await page.clock.install({ time: 0 })
  await page.clock.pauseAt(1000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const frame = page.getByRole('region', { name: 'Aircastle preview' }).locator('[data-demo-frame]')
  await frame.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await expect(page.locator('[data-demo-stage]')).toHaveAttribute('data-demo-playing', 'false')
  for (const moment of [2600, 9000]) {
    await page.clock.runFor(story(moment))
    await expect(
      frame.locator('[data-demo-dialog]'),
      'the dialog would be open at 2.6s',
    ).toHaveCount(0)
    await expect(frame.locator('[data-demo-table]')).toHaveAttribute('data-state', 'shown')
    await expect(frame.locator('[data-demo-editor]')).toHaveAttribute('data-state', 'hidden')
    await expect(frame.locator('[data-demo-cursor]')).toHaveAttribute('data-state', 'resting')
  }
})

test('product preview has a bordered window-dots strip above the header and no frame border', async ({
  page,
}) => {
  await page.goto('/')
  const frame = page.getByRole('region', { name: 'Aircastle preview' }).locator('[data-demo-frame]')
  await expect(frame).toHaveCSS('border-top-width', '0px')
  const dots = frame.locator('[data-demo-window-dots]')
  await expect(dots.locator('> *')).toHaveCount(3)
  await expect(dots).toHaveCSS('border-bottom-width', '1px')
  const dotsBox = await dots.boundingBox()
  const headerBox = await frame.locator('[data-demo-header]').boundingBox()
  if (!dotsBox || !headerBox) throw new Error('Preview is not laid out')
  expect(dotsBox.y + dotsBox.height).toBeLessThanOrEqual(headerBox.y + 0.5)
})

test('the preview table lists authors, with some posts written by several people', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const frame = page.getByRole('region', { name: 'Aircastle preview' }).locator('[data-demo-frame]')
  await expect(
    frame.locator('[data-demo-table]').getByText('Authors', { exact: true }),
  ).toBeVisible()
  await expect(frame.locator('[data-demo-table]').getByText('Author', { exact: true })).toHaveCount(
    0,
  )
  const authorCells = frame.locator('[data-demo-authors]')
  const counts = await authorCells.evaluateAll((cells) =>
    cells.map((cell) => Number(cell.getAttribute('data-demo-authors'))),
  )
  expect(counts.some((count) => count > 1)).toBe(true)
  await expect(frame.locator('[data-demo-authors]').filter({ hasText: /agent/i })).toHaveCount(0)
  const faces = await authorCells.evaluateAll((cells) =>
    cells.flatMap((cell) =>
      [...cell.querySelectorAll(':scope > span:first-child > span')].map(
        (avatar) => avatar.querySelector('img')?.getAttribute('src') ?? null,
      ),
    ),
  )
  expect(faces.length).toBeGreaterThan(6)
  expect(
    faces.every((src) => src?.startsWith('/demo/')),
    'every author has a portrait',
  ).toBe(true)
})

test('Abyan’s own photo, served from the app, is the account avatar and his author avatar', async ({
  page,
}) => {
  await page.goto('/')
  const frame = page.getByRole('region', { name: 'Aircastle preview' }).locator('[data-demo-frame]')
  const photos = [
    frame.locator('[data-demo-account] img'),
    frame.locator('[data-demo-agent-row] [data-demo-authors] img'),
    frame.locator('[data-demo-field="authors"] img'),
  ]
  for (const photo of photos) {
    await expect(photo).toHaveAttribute('src', '/demo/abyan.jpg')
    await expect(photo).toHaveAttribute('alt', '')
  }
  const response = await page.request.get('/demo/abyan.jpg')
  expect(response.ok()).toBe(true)
  expect(response.headers()['content-type']).toContain('image/jpeg')
})

test('the story opens: ⌘J opens Ask Air, the idea is typed and sent, the agents join a new row and the cursor clicks it open', async ({
  page,
}) => {
  const story = await playPreview(page)
  const preview = page.getByRole('region', { name: 'Aircastle preview' })
  const frame = preview.locator('[data-demo-frame]')
  const header = frame.locator('[data-demo-header]')
  const dialog = frame.locator('[data-demo-dialog]')
  const shortcut = frame.locator('[data-demo-shortcut]')
  const typed = dialog.locator('[data-demo-prompt]')
  const cursor = frame.locator('[data-demo-cursor]')
  const agentRow = frame.locator('[data-demo-row="agent"]')
  const row = frame.locator('[data-demo-agent-row]')
  const agents = frame.locator('[data-demo-agents]')
  const avatars = agents.locator('[data-demo-agent-avatar]')
  const editor = frame.locator('[data-demo-editor]')
  const table = frame.locator('[data-demo-table]')

  story.at(
    500,
    'the cursor rests in the frame and the header has an Ask Air split button',
    async () => {
      await expect(dialog).toHaveCount(0)
      await expect(cursor).toHaveAttribute('data-state', 'resting')
      await expect(cursor).toHaveAttribute('data-shape', 'arrow')
      await expect(cursor).toHaveCSS('opacity', '1')
      const cursorBox = await box(cursor)
      const frameBox = await box(frame)
      expect(cursorBox.x).toBeGreaterThanOrEqual(frameBox.x)
      expect(cursorBox.y).toBeGreaterThanOrEqual(frameBox.y)
      expect(cursorBox.x + cursorBox.width).toBeLessThanOrEqual(frameBox.x + frameBox.width)
      expect(cursorBox.y + cursorBox.height).toBeLessThanOrEqual(frameBox.y + frameBox.height)
      const ask = header.locator('[data-demo-ask]')
      const trigger = header.locator('[data-demo-ask-menu-trigger]')
      await expect(ask).toHaveText(/^Ask Air\s*⌘J$/)
      await expect(ask.getByText('⌘J', { exact: true })).toBeVisible()
      const mascot = ask.locator('.air-mascot')
      await expect(mascot).toHaveCount(1)
      await expect(mascot).toHaveCSS('mask-image', /air\.svg/)
      await expect(ask.locator('svg.lucide-bot')).toHaveCount(0)
      await expect(ask.locator('.brand-logo')).toHaveCount(0)
      await expect(trigger.locator('svg.lucide-chevron-down')).toHaveCount(1)
      const askBox = await box(ask)
      const triggerBox = await box(trigger)
      const searchBox = await box(header.locator('[data-demo-search]'))
      expect(Math.abs(triggerBox.x - (askBox.x + askBox.width))).toBeLessThanOrEqual(1)
      expect(Math.abs(triggerBox.height - askBox.height)).toBeLessThanOrEqual(1)
      expect(triggerBox.width).toBeLessThanOrEqual(askBox.height + 1)
      expect(triggerBox.x + triggerBox.width).toBeLessThanOrEqual(searchBox.x)
      await expect(header.locator('[data-demo-ask-menu]')).toHaveAttribute('data-state', 'closed')
    },
  )

  story.at(
    momentWhen((now) => now.shortcut === 'open-agents'),
    'a ⌘J chip shows',
    async () => {
      await expect(shortcut).toHaveAttribute('data-state', 'shown')
      await expect(shortcut).toContainText('⌘')
      await expect(shortcut).toContainText('J')
      await expect(dialog).toHaveCount(0)
    },
  )

  story.at(
    momentWhen((now) => now.dialog === 'open'),
    'Ask Air opens over a blur of the whole app',
    async () => {
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText('Ask Air')
      await expect(dialog).not.toContainText('Ask agents')
      await page.waitForTimeout(400)
      const layers = await frame.evaluate((element) => {
        const frameBox = element.getBoundingClientRect()
        const scale = frameBox.width / 1280
        element.removeAttribute('inert')
        const hitAt = (x: number, y: number) => {
          const hit = document.elementFromPoint(frameBox.x + x * scale, frameBox.y + y * scale)
          if (hit?.closest('[data-demo-window-dots]')) return 'dots'
          if (hit?.closest('[data-demo-dialog-backdrop]')) return 'backdrop'
          if (hit?.closest('[data-demo-dialog]')) return 'dialog'
          return 'uncovered'
        }
        const result = {
          dots: hitAt(200, 16),
          header: hitAt(900, 60),
          sidebar: hitAt(28, 300),
          table: hitAt(640, 650),
          dialog: hitAt(640, 230),
        }
        element.setAttribute('inert', '')
        return result
      })
      expect(layers, 'the blur covers the whole app but the window dots').toEqual({
        dots: 'dots',
        header: 'backdrop',
        sidebar: 'backdrop',
        table: 'backdrop',
        dialog: 'dialog',
      })
      await expect(dialog.locator('.air-mascot')).toHaveCount(1)
      await expect(
        dialog.locator('[data-demo-role-label]'),
        'Air is labelled as the orchestrator',
      ).toHaveText('Orchestrator')
      await expect(dialog.locator('svg.lucide-sparkles')).toHaveCount(0)
      await expect(typed).toHaveText('')
    },
  )

  const partway = momentWhen((now) => now.typed === Math.floor(prompt.length / 2))
  story.at(partway, 'the idea types in', async () => {
    await expect(typed).toHaveText(prompt.slice(0, frameAt(partway).typed))
    await expect(typed).not.toHaveText(prompt)
  })

  story.at(
    momentWhen((now) => now.typed === prompt.length),
    'the whole idea is typed',
    async () => {
      await expect(typed).toHaveText(prompt)
      await expect(shortcut).toHaveAttribute('data-state', 'hidden')
    },
  )

  story.at(
    momentWhen((now) => now.sendPressed),
    'Enter sends it',
    async () => {
      await expect(shortcut).toHaveAttribute('data-state', 'shown')
      await expect(shortcut).toContainText('↵')
      await expect(shortcut).not.toContainText('⌘')
      await expect(dialog.locator('[data-demo-send]')).toHaveAttribute('data-pressed', 'true')
    },
  )

  story.at(
    momentWhen((now) => now.agentRow && now.dialog === 'closed'),
    'a new row appears with Air working on it',
    async () => {
      await expect(dialog).toHaveCount(0)
      await expect(agentRow).toHaveAttribute('data-state', 'shown')
      await expect(agentRow).toContainText('Introducing Acme MCP')
      await expect(agentRow).toContainText('Abyan')
      await expect(agentRow.getByText('Draft', { exact: true })).toHaveCSS(
        'background-color',
        await table
          .getByText('Draft', { exact: true })
          .last()
          .evaluate((pill) => getComputedStyle(pill).backgroundColor),
      )
      await expect(agentRow).toHaveAttribute('data-agents-working', 'true')
      await expect(frame.locator('[data-demo-count]')).toHaveText('7')
      await expect(avatars, 'Air is on the row first').toHaveCount(1)
      await expect(avatars.first().locator('.air-mascot')).toHaveCount(1)
    },
  )

  story.at(
    momentWhen((now) => now.rowAgents === 3),
    'the other agents join one by one',
    async () => {
      await expect(avatars).toHaveCount(3)
    },
  )

  story.at(
    momentWhen((now) => now.rowAgents === 4),
    'the cursor still rests before it sets off',
    async () => {
      await expect(avatars).toHaveCount(4)
      await expect(cursor).toHaveAttribute('data-state', 'resting')
      await expect(agents).toHaveAttribute('data-expanded', 'false')
    },
  )

  story.at(
    momentWhen((now) => now.rowAgents === 5),
    'all five agents are on a white, outlined row',
    async () => {
      await expect(avatars).toHaveCount(5)
      const neutral = await agents.evaluate((tab) => {
        const context = document.createElement('canvas').getContext('2d')
        if (!context) throw new Error('No canvas')
        context.fillStyle = getComputedStyle(tab).backgroundColor
        context.fillRect(0, 0, 1, 1)
        const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data
        return Math.max(red, green, blue) - Math.min(red, green, blue)
      })
      expect(neutral, 'the row is white for Air, not purple').toBeLessThan(4)
      const tabOffset = async () => {
        const rowBox = await row.boundingBox()
        const agentsBox = await agents.boundingBox()
        if (!rowBox || !agentsBox) throw new Error('Agent row is not laid out')
        return {
          attached:
            agentsBox.y < rowBox.y + rowBox.height && agentsBox.y > rowBox.y + rowBox.height - 6,
          left: agentsBox.x < rowBox.x + rowBox.width / 4,
        }
      }
      await expect.poll(tabOffset).toEqual({ attached: true, left: true })
      const tabMatchesOutline = () =>
        row.evaluate((element) => {
          const tab = element.querySelector('[data-demo-agents]')
          if (!tab) return false
          return getComputedStyle(element).boxShadow.includes(getComputedStyle(tab).backgroundColor)
        })
      const rowOutline = await row.evaluate((element) => getComputedStyle(element).boxShadow)
      expect(rowOutline.split(/,(?![^(]*\))/), 'one outline, no glow around the row').toHaveLength(
        1,
      )
      expect(rowOutline).toMatch(/ 1\.5px inset$|inset .* 1\.5px$/)
      await story.playLoops()
      const avatarBrightness = new Set<string>()
      for (let sample = 0; sample < 4; sample++) {
        expect(await tabMatchesOutline()).toBe(true)
        avatarBrightness.add(
          await agents
            .locator('> span > span')
            .first()
            .evaluate((avatar) => getComputedStyle(avatar).filter),
        )
        await page.waitForTimeout(350)
      }
      expect(avatarBrightness.size).toBeGreaterThan(1)
      const gapToNextRow = async () => {
        const rowBox = await agentRow.boundingBox()
        const nextBox = await frame
          .getByText('How we cut build times by 40%', { exact: true })
          .boundingBox()
        if (!rowBox || !nextBox) throw new Error('Rows are not laid out')
        return nextBox.y - (rowBox.y + rowBox.height) < 20
      }
      await expect.poll(gapToNextRow).toBe(true)
    },
  )

  const setsOff = firstMoment((now) => now.cursor !== 'resting')
  const path: Awaited<ReturnType<typeof box>>[] = []
  for (let tick = 0; tick < 15; tick += 1)
    story.at(setsOff + tick * 100, undefined, async () => {
      path.push(await box(cursor))
    })
  story.at(setsOff + 1400, 'the cursor travels a curved path and eases into the row', async () => {
    const start = path[0]
    const end = await box(cursor)
    if (!start) throw new Error('The cursor path was not sampled')
    const length = Math.hypot(end.x - start.x, end.y - start.y)
    const deviations = path.map(
      (point) =>
        Math.abs(
          (end.y - start.y) * (point.x - start.x) - (end.x - start.x) * (point.y - start.y),
        ) / length,
    )
    expect(Math.max(...deviations)).toBeGreaterThan(10)
    const distances = path.slice(1).map((point, index) => {
      const previous = path[index]
      return previous ? Math.hypot(point.x - previous.x, point.y - previous.y) : 0
    })
    expect(Math.max(...distances)).toBeGreaterThan((distances[0] ?? 0) * 2)
    expect(Math.max(...distances)).toBeGreaterThan((distances.at(-1) ?? 0) * 2)
  })

  story.at(
    momentWhen((now) => now.cursorShape === 'pointer'),
    'the cursor turns into a pointer as soon as it is over the table',
    async () => {
      await expect(cursor).toHaveAttribute('data-state', 'moving')
      await expect(cursor).toHaveAttribute('data-shape', 'pointer')
      await expect(agents).toHaveAttribute('data-expanded', 'false')
    },
  )

  story.at(
    momentWhen((now) => now.agentRowHovered),
    'the agents tab expands as soon as the cursor enters the row',
    async () => {
      await expect(cursor).toHaveAttribute('data-state', 'moving')
      await expect(agents).toHaveAttribute('data-expanded', 'true')
    },
  )

  story.at(5500 * playbackRate, 'the editor is still closed 5.5 real seconds in', async () => {
    await expect(editor).toHaveAttribute('data-state', 'hidden')
  })

  story.at(
    momentWhen((now) => now.cursor === 'hovering'),
    'the cursor hovers the row and the agents tab names them',
    async () => {
      await expect(cursor).toHaveAttribute('data-state', 'hovering')
      await expect(cursor).toHaveAttribute('data-shape', 'pointer')
      await expect(editor).toHaveAttribute('data-state', 'hidden')
      await expect(table).toHaveAttribute('data-state', 'shown')
      await expect(agents).toHaveAttribute('data-expanded', 'true')
      await expect(agents).toContainText('Air')
      await expect(agents).toContainText('Thorfinn')
      await expect(agents).not.toContainText('Canute')
      await expect(agents).toContainText('and 3 others are working')
      await expect(agents).not.toContainText('+3')
      await expect(agents.getByText('Orchestrator', { exact: true })).toHaveCount(1)
      await expect(agents.getByText('Writing Agent', { exact: true })).toHaveCount(1)
      await expect(avatars).toHaveCount(5)
      const looks = await avatars.evaluateAll((elements) =>
        elements.map((avatar) => {
          const fills = [...avatar.querySelectorAll('svg [fill]')]
            .map((shape) => shape.getAttribute('fill') ?? '')
            .filter((fill) => fill.startsWith('#') && !['#FFFFFF', '#000000'].includes(fill))
          const air = avatar.querySelector('.air-mascot')
          return {
            fills,
            air: air
              ? {
                  circle: getComputedStyle(avatar.firstElementChild ?? avatar).backgroundColor,
                  mascot: getComputedStyle(air).backgroundColor,
                }
              : null,
          }
        }),
      )
      expect(looks[0]?.air, 'Air is a white mascot on black').toEqual({
        circle: 'rgb(0, 0, 0)',
        mascot: 'rgb(255, 255, 255)',
      })
      const palettes = looks.slice(1).map((look) => new Set(look.fills))
      for (const [index, palette] of palettes.entries())
        for (const other of palettes.slice(index + 1))
          expect(
            [...palette].filter((fill) => other.has(fill)),
            'every agent has its own colours',
          ).toEqual([])
      await expect
        .poll(async () => {
          const cursorBox = await cursor.boundingBox()
          const rowBox = await row.boundingBox()
          if (!cursorBox || !rowBox) return false
          return inside(cursorBox, rowBox)
        })
        .toBe(true)
    },
  )

  story.at(
    momentWhen((now) => now.cursor === 'clicking'),
    'the cursor clicks the row',
    async () => {
      await expect(cursor).toHaveAttribute('data-state', 'clicking')
      await expect(cursor).toHaveAttribute('data-shape', 'pointer')
    },
  )

  story.at(6200 * playbackRate, 'the editor is open 6.2 real seconds in', async () => {
    await expect(editor, 'at 1x the editor would still be hidden').toHaveAttribute(
      'data-state',
      'shown',
    )
    await expect(table).toHaveAttribute('data-state', 'hidden')
  })

  await story.play()
})

test('in the editor, Thorfinn fills the categories and tags, Einar makes the cover, and Canute researches from the top bar into his panel', async ({
  page,
}) => {
  const story = await playPreview(page)
  const frame = page.getByRole('region', { name: 'Aircastle preview' }).locator('[data-demo-frame]')
  const header = frame.locator('[data-demo-header]')
  const cursor = frame.locator('[data-demo-cursor]')
  const editor = frame.locator('[data-demo-editor]')
  const table = frame.locator('[data-demo-table]')
  const categories = editor.locator('[data-demo-field="categories"] [data-demo-chip]')
  const tags = editor.locator('[data-demo-field="tags"] [data-demo-chip]')
  const presence = (field: string) =>
    editor.locator(`[data-demo-field="${field}"] [data-demo-agent-outline]`)
  const expectWorkingOn = async (field: string | undefined) => {
    for (const candidate of ['categories', 'tags', 'body'])
      await expect(presence(candidate)).toHaveAttribute('data-active', String(candidate === field))
  }
  const coverField = frame.locator('[data-demo-field="cover-image"]')
  const coverTab = coverField.locator('[data-demo-agent-tab]')
  const cover = coverField.locator('[data-demo-cover]')
  const coverStatus = coverField.locator('[data-demo-cover-status]')
  const research = editor.locator('[data-demo-research]')
  const current = research.locator('[data-demo-source][data-state="current"]')
  const sourceUrl = current.locator('[data-demo-source-url]')
  const panel = editor.locator('[data-demo-research-panel]')
  const reading = (count: number) =>
    momentWhen((now) => now.view === 'editor' && sourcesReadBy(now.researchSteps) === count)
  let firstWidth: number | undefined

  story.at(
    momentWhen((now) => now.view === 'editor'),
    'the post editor opens with agents outlining their fields',
    async () => {
      await expect(editor).toHaveAttribute('data-state', 'shown')
      await expect(table).toHaveAttribute('data-state', 'hidden')
      await expect(editor).toContainText('Introducing Acme MCP')
      const outlines = await editor.locator('[data-demo-agent-outline]').count()
      expect(outlines, 'agents outline the fields they work on').toBeGreaterThan(0)
      await expect(editor.locator('[data-demo-field] [data-demo-agent-outline]')).toHaveCount(
        outlines,
      )
      await expect(editor.locator('[data-demo-post-status]')).toHaveText('Draft')
      const preview = editor.locator('[data-demo-preview]')
      const publish = editor.locator('[data-demo-publish]')
      await expect(preview).toContainText('Preview')
      await expect(preview.locator('svg')).toHaveCount(1)
      await expect(editor.locator('[data-demo-save]')).toHaveCount(0)
      await expect(editor.getByText('Save', { exact: true })).toHaveCount(0)
      await expect(preview).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(preview).toHaveCSS('border-top-width', '1px')
      const previewBox = await box(preview)
      const publishBox = await box(publish)
      expect(previewBox.x + previewBox.width).toBeLessThanOrEqual(publishBox.x)
      const external = editor.locator('[data-demo-preview-external]')
      await expect(external.locator('svg.lucide-external-link')).toHaveCount(1)
      await expect(preview).toHaveCSS('border-top-right-radius', '0px')
      await expect(external).toHaveCSS('border-top-left-radius', '0px')
      await expect(external).toHaveCSS('border-left-width', '0px')
      const externalBox = await box(external)
      expect(Math.abs(externalBox.x - (previewBox.x + previewBox.width))).toBeLessThanOrEqual(1)
      expect(externalBox.height).toBeCloseTo(previewBox.height, 1)
      expect(externalBox.width).toBeCloseTo(externalBox.height, 1)
      expect(externalBox.x + externalBox.width).toBeLessThanOrEqual(publishBox.x)
      for (const field of ['title', 'slug'])
        await expect(editor.locator(`[data-demo-field="${field}"]`)).toHaveAttribute(
          'data-empty',
          'false',
        )
      for (const field of [
        'summary',
        'body',
        'meta-title',
        'meta-description',
        'focus-keyword',
        'canonical-url',
        'social-image',
        'categories',
        'tags',
        'cover-image',
        'publish-date',
        'reading-time',
      ])
        await expect(editor.locator(`[data-demo-field="${field}"]`)).toHaveAttribute(
          'data-empty',
          'true',
        )
      for (const field of ['categories', 'tags']) {
        const multiselect = editor.locator(`[data-demo-field="${field}"] [data-demo-multiselect]`)
        await expect(multiselect).toHaveAttribute('data-agent', 'Thorfinn')
        const fieldOutline = presence(field)
        await expect(fieldOutline).toHaveCSS('box-shadow', /inset/)
        await expect(fieldOutline, 'a thin outline').toHaveCSS('box-shadow', / 1\.5px( inset)?$/)
        await expect(fieldOutline).toHaveAttribute('data-active', String(field === 'categories'))
        const tab = editor.locator(`[data-demo-field="${field}"] [data-demo-agent-tab]`)
        await expect(tab).toContainText('Thorfinn')
        await expect(tab).toContainText('Writing Agent')
        await expect(tab).not.toContainText('Writer')
        if (field !== 'categories') continue
        const boxRect = await box(multiselect)
        const tabRect = await box(tab)
        expect(tabRect.y + tabRect.height).toBeGreaterThan(boxRect.y - 1)
        expect(tabRect.y + tabRect.height).toBeLessThan(boxRect.y + 6)
        expect(boxRect.x + boxRect.width - (tabRect.x + tabRect.width)).toBeLessThan(
          boxRect.width / 4,
        )
      }
      await expect(
        editor.locator('[data-demo-field="authors"] [data-demo-multiselect]'),
      ).toContainText('Abyan')
      await expect(categories).toHaveCount(0)
      await expect(tags).toHaveCount(0)
      await expectWorkingOn('categories')
      await expect(header.locator('[data-demo-ask-agent]')).toHaveCount(0)
      await expect(header.locator('[data-demo-ask-count]')).toHaveCount(0)
      await expect(header.locator('[data-demo-ask-menu]')).toHaveAttribute('data-state', 'closed')
    },
  )

  story.at(
    momentWhen((now) => now.view === 'editor'),
    'Einar starts the cover with the product cover skill',
    async () => {
      await expect(coverTab).toHaveAttribute('data-active', 'true')
      await expect(coverTab).toContainText('Einar')
      await expect(coverTab.getByText('Design Agent', { exact: true })).toBeVisible()
      const writerTab = frame.locator('[data-demo-field="categories"] [data-demo-agent-tab]')
      await expect(writerTab).toHaveAttribute('data-active', 'true')
      const hue = (element: Element) =>
        getComputedStyle(element).getPropertyValue('--agent-base').trim()
      const einarHue = await coverTab.evaluate(hue)
      expect(einarHue).not.toBe('')
      expect(einarHue).not.toBe(await writerTab.evaluate(hue))
      expect(await coverField.locator('[data-demo-agent-outline]').evaluate(hue)).toBe(einarHue)
      await expect(coverStatus).toHaveAttribute('data-active', 'true')
      await expect(coverStatus).toHaveText('Using/create-default-product-cover')
      await expect(coverStatus.locator('code')).toHaveText('/create-default-product-cover')
      const fits = await coverField.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        return [
          ...element.querySelectorAll('[data-demo-agent-tab], [data-demo-cover-status]'),
        ].every((child) => {
          const childBox = child.getBoundingClientRect()
          return childBox.left >= bounds.left && childBox.right <= bounds.right
        })
      })
      expect(fits).toBe(true)
      await expect(cover).toHaveCount(0)
    },
  )

  story.at(reading(1), 'the top bar shows the first source Canute reads', async () => {
    await expect(research).toContainText('Canute')
    await expect(research).toContainText('reading')
    await expect(research.getByText('Research Agent', { exact: true })).toBeVisible()
    const muted = await editor
      .locator('[data-demo-field="title"] span')
      .first()
      .evaluate((element) => getComputedStyle(element).color)
    await expect(research.getByText('Research Agent', { exact: true })).toHaveCSS('color', muted)
    await expect(research).not.toContainText(/\d+ sources?/)
    await expect(sourceUrl).toHaveText('modelcontextprotocol.io/specification')
    await expect(sourceUrl).not.toContainText('https://')
    await expect(sourceUrl).toHaveCSS('text-overflow', 'ellipsis')
    await expect(current.locator('[data-demo-source-logo]')).toHaveCount(1)
    await expect(
      current.locator('[data-demo-source-logo] svg, svg[data-demo-source-logo]'),
    ).toHaveCount(1)
    firstWidth = (await box(research)).width
  })

  story.at(reading(2), 'the next source replaces it', async () => {
    await expect(sourceUrl).toHaveText('github.com/acme/app/pulls?q=mcp+is:merged')
  })

  story.at(
    momentWhen((now) => now.categories === 1),
    'the first category arrives',
    async () => {
      await expect(categories).toHaveCount(1)
      await expect(categories.first()).toContainText('Product')
      expect(
        await categories.first().evaluate((chip) => getComputedStyle(chip).animationName),
      ).toContain('agent-arrive')
      await expect(cover).toHaveAttribute('data-state', 'generating')
      await expect(coverTab).toHaveAttribute('data-active', 'true')
    },
  )

  story.at(
    momentWhen((now) => now.categories === 2),
    'the second category arrives',
    async () => {
      await expect(categories).toHaveCount(2)
      await expect(categories.last()).toContainText('Announcements')
      await expect(tags).toHaveCount(0)
      await expectWorkingOn('categories')
    },
  )

  story.at(reading(3), 'a third source', async () => {
    await expect(sourceUrl).toHaveText('github.com/acme/app/pull/482')
  })

  story.at(reading(4), 'a fourth source, at the same width and left of Preview', async () => {
    await expect(sourceUrl).toHaveText('linear.app/acme/issue/ACM-1290')
    expect((await box(research)).width).toBe(firstWidth)
    const researchBox = await box(research)
    const previewBox = await box(editor.locator('[data-demo-preview]'))
    expect(researchBox.x + researchBox.width).toBeLessThanOrEqual(previewBox.x)
  })

  story.at(
    momentWhen((now) => now.writerOnTags),
    'Thorfinn moves to the tags',
    async () => {
      await expectWorkingOn('tags')
      await expect(tags).toHaveCount(0)
    },
  )

  story.at(
    momentWhen((now) => now.cursorTarget === 'research'),
    'the cursor heads for the top bar',
    async () => {
      await expect(panel).toHaveAttribute('data-state', 'closed')
      await expect(research).toHaveAttribute('data-hovered', 'false')
      await expect(cursor).toHaveAttribute('data-state', 'moving')
    },
  )

  story.at(
    momentWhen((now) => now.tags === 1),
    'the first tag arrives',
    async () => {
      await expect(tags).toHaveCount(1)
      await expect(tags.first()).toContainText('MCP')
    },
  )

  story.at(reading(5), 'a fifth source', async () => {
    await expect(sourceUrl).toHaveText('docs.acme.com/search?q=mcp')
  })

  story.at(
    momentWhen((now) => now.cursorTarget === 'research' && now.cursor === 'hovering'),
    'the cursor hovers the top bar',
    async () => {
      await expect(cursor).toHaveAttribute('data-state', 'hovering')
      await expect(cursor).toHaveAttribute('data-shape', 'pointer')
      await expect(research).toHaveAttribute('data-hovered', 'true')
    },
  )

  const panelOpens = momentWhen((now) => now.researchPanelOpen)
  story.at(panelOpens, 'all three tags are in as the panel opens', async () => {
    await expect(tags).toHaveCount(3)
    await expect(tags.last()).toContainText('Integrations')
    await expect(editor.locator('[data-demo-field="tags"]')).toHaveAttribute('data-empty', 'false')
    await expect(panel).toHaveAttribute('data-state', 'open')
  })

  let stepsNow = 0
  story.at(
    momentWhen((now) => docsDecisionState(now.researchSteps) === 'asking'),
    'Canute’s panel docks beside the editor and asks a decision',
    async () => {
      await expect(panel).toHaveAttribute('data-state', 'open')
      await expect(panel).toContainText('Canute')
      await expect(panel.locator('[data-demo-agent-label]')).toHaveText('Research Agent')
      const switcher = panel.locator('[data-demo-panel-header] [data-demo-agent-switcher]')
      await expect(switcher).toContainText('Canute')
      await expect(switcher.locator('svg.lucide-chevron-down')).toHaveCount(1)
      const panelHeader = panel.locator('[data-demo-panel-header]')
      await expect(panelHeader.locator('svg.lucide-ellipsis-vertical')).toHaveCount(1)
      await expect(panelHeader.locator('svg.lucide-x')).toHaveCount(0)
      const headerAvatar = switcher.locator('[data-demo-panel-avatar]')
      await expect(headerAvatar).toHaveCSS('filter', 'none')
      await expect(headerAvatar).toHaveCSS('scale', 'none')
      const gap = await switcher.evaluate((element) => {
        const label = element.querySelector('[data-demo-agent-label]')?.getBoundingClientRect()
        const chevron = element.querySelector('svg.lucide-chevron-down')?.getBoundingClientRect()
        return label && chevron ? chevron.left - label.right : -1
      })
      expect(gap).toBeGreaterThanOrEqual(0)
      await expect(panel.locator('[data-demo-thought]').first()).toBeVisible()
      await expect(panel.locator('[data-demo-thought]').first()).toHaveCSS(
        '-webkit-line-clamp',
        '2',
      )
      await expect(panel).toContainText('No MCP page')
      const request = panel.locator('[data-demo-research-request]')
      await expect(request).toHaveAttribute('data-align', 'end')
      await expect(request).not.toHaveText(prompt)
      await expect(request).toContainText('so Thorfinn can write the announcement post')
      const briefMention = request.locator('[data-demo-mention]')
      await expect(briefMention).toHaveText('Thorfinn')
      await expect(briefMention.locator('svg')).toHaveCount(1)
      await expect(request.locator('li')).toHaveCount(3)
      await expect(request).toContainText('mark anything you couldn’t confirm')
      const goalColour = await request
        .locator('p')
        .first()
        .evaluate((element) => getComputedStyle(element).color)
      await expect(request.locator('p').last()).toHaveCSS('color', goalColour)
      await expect(request).not.toContainText(/PR #|#482/)
      const sender = panel.locator('[data-demo-research-sender]')
      await expect(sender).toContainText('Air')
      await expect(sender).toContainText('Orchestrator')
      await expect(sender.locator('.air-mascot')).toHaveCount(1)
      const trigger = panel.locator(
        '[data-demo-research-chain] [data-slot="trace-collapsible-trigger"]',
      )
      await expect(trigger).toContainText('Researching')
      await expect(trigger).toHaveAttribute('aria-expanded', 'true')
      const prompter = panel.locator('[data-demo-research-prompt]')
      await expect(prompter).toHaveAttribute('data-slot', 'input-group')
      await expect(prompter.locator('textarea')).toHaveAttribute(
        'placeholder',
        'Ask anything, @tag documents, or / for commands',
      )
      const pending = panel.locator('[data-demo-research-pending]')
      await expect(pending).toHaveText(/Thinking…|Reading|Searching/)
      await expect(pending).toHaveAttribute('data-status', 'running')
      await expect(panel.locator('[data-demo-research-step]').first()).toHaveAttribute(
        'data-slot',
        'trace-line',
      )
      await expect(panel.locator('[data-demo-research-reply]')).toHaveCount(0)
      const marker = panel.locator('[data-demo-research-chain] [data-demo-decision-marker]')
      await expect(marker).toContainText('Asked you: draft a docs page for MCP?')
      await expect(marker).toContainText('Waiting')
      const decision = panel.locator('[data-demo-decision]')
      await expect(decision).toContainText('Draft a docs page for MCP?')
      await expect(decision).toContainText('Connect to Acme MCP')
      await expect(decision).not.toContainText('If not')
      const indent = await decision.evaluate((element) => {
        const left = (selector: string) =>
          element.querySelector(selector)?.getBoundingClientRect().left ?? Number.NaN
        return left('[data-demo-decision-target]') - left('[data-demo-decision-question]')
      })
      expect(Math.abs(indent)).toBeLessThanOrEqual(0.5)
      const replies = decision.locator('[data-demo-decision-option]')
      await expect(replies).toHaveCount(3)
      await expect(replies.nth(0)).toContainText('Yes, draft it')
      await expect(replies.nth(1)).toContainText('Not yet')
      await expect(replies.nth(2)).toContainText('Something else…')
      await expect(decision).not.toContainText('Draft it')
      const replyLayout = await replies.evaluateAll((elements) =>
        elements.map((element) => {
          const replyBox = element.getBoundingClientRect()
          return {
            top: Math.round(replyBox.top),
            left: Math.round(replyBox.left),
            width: Math.round(replyBox.width),
            background: getComputedStyle(element).backgroundColor,
          }
        }),
      )
      expect(replyLayout.map(({ top }) => top)).toEqual(
        replyLayout.map(({ top }) => top).sort((first, second) => first - second),
      )
      expect(new Set(replyLayout.map(({ top }) => top)).size).toBe(3)
      expect(new Set(replyLayout.map(({ left }) => left)).size).toBe(1)
      expect(new Set(replyLayout.map(({ width }) => width)).size).toBe(1)
      const primary = await page.evaluate(() => {
        const probe = document.createElement('span')
        probe.className = 'bg-primary'
        document.body.append(probe)
        const colour = getComputedStyle(probe).backgroundColor
        probe.remove()
        return colour
      })
      expect(replyLayout.every(({ background }) => background !== primary)).toBe(true)
      await expect(panel.locator('[data-demo-research-chain] [data-demo-decision]')).toHaveCount(0)
      expect(
        await decision.evaluate((element) => {
          const promptBox = element.parentElement?.querySelector('[data-demo-research-prompt]')
          return promptBox
            ? element.getBoundingClientRect().bottom <= promptBox.getBoundingClientRect().top
            : false
        }),
      ).toBe(true)
      const tagsBox = await box(editor.locator('[data-demo-field="tags"]'))
      const panelBox = await box(panel)
      expect(tagsBox.x + tagsBox.width).toBeLessThanOrEqual(panelBox.x + 1)
      const editorBox = await box(editor)
      expect(Math.abs(panelBox.y - editorBox.y)).toBeLessThanOrEqual(1)
      const publish = editor.locator('[data-demo-publish]')
      await expect
        .poll(async () => {
          const publishBox = await publish.boundingBox()
          return publishBox ? publishBox.x + publishBox.width : Infinity
        })
        .toBeLessThanOrEqual(panelBox.x)
      await expect(research).toHaveAttribute('data-state', 'docked')
      const topBarBox = await box(editor.locator('[data-demo-top-bar]'))
      const panelHeaderBox = await box(panelHeader)
      expect(
        Math.abs(topBarBox.y + topBarBox.height - (panelHeaderBox.y + panelHeaderBox.height)),
      ).toBeLessThanOrEqual(0.5)
      await expect(research).toBeHidden()
      const breadcrumb = editor.locator('[data-demo-breadcrumb]')
      await expect(breadcrumb).toHaveCSS('white-space', 'nowrap')
      const crumbBox = await box(breadcrumb)
      const crumbLine = await breadcrumb.evaluate((element) =>
        parseFloat(getComputedStyle(element).lineHeight),
      )
      expect(crumbBox.height).toBeLessThanOrEqual(crumbLine + 1)
      stepsNow = await panel.locator('[data-demo-research-step]').count()
    },
  )

  story.at(
    momentWhen((now) => now.cover === 'done'),
    'Einar finishes the cover',
    async () => {
      await expect(cover).toHaveAttribute('data-state', 'done')
      await expect(coverTab).toHaveAttribute('data-active', 'false')
      await expect(coverStatus).toHaveAttribute('data-active', 'false')
      await expect(cover.locator('[data-demo-cover-title]')).toHaveText('Introducing Acme MCP')
      await expect(cover.locator('[data-demo-cover-date]')).toHaveText('Nov 5, 2026')
      await expect(cover).not.toContainText('Connect Acme')
      const order = await cover.evaluate((element) =>
        ['[data-demo-cover-acme]', '[data-demo-cover-slash]', '[data-demo-cover-mcp]'].map(
          (selector) => element.querySelector(selector)?.getBoundingClientRect().left ?? -1,
        ),
      )
      expect(order.every((left) => left >= 0)).toBe(true)
      expect(order).toEqual([...order].sort((first, second) => first - second))
      await expect(coverField).toHaveAttribute('data-empty', 'false')
    },
  )

  const leavesTags = momentWhen(
    (now) => !now.writerOnTags && !now.writerOnCategories,
    momentWhen((now) => now.writerOnTags),
  )
  story.at(leavesTags, 'Thorfinn leaves the tags', async () => {
    await expectWorkingOn(undefined)
  })

  story.at(
    momentWhen((now) => now.writerOnBody),
    'Thorfinn waits on Canute in the body',
    async () => {
      await expectWorkingOn('body')
      const bodyTab = editor.locator('[data-demo-field="body"] [data-demo-agent-tab]')
      await expect(bodyTab).toHaveAttribute('data-active', 'true')
      await expect(bodyTab).toContainText('Thorfinn')
      await expect(bodyTab).toContainText('Writing Agent')
      await expect(bodyTab).toContainText('Waiting on Canute…')
      await expect(editor.locator('[data-demo-field="categories"]')).toHaveAttribute(
        'data-empty',
        'false',
      )
    },
  )

  story.at(panelOpens + 1500, 'Canute’s log keeps growing', async () => {
    expect(await panel.locator('[data-demo-research-step]').count()).toBeGreaterThan(stepsNow)
    await expect(panel.locator('[data-demo-research-pending]')).toHaveText(
      /Thinking…|Reading|Searching|Synthesising/,
    )
  })

  await story.play()
})

test('Canute’s decision goes to Air, Thorfinn writes the body in one fixed height, and the editor scrolls to SEO as the cursor travels', async ({
  page,
}) => {
  const story = await playPreview(page)
  const frame = page.getByRole('region', { name: 'Aircastle preview' }).locator('[data-demo-frame]')
  const cursor = frame.locator('[data-demo-cursor]')
  const editor = frame.locator('[data-demo-editor]')
  const panel = frame.locator('[data-demo-research-panel]')
  const decision = panel.locator('[data-demo-decision]')
  const marker = panel.locator('[data-demo-decision-marker]')
  const chain = panel.locator('[data-demo-research-chain]')
  const waiting = frame.locator('[data-demo-ask-count]')
  const body = frame.locator('[data-demo-field="body"]')
  const bodyTab = body.locator('[data-demo-agent-tab]')
  const draft = body.locator('[data-demo-body-draft]')
  const readingTime = frame.locator('[data-demo-field="reading-time"]')
  const seo = frame.locator('[data-demo-field="seo"]')
  const metaTitle = seo.locator('[data-demo-field="meta-title"]')
  const seoTab = metaTitle.locator('[data-demo-agent-tab]')
  const social = seo.locator('[data-demo-field="social-image"]')
  let emptyHeight = 0
  let beforeScroll = { x: 0, y: 0, width: 0, height: 0 }
  let cursorBeforeOverlap = { x: 0, y: 0, width: 0, height: 0 }
  const heights: number[] = []
  const counts: number[] = []

  story.at(
    momentWhen((now) => now.view === 'editor' && docsDecisionState(now.researchSteps) === 'asking'),
    'Canute asks a decision and the header counts it as waiting',
    async () => {
      await expect(decision).toHaveAttribute('data-state', 'asking')
      await expect(waiting).toHaveText('1')
      const destructive = await page.evaluate(() => {
        const probe = document.createElement('span')
        probe.className = 'bg-destructive'
        document.querySelector('[data-demo-header]')?.append(probe)
        const colour = getComputedStyle(probe).backgroundColor
        probe.remove()
        return colour
      })
      await expect(waiting).toHaveCSS('background-color', destructive)
    },
  )

  story.at(
    momentWhen((now) => now.writerOnBody) + 300,
    'Thorfinn waits on Canute with an empty body',
    async () => {
      await expect(bodyTab).toContainText('Waiting on Canute…')
      await expect(draft).toHaveCount(0)
      await expect(readingTime).toHaveAttribute('data-empty', 'true')
      emptyHeight = await body.evaluate((element) => element.clientHeight)
      const menu = frame.locator('[data-demo-ask-menu]')
      await expect(menu).toHaveAttribute('data-state', 'closed')
      const options = menu.locator('[data-demo-ask-option]')
      const optionMascot = options.first().locator('.air-mascot')
      await expect(optionMascot).toHaveCount(1)
      await expect(optionMascot).not.toHaveClass(/rounded-full/)
      const avatarBox = await options.nth(1).locator('svg').first().boundingBox()
      const mascotBox = await optionMascot.boundingBox()
      expect(mascotBox?.width).toBe(avatarBox?.width)
      await expect(options).toHaveCount(6)
      const expected = [
        ['Ask Air', 'Orchestrator'],
        ['Ask Thorfinn', 'Writing Agent'],
        ['Ask Canute', 'Research Agent'],
        ['Ask Askeladd', 'SEO Agent'],
        ['Ask Thorkell', 'Review Agent'],
        ['Ask Einar', 'Design Agent'],
      ] as const
      for (const [index, [name, role]] of expected.entries()) {
        await expect(options.nth(index).locator('[data-demo-ask-name]')).toHaveText(name)
        await expect(options.nth(index).locator('[data-demo-ask-role]')).toHaveText(role)
      }
    },
  )

  story.at(
    momentWhen((now) => now.cursorTarget === 'decision' && now.cursor === 'hovering'),
    'the cursor hovers the decision while it is still asking',
    async () => {
      await expect(cursor).toHaveAttribute('data-target', 'decision')
      await expect(cursor).toHaveAttribute('data-state', 'hovering')
      await expect(cursor).toHaveAttribute('data-shape', 'pointer')
      await expect(decision).toHaveAttribute('data-state', 'asking')
    },
  )

  const sent = momentWhen(
    (now) => now.view === 'editor' && docsDecisionState(now.researchSteps) === 'sent',
  )
  story.at(sent, 'the answer is sent to Air and Canute hands it off', async () => {
    await expect(decision).toHaveAttribute('data-state', 'sent')
    await expect(decision).toContainText('Sent to Air')
    await expect(decision).toContainText('Connect to Acme MCP')
    await expect(decision.locator('[data-demo-decision-option]')).toHaveCount(0)
    await expect(decision.locator('[data-demo-mention] .air-mascot')).toHaveCount(1)
    await expect(marker).toContainText('You: Yes, draft it')
    await expect(marker).not.toContainText('Waiting')
    const handoff = chain.locator('[data-demo-handoff]')
    await expect(handoff).toContainText('Handed off to')
    await expect(handoff).toContainText('Air')
    await expect(handoff.locator('[data-demo-mention]')).toHaveText('Air')
    await expect(handoff.locator('[data-demo-mention] .air-mascot')).toHaveCount(1)
    await expect(decision.locator('[data-demo-mention]')).toHaveText('Air')
    await expect(waiting).toHaveCount(0)
    await expect(editor).toHaveAttribute('data-scrolled', 'false')
  })

  const researched = momentWhen((now) => now.bodyElapsed !== null)
  story.at(researched, undefined, async () => {
    await expect(editor).toHaveAttribute('data-scrolled', 'false')
    beforeScroll = await box(seo)
  })

  const writing = researched + 100
  story.at(writing, 'Thorfinn starts writing the body', async () => {
    await expect(bodyTab).toContainText('Writing…')
    await expect(draft).toHaveCount(1)
  })
  for (let at = writing; at < writing + 3000; at += 200)
    story.at(at, undefined, async () => {
      const sample = await body.evaluate((element) => ({
        height: element.clientHeight,
        words: element.querySelectorAll('[data-demo-body-draft] [data-demo-draft-word]').length,
      }))
      heights.push(sample.height)
      counts.push(sample.words)
    })
  story.at(writing + 3000, 'the body draft grows inside one fixed height', async () => {
    expect(new Set(heights)).toEqual(new Set([emptyHeight]))
    expect(new Set(counts).size).toBeGreaterThan(10)
    await expect(bodyTab).toHaveAttribute('data-active', 'true')
    await expect(readingTime).toHaveAttribute('data-empty', 'true')
  })

  const scrolls = momentWhen((now) => now.editorScroll > 0)
  story.at(scrolls, 'the editor scrolls while the cursor travels to it', async () => {
    await expect(editor).toHaveAttribute('data-scrolled', 'true')
    await expect(cursor).toHaveAttribute('data-target', 'editor')
    await expect(cursor).toHaveAttribute('data-state', 'moving')
    await expect(cursor).toHaveAttribute('data-shape', 'arrow')
    expect(await body.locator('[data-demo-draft-word]').count()).toBeGreaterThan(0)
    await expect(panel).toContainText('Researched 12 sources')
    cursorBeforeOverlap = await box(cursor)
  })
  story.at(scrolls + 250, 'SEO comes into view with Askeladd and Einar on its fields', async () => {
    const duringScroll = await box(seo)
    const cursorDuringOverlap = await box(cursor)
    expect(duringScroll.y).toBeLessThan(beforeScroll.y - 5)
    expect(cursorDuringOverlap.x).toBeLessThan(cursorBeforeOverlap.x - 10)
    await expect(cursor).toHaveAttribute('data-state', 'moving')
    await expect(seo.locator(':scope > [data-demo-agent-outline]')).toHaveCount(0)
    await expect(seoTab).toHaveAttribute('data-active', 'true')
    await expect(social.locator('[data-demo-agent-tab]')).toHaveAttribute('data-active', 'true')
    await expect(social.locator('[data-demo-agent-tab]')).toContainText('Einar')
    await expect(decision).toBeHidden()
  })
  story.at(
    momentWhen((now) => now.cursorTarget === 'editor') + 1500,
    'the cursor waits just left of the panel',
    async () => {
      await expect(cursor).toHaveAttribute('data-target', 'editor')
      const restBox = await box(cursor)
      const panelBox = await box(panel)
      expect(restBox.x).toBeLessThan(panelBox.x)
      expect(restBox.x).toBeGreaterThan(panelBox.x - 120)
    },
  )

  const bodyDone = momentWhen((now) => now.bodyElapsed !== null && !now.writerOnBody)
  story.at(bodyDone, 'Thorfinn leaves the finished body', async () => {
    await expect(bodyTab).toHaveAttribute('data-active', 'false')
    await expect(readingTime).toHaveAttribute('data-empty', 'false')
    await expect(readingTime).toContainText(/^Reading time\s*2 min read/)
    expect(await body.evaluate((element) => element.clientHeight)).toBe(emptyHeight)
    await expect(body).toHaveAttribute('data-empty', 'false')
    await expect(draft.locator('h2').first()).toBeVisible()
    await expect(draft.locator('h2')).toHaveCount(4)
    await expect(draft.locator('li')).toHaveCount(7)
    await expect(draft.locator('pre')).toContainText('https://mcp.acme.com')
    await expect(draft).not.toContainText(/[‘’“”—]/)
    const draftWords = draft.locator('[data-demo-draft-word]')
    expect(await draftWords.count()).toBeGreaterThan(250)
    await expect(draftWords.last()).toHaveCSS('opacity', '1')
    await page.waitForTimeout(300)
    const layout = await body.locator('[data-demo-body-viewport]').evaluate((element) => {
      const viewport = element.getBoundingClientRect()
      const first = element.querySelector('[data-demo-draft-word]')?.getBoundingClientRect()
      const all = element.querySelectorAll('[data-demo-draft-word]')
      const end = all[all.length - 1]?.getBoundingClientRect()
      return {
        topStays: first ? first.top >= viewport.top && first.top < viewport.top + 40 : false,
        restClipped: end ? end.top > viewport.bottom : false,
        clipped: getComputedStyle(element).overflow === 'hidden',
      }
    })
    expect(layout).toEqual({ topStays: true, restClipped: true, clipped: true })
  })

  await story.play()
})

test('SEO streams into each field while the cursor heads for Preview, and the live post loads with the editor’s cover', async ({
  page,
}) => {
  const story = await playPreview(page)
  const frame = page.getByRole('region', { name: 'Aircastle preview' }).locator('[data-demo-frame]')
  const cursor = frame.locator('[data-demo-cursor]')
  const editor = frame.locator('[data-demo-editor]')
  const panel = frame.locator('[data-demo-research-panel]')
  const marker = panel.locator('[data-demo-decision-marker]')
  const chain = panel.locator('[data-demo-research-chain]')
  const body = frame.locator('[data-demo-field="body"]')
  const bodyTab = body.locator('[data-demo-agent-tab]')
  const seo = frame.locator('[data-demo-field="seo"]')
  const metaTitle = seo.locator('[data-demo-field="meta-title"]')
  const seoTab = metaTitle.locator('[data-demo-agent-tab]')
  const social = seo.locator('[data-demo-field="social-image"]')
  const authors = frame.locator('[data-demo-field="authors"]')
  const preview = frame.locator('[data-demo-preview]')
  const site = editor.locator('[data-demo-site-preview]')
  const sitePage = site.locator('[data-demo-site-page]')
  const words = sitePage.locator('[data-demo-draft-word]')
  let settledAuthors: Awaited<ReturnType<typeof box>> | undefined
  let siteWords = 0
  const partial = new Set<string>()

  story.at(siteOpensAt + 470, 'Canute has finished with a research brief for Air', async () => {
    await expect(panel.locator('[data-demo-research-step]')).toHaveCount(12)
    const reply = panel.locator('[data-demo-research-reply]')
    const replyWords = reply.locator('[data-demo-reply-word]')
    expect(await replyWords.count()).toBeGreaterThan(10)
    const delays = await replyWords.evaluateAll((elements) =>
      elements.map((element) => parseFloat(getComputedStyle(element).animationDelay)),
    )
    expect(delays).toEqual([...delays].sort((left, right) => left - right))
    expect(new Set(delays).size).toBe(delays.length)
    const lastWordDelay = delays.at(-1) ?? 0
    const firstCardDelay = await reply
      .locator('[data-demo-artifact]')
      .first()
      .evaluate((element) => parseFloat(getComputedStyle(element).animationDelay))
    expect(firstCardDelay).toBeGreaterThan(lastWordDelay)
    expect(lastWordDelay).toBeLessThan(1.5)
    await expect(replyWords.last()).toHaveCSS('opacity', '1')
    await expect(reply.locator('.shimmer')).toHaveCount(0)
    const artifacts = panel.locator('[data-demo-artifact]')
    await expect(artifacts).toHaveCount(1)
    await expect(artifacts.first()).toContainText('Research brief.md')
    const artifactIcon = artifacts.first().locator('[data-demo-artifact-icon]')
    await expect(artifactIcon.locator('title')).toHaveText('Markdown')
    const summaryColour = await artifacts
      .first()
      .locator('[data-demo-artifact-summary]')
      .evaluate((element) => getComputedStyle(element).color)
    await expect(artifactIcon).toHaveCSS('color', summaryColour)
    await expect(panel).not.toContainText('Docs gap')
    await expect(panel).not.toContainText('drafted an outline')
    await expect(panel.locator('[data-demo-research-pending]')).toHaveCount(0)
    await expect(panel).not.toContainText('Research complete')
    await expect(panel).not.toContainText('Researching')
    const trigger = chain.locator('[data-slot="trace-collapsible-trigger"]')
    await expect(trigger).toContainText('Researched 12 sources')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(panel.locator('[data-demo-research-request]')).toBeInViewport()
    await expect(marker).toBeAttached()
    await expect(reply).toContainText('handed a docs page to Air')
    const mention = reply.locator('[data-demo-mention]')
    await expect(mention).toHaveText('Air')
    await expect(mention.locator('.air-mascot')).toHaveCount(1)
    await expect(mention).toHaveCSS('border-top-width', '1px')
    await expect(reply).toContainText('Research brief.md')
    const mutedColour = await chain
      .locator('[data-slot="trace-line"]')
      .first()
      .evaluate((element) => getComputedStyle(element).color)
    await expect(panel.locator('[data-demo-agent-label]')).toHaveCSS('color', mutedColour)
    const research = editor.locator('[data-demo-research]')
    await expect(research).toHaveAttribute('data-state', 'done')
    await expect(research).toBeHidden()
    await expect(preview).toBeVisible()
  })

  const seoFields = [
    ['meta-title', 'Introducing Acme MCP: connect Acme to your AI tools'],
    [
      'meta-description',
      'Acme MCP lets Claude, Cursor and other AI tools read and update your Acme workspace. Set it up in a few minutes.',
    ],
    ['focus-keyword', 'Acme MCP'],
  ] as const
  const seoStarts = firstMoment((now) => now.seoElapsed !== null && now.seoElapsed >= 0)
  for (const [index, typing] of [350, 1850, 3175].entries())
    story.at(
      seoStarts + typing,
      `SEO field ${index + 1} is typing with its tab active`,
      async () => {
        const fields = await seo.evaluate((element) =>
          [...element.querySelectorAll('[data-demo-field]')].map((field) => ({
            name: field.getAttribute('data-demo-field') ?? '',
            value: field.querySelector('[data-demo-seo-value]')?.textContent ?? null,
            active: field.querySelector('[data-demo-agent-tab]')?.getAttribute('data-active'),
          })),
        )
        for (const [name, complete] of seoFields) {
          const field = fields.find((candidate) => candidate.name === name)
          const value = field?.value
          if (value && complete.startsWith(value) && value !== complete) {
            partial.add(name)
            expect(field.active, `${name} is typed by an active agent`).toBe('true')
          }
        }
      },
    )

  story.at(
    momentWhen((now) => now.cursorTarget === 'preview'),
    'the cursor heads for Preview once the social image and the body are done',
    async () => {
      await expect(cursor).toHaveAttribute('data-target', 'preview')
      await expect(cursor).toHaveAttribute('data-state', 'moving')
      await expect(social).toHaveAttribute('data-empty', 'false')
      await expect(bodyTab).toHaveAttribute('data-active', 'false')
      await expect(seo.locator('[data-demo-agent-tab][data-active="true"]')).toHaveCount(1)
      await page.waitForTimeout(1600)
      settledAuthors = await box(authors)
    },
  )

  story.at(
    momentWhen((now) => now.cursorTarget === 'preview' && now.cursor === 'hovering'),
    'the cursor hovers Preview',
    async () => {
      await expect(cursor).toHaveAttribute('data-state', 'hovering')
      await expect(cursor).toHaveAttribute('data-shape', 'pointer')
      const cursorBox = await box(cursor)
      expect(inside(cursorBox, await box(preview))).toBe(true)
    },
  )

  story.at(
    momentWhen((now) => now.cursorTarget === 'preview' && now.cursor === 'clicking'),
    'the cursor clicks Preview without the editor shifting',
    async () => {
      await expect(cursor).toHaveAttribute('data-state', 'clicking')
      await expect(editor).toHaveAttribute('data-state', 'shown')
      expect(await box(authors)).toEqual(settledAuthors)
      await expect(site).toHaveCount(0)
      await expect(preview).toContainText('Preview')
    },
  )

  story.at(
    momentWhen((now) => now.previewElapsed !== null),
    'the address bar loads first',
    async () => {
      await expect(site.locator('[data-demo-site-address]')).toHaveText(
        'acme.com/blog/introducing-acme-mcp',
      )
      await expect(site).not.toContainText('Draft')
      await expect(sitePage).toHaveAttribute('data-state', 'loading')
      await expect(sitePage).not.toContainText('Introducing Acme MCP')
      await expect(preview).toHaveText('Close Preview')
      await expect(preview.locator('svg.lucide-x')).toHaveCount(1)
      await expect(site.locator('[data-demo-site-close] svg.lucide-x')).toHaveCount(1)
      const refresh = await box(site.locator('svg.lucide-rotate-cw'))
      const close = await box(site.locator('[data-demo-site-close]'))
      expect(close.x).toBeGreaterThan(refresh.x + refresh.width)
      await expect(editor.locator('[data-demo-editor-scroll]')).toHaveAttribute(
        'data-hidden',
        'true',
      )
      await expect(editor.locator('[data-demo-top-bar]')).toBeVisible()
      await expect(panel).toHaveAttribute('data-state', 'open')
    },
  )

  story.at(siteOpensAt + 450, 'SEO finishes typing every field', async () => {
    expect([...partial].sort()).toEqual(['focus-keyword', 'meta-description', 'meta-title'])
    await expect
      .poll(async () => {
        const seoBox = await seo.boundingBox()
        const frameBox = await frame.boundingBox()
        const bodyBox = await body.boundingBox()
        if (!seoBox || !frameBox || !bodyBox) return false
        return (
          seoBox.y + seoBox.height <= frameBox.y + frameBox.height &&
          bodyBox.y < frameBox.y + frameBox.height / 2
        )
      })
      .toBe(true)
    await expect(seoTab).toContainText('Askeladd')
    await expect(seoTab.getByText('SEO Agent', { exact: true })).toHaveCount(1)
    const hue = (element: Element) =>
      getComputedStyle(element).getPropertyValue('--agent-base').trim()
    expect(await seoTab.evaluate(hue)).not.toBe(await bodyTab.evaluate(hue))
    for (const name of ['meta-title', 'meta-description', 'focus-keyword'])
      await expect(seo.locator(`[data-demo-field="${name}"]`)).toHaveAttribute(
        'data-empty',
        'false',
      )
    await expect(seo.locator('[data-demo-field="focus-keyword"]')).toContainText('Acme MCP')
    await expect(seoTab).toHaveAttribute('data-active', 'false')
    await expect(social).toHaveAttribute('data-empty', 'false')
  })

  story.at(siteOpensAt + 800, 'then the post loads, with the editor’s cover larger', async () => {
    await expect(sitePage).toHaveAttribute('data-state', 'loaded')
    await expect(sitePage.locator('h1')).toHaveText('Introducing Acme MCP')
    await expect(sitePage.locator('[data-demo-cover-title]')).toHaveText('Introducing Acme MCP')
    siteWords = await words.count()
    expect(siteWords).toBeGreaterThan(250)
    const weight = (locator: Locator) =>
      locator.evaluate((element) => getComputedStyle(element).fontWeight)
    expect(await weight(sitePage.locator('h1'))).toBe('500')
    expect(await weight(site.getByText('Acme', { exact: true }).first())).toBe('500')
    const proportions = (container: Locator) =>
      container.evaluate((element) => {
        const title = element.querySelector<HTMLElement>('[data-demo-cover-title]')
        if (!title) return null
        const width = element.getBoundingClientRect().width
        return {
          title: title.getBoundingClientRect().width / width,
          font: parseFloat(getComputedStyle(title).fontSize) / element.clientWidth,
        }
      })
    const editorCover = await proportions(
      frame.locator('[data-demo-field="cover-image"] [data-demo-cover]'),
    )
    const siteCover = await proportions(site.locator('[data-demo-site-cover]'))
    if (!editorCover || !siteCover) throw new Error('Covers are not rendered')
    expect(siteCover.title).toBeCloseTo(editorCover.title, 1)
    expect(siteCover.font).toBeCloseTo(editorCover.font, 2)
    const socialCover = social.locator('[data-demo-social-cover]')
    const socialProportions = await proportions(socialCover)
    if (!socialProportions) throw new Error('Social image is not rendered')
    expect(socialProportions.title).toBeCloseTo(editorCover.title, 1)
    expect(
      await socialCover.evaluate((element) => element.clientWidth / element.clientHeight),
    ).toBeCloseTo(1200 / 630, 1)
  })

  story.at(siteOpensAt + 1800, 'the post does not keep streaming in', async () => {
    expect(await words.count()).toBe(siteWords)
  })

  await story.play()
})

test('on the live site, the opening line is selected and Ask Air under it is typed and sent with Enter', async ({
  page,
}) => {
  const story = await playPreview(page, 'light')
  const onSite = (offset: number) => siteOpensAt + offset
  const frame = page.getByRole('region', { name: 'Aircastle preview' }).locator('[data-demo-frame]')
  const cursor = frame.locator('[data-demo-cursor]')
  const site = frame.locator('[data-demo-site-preview]')
  const sitePage = site.locator('[data-demo-site-page]')
  const opening = sitePage.locator('[data-demo-site-opening]')
  const selection = sitePage.locator('[data-demo-site-selection]')
  const ask = site.locator('[data-demo-ask-air]')
  const askInput = ask.locator('[data-demo-ask-input]')
  const panel = frame.locator('[data-demo-research-panel]')
  const messages = panel.locator('[data-demo-chat-message]')
  let unscrolled = { x: 0, y: 0, width: 0, height: 0 }
  let selected = { x: 0, y: 0, width: 0, height: 0 }
  let pageBox = { x: 0, y: 0, width: 0, height: 0 }
  let typedAt = { x: 0, y: 0, width: 0, height: 0 }
  const scrolled: number[] = []
  let cursorOverPage = false

  story.at(onSite(800), 'the post opens at its top', async () => {
    await expect(opening).toHaveText(openingLine)
    unscrolled = await box(opening)
    pageBox = await box(sitePage)
  })
  for (let at = 900; at < askTiming.selectStarts; at += 150)
    story.at(onSite(at), undefined, async () => {
      const now = await frame.evaluate((element) => ({
        opening: element.querySelector('[data-demo-site-opening]')?.getBoundingClientRect().y ?? 0,
        cursor: element.querySelector('[data-demo-cursor]')?.getBoundingClientRect().y ?? 0,
      }))
      scrolled.push(now.opening)
      const pointer = { y: now.cursor }
      if (
        scrolled.length > 1 &&
        scrolled.at(-1) !== scrolled.at(-2) &&
        pointer.y > pageBox.y &&
        pointer.y < pageBox.y + pageBox.height
      )
        cursorOverPage = true
    })
  story.at(
    onSite(askTiming.selectStarts + 50),
    'the page scrolls past the opening line and back with the cursor on it, which turns into a text cursor',
    async () => {
      const settledAt = scrolled.at(-1) ?? 0
      expect(Math.min(...scrolled)).toBeLessThan(settledAt - 80)
      expect(scrolled.slice(-4).every((y) => y === settledAt)).toBe(true)
      expect(cursorOverPage).toBe(true)
      await expect(cursor).toHaveAttribute('data-shape', 'text')
    },
  )

  story.at(onSite(askTiming.selectEnds + 20), 'the whole opening line is selected', async () => {
    await expect(selection).toHaveText(openingLine)
    selected = await box(opening)
    expect(selected.y).toBeLessThan(unscrolled.y - 100)
    expect(selected.y).toBeGreaterThan(pageBox.y)
    const end = await box(cursor)
    const lastLine = await selection.evaluate((element) => {
      const rect = [...element.getClientRects()].at(-1)
      if (!rect) throw new Error('Selection is not laid out')
      return { right: rect.right, top: rect.top, bottom: rect.bottom }
    })
    expect(Math.abs(end.x + end.width / 2 - lastLine.right)).toBeLessThan(16)
    expect(end.y).toBeLessThan(lastLine.bottom)
    expect(end.y + end.height).toBeGreaterThan(lastLine.top)
  })

  story.at(onSite(askTiming.dropdownOpens + 20), 'Ask Air opens under the selection', async () => {
    await expect(ask.locator('.air-mascot')).toHaveCount(1)
    await expect(ask.locator('[data-demo-ask-label]')).toHaveText('Ask Air')
    await expect(ask.locator('[data-demo-role-label]')).toHaveText('Orchestrator')
    await expect(ask.locator('[data-demo-ask-send]')).toHaveCount(1)
    const dropdown = await box(ask)
    expect(dropdown.y).toBeGreaterThan(selected.y + selected.height - 4)
    expect(dropdown.y + dropdown.height).toBeLessThan(pageBox.y + pageBox.height)
    await expect(askInput).toHaveText('')
    const field = await box(askInput)
    const sendButton = await box(ask.locator('[data-demo-ask-send]'))
    expect(field.height).toBeGreaterThan(sendButton.height * 1.4)
    expect(sendButton.y).toBeGreaterThan(field.y + 16)
    expect(sendButton.x + sendButton.width).toBeGreaterThan(dropdown.x + dropdown.width - 24)
    await expect(ask.locator('[data-demo-ask-caret]')).toHaveCount(1)
  })

  story.at(
    onSite(askTiming.typingStarts + askInstruction.length * askKeystroke + 20),
    'the instruction is typed',
    async () => {
      await expect(askInput).toHaveText(askInstruction)
      await expect(panel.locator('[data-demo-agent-switcher]')).toContainText('Canute')
      await expect(cursor).not.toHaveAttribute('data-state', 'clicking')
      typedAt = await box(cursor)
    },
  )

  story.at(onSite(askTiming.enterPressed + 20), 'Enter sends it, not a click on send', async () => {
    await expect(ask.locator('[data-demo-ask-send]')).toHaveAttribute('data-pressed', 'true')
    await expect(frame.locator('[data-demo-shortcut]')).toHaveAttribute('data-state', 'shown')
    await expect(frame.locator('[data-demo-shortcut]')).toHaveText('↵')
    await expect(cursor).not.toHaveAttribute('data-state', 'clicking')
    const pressedAt = await box(cursor)
    const send = await box(ask.locator('[data-demo-ask-send]'))
    expect(
      Math.hypot(pressedAt.x - typedAt.x, pressedAt.y - typedAt.y),
      'the cursor stays put, give or take a resting hand',
    ).toBeLessThan(40)
    expect(
      pressedAt.x > send.x - 4 &&
        pressedAt.x < send.x + send.width &&
        pressedAt.y > send.y - 4 &&
        pressedAt.y < send.y + send.height,
    ).toBe(false)
  })

  story.at(onSite(askTiming.sent + 20), 'the line goes to Air in the panel', async () => {
    await expect(ask).toHaveCount(0)
    const switcher = panel.locator('[data-demo-agent-switcher]')
    await expect(switcher).toContainText('Air')
    await expect(switcher.locator('[data-demo-agent-label]')).toHaveText('Orchestrator')
    await expect(switcher.locator('.air-mascot')).toHaveCount(1)
    expect(await messages.count()).toBeGreaterThanOrEqual(3)
    const latest = messages.last()
    await expect(latest).toHaveAttribute('data-from', 'user')
    await expect(latest).toContainText(askInstruction)
    await expect(latest.locator('[data-demo-chat-quote]')).toHaveText(openingLine)
    await expect(messages.first()).toHaveAttribute('data-from', 'user')
    await expect(messages.first()).toContainText(prompt)
    await expect(selection).toHaveText(openingLine)
  })

  await story.play()
})

test('Air hands the selected line to Thorkell and Thorfinn, who rewrite it in place, and Air reports back', async ({
  page,
}) => {
  const story = await playPreview(page, 'light')
  const onSite = (offset: number) => siteOpensAt + offset
  const frame = page.getByRole('region', { name: 'Aircastle preview' }).locator('[data-demo-frame]')
  const site = frame.locator('[data-demo-site-preview]')
  const sitePage = site.locator('[data-demo-site-page]')
  const opening = sitePage.locator('[data-demo-site-opening]')
  const selection = sitePage.locator('[data-demo-site-selection]')
  const panel = frame.locator('[data-demo-research-panel]')
  const messages = panel.locator('[data-demo-chat-message]')
  const thread = panel.locator('[data-demo-thread-message]')
  const inked = opening.locator('[data-demo-rewrite-word]')
  const opacityOf = (locator: Locator) =>
    locator.evaluate((element) => Number(getComputedStyle(element).opacity))

  story.at(onSite(askTiming.reviewNoted + 20), 'Air delegates the review to Thorkell', async () => {
    await expect(panel.locator('[data-demo-delegation]')).toContainText('Thorkell')
    await expect(panel.locator('[data-demo-chat-thinking]')).toHaveCount(0)
    await expect(thread.first()).toContainText('Thorkell')
    await expect(thread.first()).toContainText('Review Agent')
  })

  story.at(
    onSite(askTiming.rewriteStarts + 450),
    'Thorfinn inks the new line in word by word',
    async () => {
      await expect(selection).toHaveCount(0)
      await expect(opening).not.toContainText('lets any MCP client')
      expect(await inked.count()).toBeLessThan(rewrittenLine.split(' ').length)
      expect(await opacityOf(inked.first())).toBe(1)
      expect(await opacityOf(inked.last())).toBeLessThan(0.7)
      await expect(thread.nth(1)).toContainText('Thorfinn')
      await expect(thread.nth(1)).toContainText('Writing Agent')
    },
  )

  story.at(onSite(askTiming.rewriteEnds + 20), 'the rewritten line is complete', async () => {
    await expect(opening.locator('[data-demo-rewrite-pending]')).toHaveCount(0)
    await expect(opening).toHaveText(rewrittenLine)
  })

  story.at(
    onSite(askTiming.rewriteEnds + 620),
    'every new word is fully inked, with no agent marks left on the site',
    async () => {
      expect(
        await inked.evaluateAll((words) =>
          words.map((word) => Number(getComputedStyle(word).opacity)),
        ),
      ).toEqual(rewrittenLine.split(' ').map(() => 1))
      await expect(site.locator('[data-demo-agent-tab]')).toHaveCount(0)
      await expect(site.locator('[data-demo-agent-outline]')).toHaveCount(0)
    },
  )

  story.at(onSite(askTiming.finished + 20), 'Thorkell finishes the review', async () => {
    await expect(thread).toHaveCount(3)
    await expect(thread.nth(2)).toContainText('Thorkell')
    await expect(panel.locator('[data-demo-review-finished]')).toContainText('Thorkell')
  })

  story.at(
    onSite(askTiming.replied + 20),
    'Air replies, brighter than its team’s thread',
    async () => {
      await expect(messages.last()).toHaveAttribute('data-from', 'air')
      await expect(messages.last()).toContainText('Have a look')
      const colourOf = (locator: Locator) =>
        locator.evaluate((element) => getComputedStyle(element).color)
      const airText = lightness(await colourOf(messages.last().locator('p')))
      for (const part of await thread
        .locator('[data-demo-thread-name], [data-demo-thread-text]')
        .all())
        expect(lightness(await colourOf(part))).toBeGreaterThan(airText + 0.2)
      await expect(thread.locator('[data-demo-thread-text]')).toHaveCount(3)
    },
  )

  await story.play()
})

test('the cursor reads to the end of the live post, a reference jumps back to the revised line, and Publish bursts confetti', async ({
  page,
}) => {
  const story = await playPreview(page, 'light')
  const onSite = (offset: number) => siteOpensAt + offset
  const frame = page.getByRole('region', { name: 'Aircastle preview' }).locator('[data-demo-frame]')
  const cursor = frame.locator('[data-demo-cursor]')
  const site = frame.locator('[data-demo-site-preview]')
  const sitePage = site.locator('[data-demo-site-page]')
  const opening = sitePage.locator('[data-demo-site-opening]')
  const panel = frame.locator('[data-demo-research-panel]')
  const reference = panel.locator('[data-demo-chat-reference]')
  const publish = frame.locator('[data-demo-publish]')
  const preview = frame.locator('[data-demo-preview]')
  const status = frame.locator('[data-demo-post-status]')
  const confetti = frame.locator('[data-demo-confetti]')
  const pieces = confetti.locator('[data-demo-confetti-piece]')
  const background = (locator: Locator) =>
    locator.evaluate((element) => getComputedStyle(element).backgroundColor)
  const spread = async () => {
    const boxes = await pieces.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect()),
    )
    const xs = boxes.map((piece) => piece.x)
    const ys = boxes.map((piece) => piece.y)
    return { width: Math.max(...xs) - Math.min(...xs), top: Math.min(...ys) }
  }
  let pageBox = { x: 0, y: 0, width: 0, height: 0 }
  let revised = { x: 0, y: 0, width: 0, height: 0 }
  let button = { x: 0, y: 0, width: 0, height: 0 }
  let early = { width: 0, top: 0 }
  let reachedEnd = false
  let scrolledWithCursorOnPage = false
  let previousOpening = Infinity
  let previousHeading = Infinity

  story.at(onSite(800), 'the post opens at its top', async () => {
    await expect(opening).toHaveText(openingLine)
    pageBox = await box(sitePage)
  })
  story.at(onSite(7300), 'the cursor starts reading down the post', async () => {
    await expect(site.locator('[data-demo-ask-air]')).toHaveCount(0)
    previousOpening = (await box(opening)).y
    previousHeading = (await box(sitePage.locator('h2').first())).y
  })
  for (let at = 7350; at < askTiming.referenceMoveStarts; at += 200)
    story.at(onSite(at), undefined, async () => {
      const now = await frame.evaluate((element) => {
        const rect = (selector: string) => {
          const found = element.querySelector(selector)
          if (!found) throw new Error(`Missing ${selector}`)
          return found.getBoundingClientRect()
        }
        const closing = [...element.querySelectorAll('[data-demo-site-page] p')].find((paragraph) =>
          paragraph.textContent?.startsWith('MCP is an open standard'),
        )
        return {
          opening: rect('[data-demo-site-opening]').y,
          firstHeading: rect('[data-demo-site-page] h2').y,
          cursorX: rect('[data-demo-cursor]').x,
          closingBottom: closing?.getBoundingClientRect().bottom ?? Infinity,
        }
      })
      expect(now.firstHeading).toBeLessThanOrEqual(previousHeading + 0.5)
      previousHeading = now.firstHeading
      if (
        now.opening < previousOpening &&
        now.cursorX > pageBox.x &&
        now.cursorX < pageBox.x + pageBox.width
      )
        scrolledWithCursorOnPage = true
      previousOpening = now.opening
      if (now.closingBottom <= pageBox.y + pageBox.height) reachedEnd = true
    })

  story.at(
    onSite(askTiming.referenceMoveStarts + 20),
    'the cursor read to the end of the post and heads for the reference',
    async () => {
      expect(scrolledWithCursorOnPage).toBe(true)
      expect(reachedEnd).toBe(true)
      expect((await box(opening)).y).toBeLessThan(pageBox.y)
      await expect(reference).toHaveCount(1)
      await expect(reference).toContainText('Ask Claude to find every stale draft')
    },
  )

  story.at(onSite(askTiming.referenceClicked + 20), 'the cursor clicks the reference', async () => {
    await expect(cursor).toHaveAttribute('data-state', 'clicking')
    expect(inside(await box(cursor), await box(reference))).toBe(true)
  })

  story.at(
    onSite(askTiming.referenceClicked + 1300),
    'the site jumps back to the revised line',
    async () => {
      revised = await box(opening)
      expect(revised.y).toBeGreaterThan(pageBox.y)
      expect(revised.y).toBeLessThan(pageBox.y + pageBox.height / 2)
      await expect(opening).toHaveText(rewrittenLine)
      await expect(cursor).not.toHaveAttribute('data-target', 'publish')
    },
  )

  story.at(
    onSite(askTiming.publishMoveStarts + 20),
    'the cursor heads for Publish on the draft',
    async () => {
      await expect(frame.locator('[data-demo-chat-message][data-from="air"]').last()).toContainText(
        'Have a look',
      )
      await expect(confetti).toHaveCount(0)
      await expect(status).toHaveText('Draft')
      await expect(publish).toHaveText('Publish')
      expect(await background(publish)).not.toBe(await background(preview))
    },
  )

  story.at(
    onSite(askTiming.publishClicked + 20),
    'the cursor clicks Publish with the line still in place',
    async () => {
      await expect(cursor).toHaveAttribute('data-state', 'clicking')
      await expect(cursor).toHaveAttribute('data-shape', 'pointer')
      button = await box(publish)
      expect(inside(await box(cursor), button)).toBe(true)
      expect((await box(opening)).y).toBe(revised.y)
    },
  )

  story.at(
    onSite(askTiming.publishClicked + 100),
    'the post is published and confetti bursts',
    async () => {
      await expect(status).toHaveText('Published')
      await expect(publish).toHaveText('Unpublish')
      expect(await background(publish)).toBe(await background(preview))
      expect(await publish.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe(
        await preview.evaluate((element) => getComputedStyle(element).borderTopWidth),
      )
      expect(await pieces.count()).toBeGreaterThan(30)
      early = await spread()
    },
  )

  story.at(onSite(askTiming.publishClicked + 600), 'the confetti spreads out', async () => {
    const later = await spread()
    expect(later.width).toBeGreaterThan(early.width + 100)
    expect(later.top).toBeLessThan(button.y + button.height)
  })

  story.at(
    onSite(askTiming.publishClicked + 2020),
    'the confetti lands and the post stays published',
    async () => {
      await expect(confetti).toHaveCount(0)
      await expect(frame.locator('[data-demo-editor]')).toHaveAttribute('data-state', 'shown')
      await expect(status).toHaveText('Published')
      await expect(publish).toHaveText('Unpublish')
    },
  )

  await story.play()
})

test('a notification opens the docs entry in preview, and the cursor reads it to the bottom and publishes it', async ({
  page,
}) => {
  const story = await playPreview(page, 'light')
  const onSite = (offset: number) => siteOpensAt + offset
  const frame = page.getByRole('region', { name: 'Aircastle preview' }).locator('[data-demo-frame]')
  const cursor = frame.locator('[data-demo-cursor]')
  const site = frame.locator('[data-demo-site-preview]')
  const bell = frame.locator('[data-demo-notifications]')
  const badge = bell.locator('[data-demo-notification-badge]')
  const menu = frame.locator('[data-demo-notifications-menu]')
  const actions = menu.locator('[data-demo-notification-action]')
  const status = frame.locator('[data-demo-post-status]')
  const publish = frame.locator('[data-demo-publish]')
  const breadcrumb = frame.locator('[data-demo-breadcrumb]')
  const docs = site.locator('[data-demo-docs-page]')
  const confetti = frame.locator('[data-demo-confetti]')
  const outro = frame.locator('[data-demo-outro]')
  const expectCursorOn = async (locator: Locator) => {
    expect(inside(await box(cursor), await box(locator))).toBe(true)
  }
  let sitePage = { x: 0, y: 0, width: 0, height: 0 }
  let topTitle = 0
  let previousTitle = 0
  let scrolledWithCursorOnDocs = false
  let reachedEnd = false

  story.at(onSite(askTiming.publishMoveStarts), 'no notification yet', async () => {
    await expect(badge).toHaveCount(0)
  })

  story.at(
    momentWhen((now) => now.cursorTarget === 'publish' && now.cursor === 'moving') + 450,
    'the docs notification arrives on the way to Publish',
    async () => {
      await expect(badge).toHaveText('1')
      await expect(cursor).toHaveAttribute('data-target', 'publish')
      await expect(status).toHaveText('Draft')
      const red = await badge.evaluate((element) => {
        const context = document.createElement('canvas').getContext('2d')
        if (!context) throw new Error('No canvas')
        context.fillStyle = getComputedStyle(element).backgroundColor
        context.fillRect(0, 0, 1, 1)
        return [...context.getImageData(0, 0, 1, 1).data]
      })
      expect(red[0]).toBeGreaterThan(180)
      expect(red[1]).toBeLessThan(120)
    },
  )

  story.at(onSite(askTiming.bellClicked + 20), 'the cursor clicks the bell', async () => {
    await expect(cursor).toHaveAttribute('data-state', 'clicking')
    await expect(cursor).toHaveAttribute('data-target', 'bell')
    await expect(cursor).toHaveAttribute('data-shape', 'pointer')
    await expect(status).toHaveText('Published')
    await expectCursorOn(bell)
  })

  story.at(
    onSite(askTiming.bellClicked + 300),
    'the notification says the docs page is ready',
    async () => {
      await expect(menu).toBeVisible()
      await expect(badge).toHaveCount(0)
      await expect(menu).toContainText('Connect to Acme MCP')
      await expect(menu).toContainText('ready for your review')
      await expect(menu.locator('.air-mascot')).toHaveCount(1)
      await expect(actions).toHaveText(['Open entry', 'Preview'])
      const menuBox = await box(menu)
      const bellBox = await box(bell)
      expect(menuBox.y).toBeGreaterThan(bellBox.y + bellBox.height - 2)
    },
  )

  story.at(
    onSite(askTiming.notificationPreviewClicked + 20),
    'the cursor clicks its Preview',
    async () => {
      await expect(cursor).toHaveAttribute('data-state', 'clicking')
      await expect(cursor).toHaveAttribute('data-target', 'notification-preview')
      await expectCursorOn(actions.last())
    },
  )

  story.at(
    onSite(askTiming.notificationPreviewClicked + 400),
    'the docs entry opens in preview as a draft',
    async () => {
      await expect(menu).toHaveCount(0)
      await expect(breadcrumb).toContainText('Docs')
      await expect(breadcrumb).toContainText('Connect to Acme MCP')
      await expect(status).toHaveText('Draft')
      await expect(publish).toHaveText('Publish')
      await expect(frame.locator('[data-demo-preview]')).toHaveText('Close Preview')
      await expect(site.locator('[data-demo-site-address]')).toContainText('docs.acme.com')
      await expect(frame.locator('[data-demo-research-panel]')).toHaveAttribute(
        'data-state',
        'closed',
      )
    },
  )

  story.at(onSite(askTiming.notificationPreviewClicked + 1200), 'the docs page loads', async () => {
    await expect(docs.locator('h1')).toHaveText('Connect to Acme MCP')
    await expect(docs.locator('[data-demo-docs-nav] [aria-current="page"]')).toHaveText(
      'Connect to Acme MCP',
    )
    await expect(docs.locator('pre')).toContainText('mcp.acme.com')
    expect(await docs.locator('[data-demo-docs-step]').count()).toBeGreaterThanOrEqual(3)
    sitePage = await box(site.locator('[data-demo-site-page]'))
    expect((await box(docs.locator('[data-demo-docs-end]'))).y).toBeGreaterThan(
      sitePage.y + sitePage.height,
    )
    topTitle = (await box(docs.locator('h1'))).y
    previousTitle = topTitle
  })
  for (
    let at = askTiming.notificationPreviewClicked + 1300;
    at <
    Math.min(
      askTiming.notificationPreviewClicked + 1200 + 3500,
      askTiming.docsPublishMoveStarts - 20,
    );
    at += 200
  )
    story.at(onSite(at), undefined, async () => {
      const now = await frame.evaluate(() => {
        const rect = (selector: string) => {
          const found = document.querySelector(selector)
          if (!found) throw new Error(`Missing ${selector}`)
          return found.getBoundingClientRect()
        }
        return {
          title: rect('[data-demo-docs-page] h1').y,
          endBottom: rect('[data-demo-docs-end]').bottom,
          cursorX: rect('[data-demo-cursor]').x,
          target: document.querySelector('[data-demo-cursor]')?.getAttribute('data-target'),
        }
      })
      if (reachedEnd) return
      expect(now.title).toBeLessThanOrEqual(previousTitle + 0.5)
      if (now.title < previousTitle && now.target === 'docs-read' && now.cursorX > sitePage.x)
        scrolledWithCursorOnDocs = true
      previousTitle = now.title
      if (now.endBottom <= sitePage.y + sitePage.height + 1) reachedEnd = true
    })
  story.at(
    onSite(askTiming.docsPublishMoveStarts - 20),
    'the cursor read the docs to the bottom and is back at the top',
    async () => {
      expect(scrolledWithCursorOnDocs).toBe(true)
      expect(reachedEnd, 'it reaches the bottom within 3.5 seconds').toBe(true)
      await expect(cursor).toHaveAttribute('data-target', 'docs-read')
      expect(Math.abs((await box(docs.locator('h1'))).y - topTitle)).toBeLessThan(1)
      await expect(confetti).toHaveCount(0)
    },
  )

  story.at(
    onSite(askTiming.docsPublishClicked + 20),
    'the cursor clicks Publish on the docs',
    async () => {
      await expect(cursor).toHaveAttribute('data-state', 'clicking')
      await expect(cursor).toHaveAttribute('data-target', 'docs-publish')
      await expectCursorOn(publish)
      await expect(outro).toHaveCount(0)
    },
  )

  story.at(
    onSite(askTiming.docsPublishClicked + 100),
    'confetti bursts from Publish and the docs are published',
    async () => {
      const pieces = confetti.locator('[data-demo-confetti-piece]')
      expect(await pieces.count()).toBeGreaterThan(30)
      const burstX = await pieces.evaluateAll(
        (elements) =>
          elements.reduce((sum, piece) => sum + piece.getBoundingClientRect().x, 0) /
          elements.length,
      )
      const publishBox = await box(publish)
      expect(Math.abs(burstX - (publishBox.x + publishBox.width / 2))).toBeLessThan(
        publishBox.width,
      )
      await expect(status).toHaveText('Published')
      await expect(publish).toHaveText('Unpublish')
      await expect(breadcrumb).toContainText('Connect to Acme MCP')
    },
  )

  story.at(onSite(askTiming.docsPublishClicked + 2020), 'the confetti lands', async () => {
    await expect(confetti).toHaveCount(0)
    await expect(frame.locator('[data-demo-editor]')).toHaveAttribute('data-state', 'shown')
    await expect(docs).toBeVisible()
    await expect(status).toHaveText('Published')
  })

  await story.play()
})

test('after the docs are published, the closing card blooms the Gale mark and Aircastle, then fades back to the table', async ({
  page,
}) => {
  const story = await playPreview(page, 'light')
  const frame = page.getByRole('region', { name: 'Aircastle preview' }).locator('[data-demo-frame]')
  const outro = frame.locator('[data-demo-outro]')
  const mark = outro.locator('[data-demo-outro-mark]')
  const blades = mark.locator('[data-demo-outro-blade]')
  const wordmark = outro.locator('[data-demo-outro-wordmark]')
  const opacityOf = (locator: Locator) =>
    locator.evaluate((element) => Number(getComputedStyle(element).opacity))
  let frameBox = { x: 0, y: 0, width: 0, height: 0 }
  const outroStarts = firstMoment((now) => now.outroElapsed !== null)

  story.at(outroStarts + 150, 'the closing card fades in over a blur', async () => {
    const fadingIn = await opacityOf(outro)
    expect(fadingIn).toBeGreaterThan(0)
    expect(fadingIn).toBeLessThan(1)
    await expect(outro).toHaveCSS('backdrop-filter', /blur/)
  })

  story.at(outroStarts + 1000, undefined, async () => {
    expect(await opacityOf(outro), 'the card eases in over more than a second').toBeLessThan(1)
  })

  story.at(
    outroStarts + 1600,
    'the card covers the frame with a grainy warm-to-cool gradient and the Gale mark blooms in the centre',
    async () => {
      await expect.poll(() => opacityOf(outro)).toBe(1)
      frameBox = await box(frame)
      expect(await box(outro)).toEqual(frameBox)
      await expect(outro.locator('[data-demo-outro-grain]')).toHaveCSS(
        'background-image',
        /feTurbulence/,
      )
      const shot = (await outro.screenshot()).toString('base64')
      const sides = await page.evaluate(async (data) => {
        const image = new Image()
        image.src = `data:image/png;base64,${data}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('No canvas')
        context.drawImage(image, 0, 0)
        const colour = (left: number, top: number) => {
          const pixels = context.getImageData(
            Math.floor(left * image.width),
            Math.floor(top * image.height),
            Math.floor(image.width * 0.1),
            Math.floor(image.height * 0.2),
          ).data
          let red = 0
          let blue = 0
          for (let index = 0; index < pixels.length; index += 4) {
            red += pixels[index] ?? 0
            blue += pixels[index + 2] ?? 0
          }
          return { red: red / (pixels.length / 4), blue: blue / (pixels.length / 4) }
        }
        return { left: colour(0.01, 0.1), right: colour(0.89, 0.45) }
      }, shot)
      expect(sides.left.red - sides.left.blue, 'warm orange at the left').toBeGreaterThan(60)
      expect(sides.right.blue - sides.right.red, 'cool blue at the right edge').toBeGreaterThan(10)
      const covered = await page.evaluate(({ x, y, width, height }) => {
        const demo = document.querySelector('[data-demo-frame]')
        demo?.removeAttribute('inert')
        const onTop = [
          [0.03, 0.03],
          [0.5, 0.2],
          [0.85, 0.12],
          [0.2, 0.8],
          [0.95, 0.95],
        ].every(([fx, fy]) =>
          Boolean(
            document
              .elementFromPoint(x + width * (fx ?? 0), y + height * (fy ?? 0))
              ?.closest('[data-demo-outro]'),
          ),
        )
        demo?.setAttribute('inert', '')
        return onTop
      }, frameBox)
      expect(covered).toBe(true)
      await expect(blades).toHaveCount(5)
      expect(
        await opacityOf(blades.first()),
        'the strands bloom one after another',
      ).toBeGreaterThan(await opacityOf(blades.last()))
      expect(await opacityOf(wordmark), 'the logo comes before the name').toBe(0)
      const settleTurn = await mark.evaluate((element) =>
        parseFloat(getComputedStyle(element).rotate),
      )
      expect(
        settleTurn,
        'the mark settles counter-clockwise, from a clockwise offset',
      ).toBeGreaterThan(0)
      const blooming = await box(mark)
      expect(
        Math.abs(blooming.x + blooming.width / 2 - (frameBox.x + frameBox.width / 2)),
      ).toBeLessThan(2)
      expect(
        Math.abs(blooming.y + blooming.height / 2 - (frameBox.y + frameBox.height / 2)),
      ).toBeLessThan(2)
    },
  )

  story.at(
    outroStarts + 1650,
    'Aircastle slides out beside the mark and the lockup settles centred',
    async () => {
      const centreX = frameBox.x + frameBox.width / 2
      let slidOut = false
      let at = outroStarts + 1650
      for (let tick = 0; tick < 40; tick += 1) {
        at += 100
        await story.jumpTo(at)
        const now = await outro.evaluate((element) => {
          const name = element.querySelector('[data-demo-outro-wordmark]')
          const markElement = element.querySelector('[data-demo-outro-mark]')
          if (!name || !markElement) throw new Error('The closing card is incomplete')
          const style = getComputedStyle(name)
          const nameBox = name.getBoundingClientRect()
          const markBox = markElement.getBoundingClientRect()
          return {
            shown: Number(style.opacity),
            clip: style.clipPath,
            mask: style.maskImage,
            name: { x: nameBox.x },
            logo: { x: markBox.x, width: markBox.width },
          }
        })
        const { shown, logo, name } = now
        if (shown === 0) continue
        if (shown < 1) {
          expect(name.x, 'the name slides out to the right of the logo').toBeGreaterThan(
            logo.x + logo.width - 2,
          )
          if (shown > 0.3)
            expect(logo.x + logo.width / 2, 'the logo makes room').toBeLessThan(centreX - 2)
          const reveal = now
          expect(reveal.clip, 'no hard edge slices the letters').toBe('none')
          expect(reveal.mask, 'the letters fade in through a soft edge').toMatch(
            /^linear-gradient\(.*(transparent|rgba\(0, 0, 0, 0\))/,
          )
          slidOut = true
        }
        if (shown === 1) break
      }
      expect(slidOut).toBe(true)
      await story.jumpTo(at + 600)
      await expect(wordmark).toHaveText('Aircastle')
      expect(await opacityOf(wordmark)).toBe(1)
      for (const blade of await blades.all()) expect(await opacityOf(blade)).toBe(1)
      const logo = await box(mark)
      const name = await box(wordmark)
      expect(name.x).toBeGreaterThan(logo.x + logo.width)
      const lockupCentre = (logo.x + name.x + name.width) / 2
      expect(Math.abs(lockupCentre - centreX), 'logo and name sit centred together').toBeLessThan(2)
      expect(Math.abs(name.y + name.height / 2 - (logo.y + logo.height / 2))).toBeLessThan(3)
      expect(await wordmark.evaluate((element) => getComputedStyle(element).color)).toBe(
        'rgb(255, 255, 255)',
      )
      await expect(wordmark).toHaveCSS('font-weight', '300')
      await test.step('the card fades out over the table and the loop starts again', async () => {
        let fadedOut = false
        for (
          let fade = Math.max(at + 700, loopDuration - 1000);
          fade < loopDuration + 500;
          fade += 100
        ) {
          await story.jumpTo(fade)
          const now = await frame.evaluate((element) => {
            const card = element.querySelector('[data-demo-outro]')
            return {
              opacity: card ? Number(getComputedStyle(card).opacity) : null,
              table: element.querySelector('[data-demo-table]')?.getAttribute('data-state'),
              row: element.querySelector('[data-demo-row="agent"]')?.getAttribute('data-state'),
            }
          })
          if (now.opacity === null) break
          if (now.opacity < 1 && now.opacity > 0) {
            fadedOut = true
            expect(now.table).toBe('shown')
            expect(now.row).toBe('hidden')
          }
        }
        expect(fadedOut).toBe(true)
        await expect(outro).toHaveCount(0)
        await expect(frame.locator('[data-demo-table]')).toHaveAttribute('data-state', 'shown')
      })
    },
  )

  await story.play()
})

function lightness(colour: string) {
  const match = /oklch\(([\d.]+)/.exec(colour) ?? /oklab\(([\d.]+)/.exec(colour)
  if (match?.[1]) return Number(match[1])
  const rgb = /rgba?\((\d+), (\d+), (\d+)/.exec(colour)
  if (!rgb) throw new Error(`Unreadable colour ${colour}`)
  return (Number(rgb[1]) + Number(rgb[2]) + Number(rgb[3])) / 765
}

for (const theme of ['light', 'dark'] as const) {
  test(`the site preview sits flush in the shell with a ${theme} browser bar`, async ({ page }) => {
    const story = await playPreview(page, theme)
    const frame = page
      .getByRole('region', { name: 'Aircastle preview' })
      .locator('[data-demo-frame]')
    const site = frame.locator('[data-demo-site-preview]')
    await story.jumpTo(siteOpensAt + 20)
    await expect(site).toHaveCount(1)
    await page.waitForTimeout(400)
    const topBar = await box(frame.locator('[data-demo-top-bar]'))
    const chrome = site.locator('[data-demo-site-chrome]')
    const siteBox = await box(site.locator('[data-demo-site-window]'))
    const panel = await box(frame.locator('[data-demo-research-panel]'))
    const sidebar = await box(frame.locator('[data-demo-sidebar]'))
    expect(Math.abs(siteBox.y - (topBar.y + topBar.height))).toBeLessThanOrEqual(1)
    expect(Math.abs(siteBox.x - (sidebar.x + sidebar.width))).toBeLessThanOrEqual(1)
    expect(Math.abs(siteBox.x + siteBox.width - panel.x)).toBeLessThanOrEqual(1)
    await expect(site.locator('[data-demo-site-window]')).toHaveCSS('border-top-left-radius', '0px')
    const bar = lightness(
      await chrome.evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    const field = lightness(
      await site
        .locator('[data-demo-site-field]')
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    if (theme === 'dark') expect(field).toBeGreaterThan(bar)
    else expect(field).toBeLessThan(bar)
    await story.jumpTo(siteOpensAt + 820)
    const sitePage = site.locator('[data-demo-site-page]')
    const pageLightness = lightness(
      await sitePage.evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    const titleLightness = lightness(
      await sitePage.locator('h1').evaluate((element) => getComputedStyle(element).color),
    )
    if (theme === 'dark') {
      expect(pageLightness).toBeLessThan(0.3)
      expect(titleLightness).toBeGreaterThan(0.8)
    } else {
      expect(pageLightness).toBeGreaterThan(0.9)
      expect(titleLightness).toBeLessThan(0.3)
    }
  })
}

test('the preview waits on its first frame until it is mostly in view, so the story starts from the top', async ({
  page,
}) => {
  await page.clock.install({ time: 0 })
  await page.clock.pauseAt(1000)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  const preview = page.getByRole('region', { name: 'Aircastle preview' })
  await expect(preview, 'the top of the preview peeks under the hero').toBeInViewport()
  await expect(preview).not.toBeInViewport({ ratio: 0.5 })
  await page.waitForTimeout(300)
  await expect(page.locator('[data-demo-stage]')).toHaveAttribute('data-demo-playing', 'false')
  await page.clock.fastForward(story(4000))
  await expect(preview.locator('[data-demo-dialog]'), 'Ask Air has not opened yet').toHaveCount(0)
  await playInView(preview)
  await page.waitForTimeout(300)
  await page.clock.fastForward(story(2600))
  expect(
    ((await preview.locator('[data-demo-prompt]').textContent()) ?? '').length,
  ).toBeGreaterThan(0)
})

test('the preview pauses while it is scrolled out of view and resumes where it left off', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 520 })
  await page.clock.install({ time: 0 })
  await page.clock.pauseAt(1000)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  const preview = page.getByRole('region', { name: 'Aircastle preview' })
  const typed = preview.locator('[data-demo-prompt]')
  await playInView(preview)
  await page.waitForTimeout(300)
  await page.clock.fastForward(story(2600))
  const before = (await typed.textContent()) ?? ''
  expect(before.length).toBeGreaterThan(0)
  expect(before.length).toBeLessThan(prompt.length)
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(preview).not.toBeInViewport()
  await page.waitForTimeout(300)
  await page.clock.fastForward(story(20000))
  await playInView(preview)
  await page.waitForTimeout(300)
  await page.clock.fastForward(16)
  const after = (await typed.textContent()) ?? ''
  expect(after.startsWith(before), 'the prompt picks up where it was').toBe(true)
  expect(after.length - before.length, 'no time passed while hidden').toBeLessThan(4)
  await page.clock.fastForward(story(400))
  expect(((await typed.textContent()) ?? '').length, 'and it plays on').toBeGreaterThan(
    after.length,
  )
})
