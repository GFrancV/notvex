// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { UpdateInfo } from '@shared/types'

type Listener<T> = (data: T) => void

const listeners = vi.hoisted(() => ({
  available: undefined as Listener<UpdateInfo> | undefined,
  error: undefined as Listener<{ message: string }> | undefined
}))

vi.mock('@/lib/ipc', () => ({
  notvex: {
    // AppLogo renders via useIsDev(), which calls this on mount.
    app: { isDev: vi.fn().mockResolvedValue({ success: true, data: false }) },
    updater: {
      onUpdateAvailable: (cb: Listener<UpdateInfo>) => {
        listeners.available = cb
        return () => {}
      },
      onDownloadProgress: () => () => {},
      onUpdateDownloaded: () => () => {},
      onError: (cb: Listener<{ message: string }>) => {
        listeners.error = cb
        return () => {}
      },
      checkOnStartup: vi.fn(),
      download: vi.fn(),
      installNow: vi.fn()
    }
  }
}))

const { UpdateAvailableDialog } = await import('@/components/dialogs/UpdateAvailableDialog')

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('UpdateAvailableDialog', () => {
  it('reports a failed update as the alert that describes the dialog', async () => {
    render(createElement(UpdateAvailableDialog, { ready: true }))
    act(() => listeners.available?.({ version: '9.9.9', releaseNotes: null }))
    act(() => listeners.error?.({ message: 'Network unreachable' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/network unreachable/i)
    expect(screen.getByRole('dialog', { description: /network unreachable/i })).toBeTruthy()
  })

  it('does not open while ready is false, even after a long wait', () => {
    vi.useFakeTimers()
    render(createElement(UpdateAvailableDialog, { ready: false }))
    act(() => listeners.available?.({ version: '9.9.9', releaseNotes: null }))
    act(() => vi.advanceTimersByTime(60_000))

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens after 1500 ms without input once ready', () => {
    vi.useFakeTimers()
    render(createElement(UpdateAvailableDialog, { ready: true }))
    act(() => listeners.available?.({ version: '9.9.9', releaseNotes: null }))

    act(() => vi.advanceTimersByTime(1499))
    expect(screen.queryByRole('dialog')).toBeNull()

    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it.each([
    ['keydown', () => fireEvent.keyDown(document.body, { key: 'a' })],
    ['pointerdown', () => fireEvent.pointerDown(document.body)]
  ])('restarts the 1500 ms count on %s while waiting', (_name, input) => {
    vi.useFakeTimers()
    render(createElement(UpdateAvailableDialog, { ready: true }))
    act(() => listeners.available?.({ version: '9.9.9', releaseNotes: null }))

    act(() => vi.advanceTimersByTime(1000))
    act(() => void input())
    act(() => vi.advanceTimersByTime(1499))
    expect(screen.queryByRole('dialog')).toBeNull()

    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('waits 1500 ms after unlock for an update found before it', () => {
    vi.useFakeTimers()
    const { rerender } = render(createElement(UpdateAvailableDialog, { ready: false }))
    act(() => listeners.available?.({ version: '9.9.9', releaseNotes: null }))
    act(() => vi.advanceTimersByTime(5000))
    rerender(createElement(UpdateAvailableDialog, { ready: true }))

    act(() => vi.advanceTimersByTime(1499))
    expect(screen.queryByRole('dialog')).toBeNull()

    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('waits again after the view leaves and returns to ready', () => {
    vi.useFakeTimers()
    const { rerender } = render(createElement(UpdateAvailableDialog, { ready: true }))
    act(() => listeners.available?.({ version: '9.9.9', releaseNotes: null }))
    act(() => vi.advanceTimersByTime(1500))
    expect(screen.getByRole('dialog')).toBeTruthy()

    rerender(createElement(UpdateAvailableDialog, { ready: false }))
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(createElement(UpdateAvailableDialog, { ready: true }))

    act(() => vi.advanceTimersByTime(1499))
    expect(screen.queryByRole('dialog')).toBeNull()

    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})
