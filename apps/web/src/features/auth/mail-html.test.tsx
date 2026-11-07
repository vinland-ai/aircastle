import { render } from '@testing-library/react'
import { it, expect } from 'vite-plus/test'
import { renderMailHtml } from './mail-html'

it.each([
  ['<script>bad()</script><p>Safe</p>', '<p>Safe</p>'],
  ['<style>bad</style><iframe>bad</iframe><p>Safe</p>', '<p>Safe</p>'],
  ['<custom-tag><strong>Safe</strong></custom-tag>', '<strong>Safe</strong>'],
  ['<p onclick="bad()" style="color:red"><em>Safe</em></p>', '<p><em>Safe</em></p>'],
  [
    '<a href="javascript:bad()">Safe</a>',
    '<a rel="noreferrer" class="underline underline-offset-4">Safe</a>',
  ],
  [
    '<a href="data:text/html,bad">Safe</a>',
    '<a rel="noreferrer" class="underline underline-offset-4">Safe</a>',
  ],
])('renders safe mail HTML %s', (html, expected) => {
  const { container } = render(<>{renderMailHtml(html)}</>)
  expect(container.innerHTML).toBe(expected)
})
