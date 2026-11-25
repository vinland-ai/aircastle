import { seoTiming } from './timeline'

/** Askeladd's SEO fields, each typed over its own window after he starts, in milliseconds. */
export const seoFields = [
  {
    name: 'meta-title',
    label: 'Meta title',
    value: 'Introducing Acme MCP: connect Acme to your AI tools',
    placeholder: 'Defaults to the post title',
    limit: 60,
    start: 0,
    duration: seoTiming.metaTitleTyped,
    leave: 1100,
  },
  {
    name: 'meta-description',
    label: 'Meta description',
    value:
      'Acme MCP lets Claude, Cursor and other AI tools read and update your Acme workspace. Set it up in a few minutes.',
    placeholder: 'Defaults to the summary',
    limit: 160,
    start: 1100,
    duration: 1500,
    leave: 3000,
  },
  {
    name: 'focus-keyword',
    label: 'Focus keyword',
    value: 'Acme MCP',
    placeholder: 'Add a keyword',
    start: 3000,
    duration: 350,
    leave: seoTiming.done,
  },
] as const

/** One of Askeladd's SEO fields. */
type SeoField = (typeof seoFields)[number]

/** How many characters of a field Askeladd has typed, `elapsed` milliseconds after he starts. */
export function seoTypedAt(field: SeoField, elapsed: number | null) {
  if (elapsed === null) return 0
  const typed = Math.floor(((elapsed - field.start) / field.duration) * field.value.length)
  return Math.max(0, Math.min(field.value.length, typed))
}

/** Whether Askeladd is on a field, `elapsed` milliseconds after he starts. */
export function seoActiveAt(field: SeoField, elapsed: number | null) {
  return elapsed !== null && (field.start === 0 || elapsed >= field.start) && elapsed < field.leave
}
