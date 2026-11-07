import { describe, expect, it } from 'vite-plus/test'
import { bodyDraftDuration, openingLine, rewrittenLine } from './body-draft'
import { cursorPosition, cursorSpots } from './cursor-path'
import { docsDecisionState, researchLog, researchSources, sourcesReadBy } from './research'
import {
  askInstruction,
  askKeystroke,
  askOpenAt,
  askTiming,
  askTypedAt,
  confettiAt,
  docsPreviewAt,
  docsScrollAt,
  notificationsOpenAt,
  publishedAt,
  rewrittenWordsAt,
  selectedCharsAt,
  siteScrollAt,
  unreadNotificationsAt,
} from './site-ask'
import { frameAt, loopDuration, playbackRate, prompt, seoTiming, type Frame } from './timeline'

const step = 5

const frames = Array.from({ length: Math.ceil(loopDuration / step) }, (_, index) => ({
  at: index * step,
  frame: frameAt(index * step),
}))

function first(test: (frame: Frame, at: number) => boolean, from = 0) {
  const hit = frames.find(({ at, frame }) => at >= from && test(frame, at))
  if (!hit) throw new Error('The story never reaches this moment')
  return hit.at
}

function between(from: number, to: number) {
  return frames.filter(({ at }) => at >= from && at < to)
}

function changesOf<T>(read: (at: number) => T, from: number, to: number, every = step) {
  const changes: { at: number; value: T }[] = []
  for (let at = from; at < to; at += every) {
    const value = read(at)
    if (changes.at(-1)?.value !== value) changes.push({ at, value })
  }
  return changes
}

function expectNonDecreasing(values: readonly number[]) {
  for (const [index, value] of values.entries())
    expect(value, `step ${index}`).toBeGreaterThanOrEqual(values[index - 1] ?? -Infinity)
}

const editorOpens = first((frame) => frame.view === 'editor')
const siteOpens = first((frame) => frame.previewElapsed !== null)
const onSite = (offset: number) => siteOpens + offset

