// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DownloadProgress, UpdateInfo } from '@shared/types'

type Listener<T> = (data: T) => void

const info: UpdateInfo = {
  version: '9.9.9',
  releaseNotes: null,
  summary: null,
  security: false,
  releaseDate: null,
  size: null,
  releaseUrl: 'https://github.com/GFrancV/notvex/releases/tag/v9.9.9'
}

const listeners = vi.hoisted(() => ({
  available: undefined as Listener<UpdateInfo> | undefined,
  progress: undefined as Listener<DownloadProgress> | undefined,
  error: undefined as Listener<{ message: string }> | undefined
}))

const openExternal = vi.hoisted(() => vi.fn())
const exits = vi.hoisted(() => ({ snooze: vi.fn(), dismiss: vi.fn() }))
const download = vi.hoisted(() => vi.fn())

vi.mock('@/lib/ipc', () => ({
  notvex: {
    shell: { openExternal },
    // AppLogo renders via useIsDev(), which calls this on mount.
    app: { isDev: vi.fn().mockResolvedValue({ success: true, data: false }) },
    updater: {
      onUpdateAvailable: (cb: Listener<UpdateInfo>) => {
        listeners.available = cb
        return () => {}
      },
      onDownloadProgress: (cb: Listener<DownloadProgress>) => {
        listeners.progress = cb
        return () => {}
      },
      onUpdateDownloaded: () => () => {},
      onError: (cb: Listener<{ message: string }>) => {
        listeners.error = cb
        return () => {}
      },
      checkOnStartup: vi.fn(),
      snooze: exits.snooze,
      dismiss: exits.dismiss,
      download,
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
    act(() => listeners.available?.(info))
    act(() => listeners.error?.({ message: 'Network unreachable' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/network unreachable/i)
    expect(screen.getByRole('dialog', { description: /network unreachable/i })).toBeTruthy()
  })

  it('does not open while ready is false, even after a long wait', () => {
    vi.useFakeTimers()
    render(createElement(UpdateAvailableDialog, { ready: false }))
    act(() => listeners.available?.(info))
    act(() => vi.advanceTimersByTime(60_000))

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens after 1500 ms without input once ready', () => {
    vi.useFakeTimers()
    render(createElement(UpdateAvailableDialog, { ready: true }))
    act(() => listeners.available?.(info))

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
    act(() => listeners.available?.(info))

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
    act(() => listeners.available?.(info))
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
    act(() => listeners.available?.(info))
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

describe('UpdateAvailableDialog content', () => {
  function openWith(overrides: Partial<UpdateInfo>): void {
    vi.useFakeTimers()
    render(createElement(UpdateAvailableDialog, { ready: true }))
    act(() => listeners.available?.({ ...info, ...overrides }))
    act(() => vi.advanceTimersByTime(1500))
  }

  it('shows the in-app summary, release date, size and a release notes link', () => {
    openWith({
      summary: 'Faster search.\n\n- Highlight one',
      releaseNotes: '<p>Full release prose</p>',
      releaseDate: '2026-11-01T12:00:00.000Z',
      size: 104857600
    })

    expect(
      screen.getByRole('dialog', { description: 'Released Nov 1, 2026 · 100 MB' })
    ).toBeTruthy()
    expect(screen.getByText('Faster search.')).toBeTruthy()
    expect(screen.getByRole('listitem').textContent).toBe('Highlight one')
    expect(screen.queryByText('Full release prose')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Release notes (opens in your browser)' })
    ).toBeTruthy()
  })

  it.each([
    [true, 1],
    [false, 0]
  ])('with security %s shows %i security badge', (security, count) => {
    openWith({ security })

    expect(screen.queryAllByText('Security fixes')).toHaveLength(count)
  })

  it('renders HTML in the summary as text, not as elements', () => {
    const html =
      '<script>window.x = 1</script><img src="x" onerror="window.x = 1"><iframe src="https://example.com"></iframe>'
    openWith({ summary: `Before ${html} after` })

    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelector('script, img, iframe')).toBeNull()
    expect(dialog.querySelector('[onerror]')).toBeNull()
    expect(screen.getByText(`Before ${html} after`)).toBeTruthy()
  })

  it('does not render Markdown images in the summary', () => {
    openWith({ summary: 'See ![diagram](https://example.com/x.png) here' })

    expect(screen.getByRole('dialog').querySelector('img')).toBeNull()
  })

  it('renders only https links in the summary as links', () => {
    openWith({
      summary: '[safe](https://example.com) [plain](http://example.com) [bad](javascript:alert(1))'
    })

    expect(screen.getByRole('button', { name: 'safe (opens in your browser)' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'plain' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'bad' })).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText(/plain bad/).textContent).toBe('safe (opens in your browser) plain bad')
  })

  it('opens the release notes link and summary links via shell.openExternal', () => {
    openExternal.mockClear()
    openWith({ summary: 'See [the docs](https://example.com/docs).' })

    fireEvent.click(screen.getByRole('button', { name: 'the docs (opens in your browser)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Release notes (opens in your browser)' }))

    expect(openExternal.mock.calls).toEqual([
      ['https://example.com/docs'],
      ['https://github.com/GFrancV/notvex/releases/tag/v9.9.9']
    ])
  })

  it('"Remind me later" snoozes the version', () => {
    exits.snooze.mockClear()
    exits.dismiss.mockClear()
    openWith({})

    fireEvent.click(screen.getByRole('button', { name: 'Remind me later' }))

    expect(exits.snooze).toHaveBeenCalledExactlyOnceWith('9.9.9')
    expect(exits.dismiss).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // A click outside reaches the same onOpenChange(false) through Radix; jsdom can't simulate it.
  it('closing the dialog with Escape dismisses it for the session', () => {
    exits.snooze.mockClear()
    exits.dismiss.mockClear()
    openWith({})

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(exits.dismiss).toHaveBeenCalledExactlyOnceWith('9.9.9')
    expect(exits.snooze).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('download progress shows downloaded and total MB alongside the percentage', () => {
    openWith({})
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }))

    act(() =>
      listeners.progress?.({
        percent: 11,
        bytesPerSecond: 1,
        transferred: 12.4 * 1024 * 1024,
        total: 111 * 1024 * 1024
      })
    )

    expect(screen.getByText('12.4 MB of 111 MB')).toBeTruthy()
    expect(screen.getByText('11%')).toBeTruthy()
  })

  it('a failed download keeps the dialog open with the error and a Retry button', () => {
    openWith({})
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }))

    act(() => listeners.error?.({ message: "Couldn't download the update" }))

    expect(screen.getByRole('dialog', { description: "Couldn't download the update" })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('Retry starts the download again', () => {
    download.mockClear()
    openWith({})
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }))
    act(() => listeners.error?.({ message: "Couldn't download the update" }))

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(download).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Download progress')).toBeTruthy()
  })

  it('a failed check (not a download) shows no Retry button', () => {
    openWith({})

    act(() => listeners.error?.({ message: "Couldn't check for updates" }))

    expect(screen.getByRole('dialog', { description: "Couldn't check for updates" })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('without a summary, shows the sanitized full release notes', () => {
    openWith({
      summary: null,
      releaseNotes: '<p>Full release prose</p><script>window.x = 1</script><img src="x" />'
    })

    const dialog = screen.getByRole('dialog')
    expect(screen.getByText('Full release prose')).toBeTruthy()
    expect(dialog.querySelector('script, img')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Release notes (opens in your browser)' })
    ).toBeTruthy()
  })
})
