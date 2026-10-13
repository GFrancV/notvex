// @vitest-environment jsdom
import { createElement } from 'react'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A render error with no boundary unmounts the whole tree and leaves a blank window.

const SENTINEL = 'SENTINEL-7f3a'

const ipc = vi.hoisted(() => ({ error: vi.fn(), reloadWindow: vi.fn() }))

vi.mock('@/lib/ipc', () => ({
  notvex: { log: { error: ipc.error }, app: { reloadWindow: ipc.reloadWindow } }
}))

const { ErrorBoundary } = await import('@/components/ErrorBoundary')

function Thrower(): never {
  throw new TypeError(`render failed ${SENTINEL}`)
}

beforeEach(() => {
  ipc.error.mockReset().mockResolvedValue({ success: true, data: null })
  ipc.reloadWindow.mockReset().mockResolvedValue({ success: true, data: true })
  // React logs every caught render error to console.error; that noise isn't under test.
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    render(createElement(ErrorBoundary, null, createElement('p', null, 'all good')))
    expect(screen.getByText('all good')).toBeTruthy()
  })

  it('shows the fallback instead of a blank window when a child throws', () => {
    render(createElement(ErrorBoundary, null, createElement(Thrower)))

    expect(screen.getByRole('alert').textContent).toMatch(/something went wrong/i)
    expect(document.body.textContent).not.toContain(SENTINEL)
  })

  it('reports the error once, by name and stack', () => {
    render(createElement(ErrorBoundary, null, createElement(Thrower)))

    expect(ipc.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ name: 'TypeError' })
    )
  })

  it('reloads through main, which locks the vault first', () => {
    render(createElement(ErrorBoundary, null, createElement(Thrower)))

    fireEvent.click(screen.getByRole('button', { name: /reload/i }))

    expect(ipc.reloadWindow).toHaveBeenCalledTimes(1)
  })

  // The Toaster lives inside the crashed App, so the fallback has to say it itself.
  it.each([
    ['the vault could only be locked', { success: true, data: false }],
    ['main refused the reload', { success: false, error: 'busy' }]
  ])('asks to try again when %s', async (_label, result) => {
    ipc.reloadWindow.mockResolvedValue(result)
    render(createElement(ErrorBoundary, null, createElement(Thrower)))

    fireEvent.click(screen.getByRole('button', { name: /reload/i }))

    expect(await screen.findByText(/couldn't reload yet/i)).toBeTruthy()
  })

  it('offers to report the bug from the fallback', () => {
    render(createElement(ErrorBoundary, null, createElement(Thrower)))

    expect(screen.getByRole('button', { name: /report bug/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /copy debug info/i })).toBeTruthy()
  })
})