describe('the product preview story', () => {
  it('opens Ask Air with ⌘J, types the idea at Ask Air’s pace and sends it with Enter', () => {
    const shortcutShown = first((frame) => frame.shortcut === 'open-agents')
    const dialogOpens = first((frame) => frame.dialog === 'open')
    expect(shortcutShown).toBeLessThan(dialogOpens)
    expect(frameAt(dialogOpens).shortcut).toBe('open-agents')
    expect(frameAt(dialogOpens).typed).toBe(0)

    const sendPressed = first((frame) => frame.sendPressed)
    const keystrokes = changesOf((at) => frameAt(at).typed, dialogOpens, sendPressed, 1)
    expect(keystrokes.map(({ value }) => value)).toEqual(
      Array.from({ length: prompt.length + 1 }, (_, index) => index),
    )
    const gaps = keystrokes.slice(2).map(({ at }, index) => at - (keystrokes[index + 1]?.at ?? 0))
    expect(new Set(gaps), 'the prompt types as fast as Ask Air later on').toEqual(
      new Set([askKeystroke]),
    )
    const typedOut = keystrokes.at(-1)?.at ?? 0
    expect(frameAt(typedOut).shortcut, 'the ⌘J chip is gone once the idea is typed').toBe(undefined)

    const pressed = frames.filter(({ frame }) => frame.sendPressed)
    expect(pressed.length).toBeGreaterThan(10)
    for (const { at, frame } of pressed) {
      expect(frame.shortcut, `Enter shows at ${at}ms`).toBe('send')
      expect(frame.dialog).toBe('open')
      expect(frame.typed).toBe(prompt.length)
    }
    const dialogStates = changesOf((at) => frameAt(at).dialog, 0, editorOpens).map(
      ({ value }) => value,
    )
    expect(dialogStates).toEqual(['closed', 'open', 'closing', 'closed'])
  })

  it('adds the agent row as the dialog closes, with Air first and the others joining one by one', () => {
    const rowShown = first((frame) => frame.agentRow)
    expect(frameAt(rowShown).dialog).not.toBe('open')
    const joins = changesOf((at) => frameAt(at).rowAgents, rowShown, editorOpens)
    expect(
      joins.map(({ value }) => value),
      'agents only join',
    ).toEqual([1, 2, 3, 4, 5])
  })

  it('rests the cursor, then points as soon as it is over the table and expands the agents tab before arriving', () => {
    const setsOff = first((frame) => frame.cursor !== 'resting')
    expect(setsOff).toBeGreaterThan(5000)
    expect(frameAt(setsOff).cursorTarget).toBe('row')
    const pointing = first((frame) => frame.cursorShape === 'pointer')
    expect(frameAt(pointing).cursor, 'a pointer while still moving over the rows').toBe('moving')
    const expanding = first((frame) => frame.agentRowHovered)
    expect(frameAt(expanding).cursor, 'the tab expands as the cursor enters the row').toBe('moving')
    const hovering = first((frame) => frame.cursor === 'hovering')
    expect(frameAt(hovering)).toMatchObject({ cursorShape: 'pointer', agentRowHovered: true })
    const clicking = first((frame) => frame.cursor === 'clicking')
    expect(frameAt(clicking).cursorShape).toBe('pointer')
    expect(hovering).toBeLessThan(clicking)
    expect(clicking).toBeLessThan(editorOpens)
    expect(editorOpens - clicking, 'the editor opens right after the click').toBeLessThan(300)
  })

  it('opens the editor before 6.2 real seconds at its playback rate, which 1x would miss', () => {
    expect(editorOpens).toBeGreaterThan(6200)
    expect(editorOpens).toBeGreaterThan(5500 * playbackRate)
    expect(editorOpens).toBeLessThanOrEqual(6200 * playbackRate)
  })

  it('has Thorfinn fill the categories, then the tags, then wait on Canute in the body', () => {
    expect(frameAt(editorOpens)).toMatchObject({
      categories: 0,
      tags: 0,
      writerOnCategories: true,
      writerOnTags: false,
      writerOnBody: false,
    })
    const working = changesOf(
      (at) => {
        const frame = frameAt(at)
        if (frame.writerOnCategories) return 'categories'
        if (frame.writerOnTags) return 'tags'
        if (frame.writerOnBody) return 'body'
        return 'none'
      },
      editorOpens,
      siteOpens,
    )
    expect(working.map(({ value }) => value)).toEqual([
      'categories',
      'none',
      'tags',
      'none',
      'body',
      'none',
    ])
    const [, leftCategories, onTags, leftTags, onBody] = working.map(({ at }) => at)
    const chips = (from: number, to: number, read: (frame: Frame) => number) =>
      changesOf((at) => read(frameAt(at)), from, to).map(({ value }) => value)
    expect(chips(editorOpens, leftCategories ?? 0, (frame) => frame.categories)).toEqual([0, 1, 2])
    expect(chips(editorOpens, onTags ?? 0, (frame) => frame.tags)).toEqual([0])
    expect(chips(onTags ?? 0, leftTags ?? 0, (frame) => frame.tags)).toEqual([0, 1, 2, 3])
    expect(frameAt(onBody ?? 0)).toMatchObject({ categories: 2, tags: 3, bodyElapsed: null })
  })

  it('shows the sources Canute reads in the top bar, one after another', () => {
    const current = changesOf(
      (at) => researchSources[sourcesReadBy(frameAt(at).researchSteps) - 1]?.url ?? null,
      editorOpens,
      siteOpens,
    ).map(({ value }) => value)
    expect(current.slice(0, 6)).toEqual([
      null,
      'modelcontextprotocol.io/specification',
      'github.com/acme/app/pulls?q=mcp+is:merged',
      'github.com/acme/app/pull/482',
      'linear.app/acme/issue/ACM-1290',
      'docs.acme.com/search?q=mcp',
    ])
  })

  it('opens Canute’s panel when the cursor clicks the top bar, and the log runs to its end', () => {
    const setsOff = first((frame) => frame.cursorTarget === 'research')
    expect(frameAt(setsOff)).toMatchObject({
      cursor: 'moving',
      researchHovered: false,
      researchPanelOpen: false,
    })
    const hovering = first((frame) => frame.cursor === 'hovering', setsOff)
    expect(frameAt(hovering)).toMatchObject({
      cursorTarget: 'research',
      cursorShape: 'pointer',
      researchHovered: true,
      researchPanelOpen: false,
    })
    const clicking = first((frame) => frame.cursor === 'clicking', setsOff)
    const opens = first((frame) => frame.researchPanelOpen)
    expect(clicking).toBeLessThan(opens)
    expect(frameAt(opens).cursorTarget).toBe('research')
    expect(frameAt(opens + 1500).researchSteps).toBeGreaterThan(frameAt(opens).researchSteps)
    const scrolls = first((frame) => frame.editorScroll > 0)
    expect(frameAt(scrolls).researchSteps).toBe(researchLog.length)
    expect(frameAt(siteOpens - step).researchSteps).toBe(researchLog.length)
  })

  it('asks the docs decision, the cursor answers it while it asks, and it is sent to Air', () => {
    const states = changesOf(
      (at) => docsDecisionState(frameAt(at).researchSteps),
      editorOpens,
      siteOpens,
    )
    expect(states.map(({ value }) => value)).toEqual(['unasked', 'asking', 'sent'])
    const hovering = frames.filter(
      ({ frame }) => frame.cursorTarget === 'decision' && frame.cursor === 'hovering',
    )
    expect(hovering.length).toBeGreaterThan(0)
    for (const { frame } of hovering) {
      expect(docsDecisionState(frame.researchSteps)).toBe('asking')
      expect(frame.cursorShape).toBe('pointer')
    }
    const clicking = first(
      (frame) => frame.cursorTarget === 'decision' && frame.cursor === 'clicking',
    )
    expect(clicking).toBeLessThan(states[2]?.at ?? 0)
  })

  it('has Einar start the cover with the editor and finish it before the editor scrolls', () => {
    const covers = changesOf((at) => frameAt(at).cover, editorOpens, siteOpens)
    expect(covers.map(({ value }) => value)).toEqual(['starting', 'generating', 'done'])
    expect(covers[0]?.at).toBe(editorOpens)
    expect(covers[2]?.at ?? Infinity).toBeLessThan(first((frame) => frame.editorScroll > 0))
  })

  it('has Thorfinn draft the body once Canute is done and leave when it is written', () => {
    const drafting = first((frame) => frame.bodyElapsed !== null)
    expect(frameAt(drafting).researchSteps).toBe(researchLog.length)
    expect(frameAt(drafting).writerOnBody).toBe(true)
    const done = first((frame) => (frame.bodyElapsed ?? -1) >= bodyDraftDuration)
    expect(frameAt(done - step).writerOnBody).toBe(true)
    expect(frameAt(done).writerOnBody).toBe(false)
  })

  it('scrolls the editor while the cursor travels to it, after the body has started, and only then starts SEO', () => {
    const scrolls = first((frame) => frame.editorScroll > 0)
    expect(frameAt(scrolls)).toMatchObject({
      cursorFrom: 'decision',
      cursorTarget: 'editor',
      cursor: 'moving',
      cursorShape: 'arrow',
    })
    expect(docsDecisionState(frameAt(scrolls).researchSteps)).toBe('sent')
    expect(frameAt(scrolls).bodyElapsed ?? 0).toBeGreaterThan(0)
    expect(frameAt(scrolls).researchSteps).toBe(researchLog.length)
    expect(frameAt(scrolls + 300).cursor).toBe('moving')
    expect(frameAt(scrolls + 300).editorScroll).toBeGreaterThan(frameAt(scrolls).editorScroll)
    expect(frameAt(scrolls - step).socialImage).toBe('idle')
    expect(first((frame) => (frame.seoElapsed ?? -1) >= 0)).toBeGreaterThan(scrolls)
  })

  it('sends the cursor to Preview once the social image and the body are done, while SEO still types', () => {
    const setsOff = first((frame) => frame.cursorTarget === 'preview')
    const frame = frameAt(setsOff)
    expect(frame).toMatchObject({ cursor: 'moving', socialImage: 'done', writerOnBody: false })
    expect(frame.bodyElapsed ?? 0).toBeGreaterThanOrEqual(bodyDraftDuration)
    expect(frame.seoElapsed ?? Infinity).toBeLessThan(seoTiming.done)
    const hovering = first((next) => next.cursor === 'hovering', setsOff)
    expect(frameAt(hovering).cursorShape).toBe('pointer')
    const clicks = between(setsOff, siteOpens).filter(({ frame }) => frame.cursor === 'clicking')
    expect(clicks.length).toBeGreaterThan(0)
    for (const { frame: clicking } of clicks) expect(clicking.previewElapsed).toBe(null)
    expect(siteOpens - (clicks.at(-1)?.at ?? 0)).toBeLessThanOrEqual(step)
    expect(frameAt(siteOpens).view).toBe('editor')
  })

  it('scrolls the live post past the opening line and back while the cursor is on the page, then selects the line with a text cursor', () => {
    const opening = (offset: number) => siteScrollAt(offset).opening
    const scrolled = changesOf(opening, 0, askTiming.selectStarts)
    expect(Math.max(...scrolled.map(({ value }) => value))).toBeGreaterThan(1.3)
    expect(opening(askTiming.lineMoveStarts)).toBe(1)
    expect(opening(askTiming.selectStarts)).toBe(1)
    expect(
      scrolled.some(({ at }) => {
        const frame = frameAt(onSite(at))
        return frame.cursorTarget === 'site-page' && frame.cursorProgress === 1
      }),
      'the page scrolls under a resting cursor',
    ).toBe(true)
    const selecting = between(onSite(askTiming.selectStarts), onSite(askTiming.selectEnds))
    for (const { frame } of selecting) {
      expect(frame.cursorShape).toBe('text')
      expect(frame.cursor).toBe('dragging')
    }
    const selected = changesOf(selectedCharsAt, askTiming.selectStarts, askTiming.selectEnds + 50)
    expectNonDecreasing(selected.map(({ value }) => value))
    expect(selectedCharsAt(askTiming.selectEnds)).toBe(openingLine.length)
  })

  it('opens Ask Air under the selection, types without a click and sends with Enter while the cursor stays put', () => {
    expect(askOpenAt(askTiming.dropdownOpens - 1)).toBe(false)
    expect(askOpenAt(askTiming.dropdownOpens)).toBe(true)
    expect(askOpenAt(askTiming.sent)).toBe(false)
    expect(askTypedAt(askTiming.typingStarts - 1)).toBe(0)
    expect(askTypedAt(askTiming.enterPressed)).toBe(askInstruction.length)
    const open = between(onSite(askTiming.dropdownOpens), onSite(askTiming.sent))
    const still = open[0]?.frame
    for (const { at, frame } of open) {
      expect(frame.cursor, `no click at ${at}ms`).not.toBe('clicking')
      expect(frame.cursorTarget).toBe(still?.cursorTarget)
    }
    for (const { frame } of between(onSite(askTiming.typingStarts), onSite(askTiming.sent)))
      expect(Math.hypot(frame.cursorDriftX, frame.cursorDriftY)).toBeLessThan(0.5)
    for (const { frame } of between(onSite(askTiming.enterPressed), onSite(askTiming.sent)))
      expect(frame.shortcut).toBe('send')
  })

  it('rewrites the opening line word by word, inking each word in', () => {
    expect(selectedCharsAt(askTiming.rewriteStarts - 1)).toBeGreaterThan(0)
    expect(selectedCharsAt(askTiming.rewriteStarts)).toBe(0)
    expect(rewrittenWordsAt(askTiming.rewriteStarts - 1)).toBe(null)
    const streaming = rewrittenWordsAt(askTiming.rewriteStarts + 450) ?? []
    expect(streaming.length).toBeGreaterThan(0)
    expect(streaming.length).toBeLessThan(rewrittenLine.split(' ').length)
    expect(streaming[0]?.ink).toBe(1)
    expect(streaming.at(-1)?.ink ?? 1).toBeLessThan(0.7)
    const settled = rewrittenWordsAt(askTiming.rewriteEnds + 600) ?? []
    expect(settled.map(({ word }) => word).join(' ')).toBe(rewrittenLine)
    expect(settled.every(({ ink }) => ink === 1)).toBe(true)
  })

  it('reads down to the end of the post with the cursor on the page, then a reference jumps back to the revised line, which holds until Publish', () => {
    const read = changesOf((at) => siteScrollAt(at).end, askTiming.sent, askTiming.referenceClicked)
    expectNonDecreasing(read.map(({ value }) => value))
    expect(siteScrollAt(askTiming.referenceMoveStarts).end).toBeCloseTo(1, 6)
    expect(
      read.slice(1).every(({ at }) => frameAt(onSite(at)).cursorTarget === 'site-read'),
      'it scrolls with the cursor on the page',
    ).toBe(true)
    expect(frameAt(onSite(askTiming.referenceClicked + 50))).toMatchObject({
      cursorTarget: 'reference',
      cursor: 'clicking',
      cursorShape: 'pointer',
    })
    const jumped = siteScrollAt(askTiming.publishMoveStarts)
    expect(jumped.end).toBeCloseTo(0, 6)
    for (let at = askTiming.publishMoveStarts; at < askTiming.publishClicked + 50; at += step)
      expect(siteScrollAt(at)).toEqual(jumped)
  })

  it('publishes the post with confetti, and the docs notification arrives on the way to Publish', () => {
    const notified =
      between(siteOpens, loopDuration).find(({ at }) => unreadNotificationsAt(at - siteOpens) > 0)
        ?.at ?? Infinity
    expect(frameAt(notified).cursorTarget).toBe('publish')
    expect(publishedAt(notified - siteOpens)).toBe(false)
    expect(confettiAt(askTiming.publishClicked - 1)).toBe(null)
    expect(confettiAt(askTiming.publishClicked)).toEqual({ elapsed: 0, entry: 'post' })
    expect(confettiAt(askTiming.publishClicked + 1500)?.entry).toBe('post')
    expect(confettiAt(askTiming.publishClicked + 2000)).toBe(null)
    expect(frameAt(onSite(askTiming.publishClicked + 50))).toMatchObject({
      cursorTarget: 'publish',
      cursor: 'clicking',
      cursorShape: 'pointer',
    })
  })

  it('opens the docs entry from the notification, reads it to the bottom within 3.5 seconds and is back at the top before Publish', () => {
    expect(frameAt(onSite(askTiming.bellClicked + 50))).toMatchObject({
      cursorTarget: 'bell',
      cursor: 'clicking',
      cursorShape: 'pointer',
    })
    expect(notificationsOpenAt(askTiming.bellClicked + 150)).toBe(true)
    expect(unreadNotificationsAt(askTiming.bellClicked + 150)).toBe(0)
    expect(frameAt(onSite(askTiming.notificationPreviewClicked + 50))).toMatchObject({
      cursorTarget: 'notification-preview',
      cursor: 'clicking',
    })
    const docsOpen =
      first(
        (frame) => frame.previewElapsed !== null && docsPreviewAt(frame.previewElapsed) !== null,
      ) - siteOpens
    expect(notificationsOpenAt(docsOpen)).toBe(false)
    const down = changesOf(docsScrollAt, docsOpen, askTiming.docsPublishMoveStarts)
    const top = down.findIndex(
      ({ value }, index) => index > 0 && value < (down[index - 1]?.value ?? 0),
    )
    const reading = down.slice(0, top)
    expectNonDecreasing(reading.map(({ value }) => value))
    const bottomAt = reading.find(({ value }) => value >= 1 - 1e-9)?.at ?? Infinity
    expect(bottomAt - (askTiming.notificationPreviewClicked + 1200)).toBeLessThan(3500)
    expect(
      reading.slice(1).every(({ at }) => frameAt(onSite(at)).cursorTarget === 'docs-read'),
      'it scrolls with the cursor on the docs',
    ).toBe(true)
    const backAtTop = down.find(({ value }, index) => index >= top && value <= 1e-9)
    expect(backAtTop).toBeDefined()
    expect(frameAt(onSite(backAtTop?.at ?? 0)).cursorTarget, 'back at the top while reading').toBe(
      'docs-read',
    )
  })

  it('publishes the docs with confetti, eases into the closing card over more than a second, and fades back to the table', () => {
    expect(confettiAt(askTiming.docsPublishClicked)).toEqual({ elapsed: 0, entry: 'docs' })
    expect(frameAt(onSite(askTiming.docsPublishClicked + 50))).toMatchObject({
      cursorTarget: 'docs-publish',
      cursor: 'clicking',
    })
    const outro = first((frame) => frame.outroElapsed !== null)
    expect(outro - siteOpens).toBeGreaterThan(askTiming.docsPublishClicked)
    expect(frameAt(outro + 150).outroOpacity).toBeGreaterThan(0)
    expect(frameAt(outro + 150).outroOpacity).toBeLessThan(1)
    expect(frameAt(outro + 1050).outroOpacity, 'it eases in over more than a second').toBeLessThan(
      1,
    )
    expect(frameAt(outro + 1650).outroOpacity).toBe(1)
    const fullyIn = first((frame) => frame.outroOpacity === 1)
    const fading = between(fullyIn, loopDuration).filter(
      ({ frame }) => frame.outroOpacity < 1 && frame.outroOpacity > 0,
    )
    expect(fading.length).toBeGreaterThan(10)
    for (const { frame } of fading) expect(frame).toMatchObject({ view: 'table', agentRow: false })
    expect(frameAt(0)).toMatchObject({ view: 'table', dialog: 'closed', outroElapsed: null })
  })

  it('arcs the first long cursor move off its straight line and eases in and out of it', () => {
    const setsOff = first((frame) => frame.cursor !== 'resting')
    const arrives = first((frame) => frame.cursor === 'hovering')
    const at = (moment: number) => {
      const frame = frameAt(moment)
      return cursorPosition({
        from: frame.cursorFrom,
        target: frame.cursorTarget,
        progress: frame.cursorProgress,
        curve: frame.cursorBend,
        drift: { x: frame.cursorDriftX, y: frame.cursorDriftY },
      })
    }
    const start = cursorSpots.rest
    const end = cursorSpots.row
    const length = Math.hypot(end.left - start.left, end.top - start.top)
    const deviation = (point: { left: number; top: number }) =>
      Math.abs(
        (end.top - start.top) * (point.left - start.left) -
          (end.left - start.left) * (point.top - start.top),
      ) / length
    expect(deviation(at((setsOff + arrives) / 2))).toBeGreaterThan(10)
    const slice = (arrives - setsOff) / 8
    const distances = Array.from({ length: 8 }, (_, index) => {
      const from = at(setsOff + index * slice)
      const to = at(setsOff + (index + 1) * slice)
      return Math.hypot(to.left - from.left, to.top - from.top)
    })
    const fastest = Math.max(...distances)
    expect(fastest).toBeGreaterThan((distances[0] ?? 0) * 2)
    expect(fastest).toBeGreaterThan((distances.at(-1) ?? 0) * 2)
  })
})
