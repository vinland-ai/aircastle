import type { Locator, Page } from '@playwright/test'
import {
  frameAt,
  loopDuration,
  playbackRate,
  type Frame,
} from '../src/features/marketing/product-demo/timeline'
import { expect, test } from './support'

const scanStep = 5

const frames = Array.from({ length: Math.ceil(loopDuration / scanStep) }, (_, index) => ({
  at: index * scanStep,
  frame: frameAt(index * scanStep),
}))

/** The first timeline moment, from `after` on, whose frame passes `check`. */
export function firstMoment(check: (frame: Frame) => boolean, after = 0) {
  const hit = frames.find(({ at, frame }) => at >= after && check(frame))
  if (!hit) throw new Error('The preview story never reaches this moment')
  return hit.at
}

/** Like `firstMoment`, nudged 20ms past the change so the browser lands well inside it. */
export function momentWhen(check: (frame: Frame) => boolean, after = 0) {
  return firstMoment(check, after) + scanStep * 4
}

/** When the live site preview opens, the origin of every `askTiming` beat. */
export const siteOpensAt = firstMoment((frame) => frame.previewElapsed !== null)

/** Opens the landing page on a paused clock and starts the preview, so a journey can jump it to chosen moments of its timeline. */
export async function playPreview(page: Page, theme?: 'light' | 'dark') {
  if (theme)
    await page.addInitScript((value) => localStorage.setItem('aircastle-theme', value), theme)
  await page.clock.install({ time: 0 })
  await page.clock.pauseAt(1000)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  const stage = page.locator('[data-demo-stage]')
  await stage.scrollIntoViewIfNeeded()
  await expect(stage).toHaveAttribute('data-demo-playing', 'true')
  let played = 0
  /** Jumps the preview to a moment of its timeline, drawing only that one frame instead of every frame on the way. */
  const jumpTo = async (timeline: number) => {
    const target = Math.ceil(timeline / playbackRate)
    if (target < played) throw new Error(`Cannot jump back from ${played}ms to ${target}ms`)
    if (target > played) await page.clock.fastForward(target - played)
    played = target
    await rendered(page)
  }
  const beats: { at: number; label: string | undefined; check: () => Promise<void> }[] = []
  return {
    stage,
    jumpTo,
    /** Plans a check at a moment of the timeline; `play` runs the plan in time order. */
    at(at: number, label: string | undefined, check: () => Promise<void>) {
      beats.push({ at, label, check })
    },
    async play() {
      const ordered = [...beats].sort((left, right) => left.at - right.at)
      beats.length = 0
      for (const beat of ordered) {
        const run = async () => {
          await jumpTo(beat.at)
          await beat.check()
        }
        if (beat.label) await test.step(beat.label, run)
        else await run()
      }
    },
  }
}

async function rendered(page: Page) {
  await page.evaluate(async () => {
    for (let pass = 0; pass < 2; pass += 1)
      await new Promise<void>((resolve) => {
        const channel = new MessageChannel()
        channel.port1.onmessage = () => resolve()
        channel.port2.postMessage(null)
      })
  })
}

/** The bounding box of an element that must be laid out. */
export async function box(locator: Locator) {
  const found = await locator.boundingBox()
  if (!found) throw new Error('Element is not laid out')
  return found
}

/** Whether a point lies inside a box. */
export function inside(
  point: { x: number; y: number },
  area: { x: number; y: number; width: number; height: number },
) {
  return (
    point.x > area.x &&
    point.x < area.x + area.width &&
    point.y > area.y &&
    point.y < area.y + area.height
  )
}
