// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, render, screen } from '@testing-library/react'
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

afterEach(cleanup)

describe('UpdateAvailableDialog', () => {
  it('reports a failed update as the alert that describes the dialog', async () => {
    render(createElement(UpdateAvailableDialog))
    act(() => listeners.available?.({ version: '9.9.9', releaseNotes: null }))
    act(() => listeners.error?.({ message: 'Network unreachable' }))

    expect((await screen.findByRole('alert')).textContent).toMatch(/network unreachable/i)
    expect(screen.getByRole('dialog', { description: /network unreachable/i })).toBeTruthy()
  })
})
