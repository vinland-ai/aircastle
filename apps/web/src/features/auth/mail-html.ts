import { createElement, type ReactNode } from 'react'

const keptTags = new Set([
  'p',
  'br',
  'a',
  'strong',
  'em',
  'b',
  'i',
  'span',
  'div',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'blockquote',
  'table',
  'tbody',
  'tr',
  'td',
  'th',
])

const droppedTags = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'form',
  'input',
  'button',
])

export function renderMailHtml(html: string): ReactNode {
  const document = new DOMParser().parseFromString(html, 'text/html')
  function render(node: Node, key: number): ReactNode {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent
    if (!(node instanceof Element)) return null
    const tag = node.tagName.toLowerCase()
    if (droppedTags.has(tag)) return null
    const children = Array.from(node.childNodes).map(render)
    if (!keptTags.has(tag)) return children
    if (tag === 'br') return createElement('br', { key })
    const href = node.getAttribute('href')
    if (tag === 'a') {
      return createElement(
        'a',
        { key, href: safeHref(href), rel: 'noreferrer', className: 'underline underline-offset-4' },
        children,
      )
    }
    return createElement(tag, { key }, children)
  }
  return Array.from(document.body.childNodes).map(render)
}

function safeHref(href: string | null): string | undefined {
  if (!href) return undefined
  try {
    const url = new URL(href, window.location.href)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
    return undefined
  }
}
