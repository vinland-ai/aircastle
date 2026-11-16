import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, vi, type MockInstance } from 'vite-plus/test'

const invalidNesting = /cannot be a descendant of|cannot contain a nested|cannot be a child of/

let nestingErrors: string[] = []
let consoleErrors: MockInstance<typeof console.error> | undefined

beforeEach(() => {
  nestingErrors = []
  const report = console.error
  consoleErrors = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const message = args.map(String).join(' ')
    if (invalidNesting.test(message)) nestingErrors.push(message)
    report(...args)
  })
})

afterEach(() => {
  cleanup()
  consoleErrors?.mockRestore()
  expect(nestingErrors, 'React reported invalid HTML nesting').toEqual([])
})
