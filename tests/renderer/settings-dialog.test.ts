// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({ getHasKeyFile: vi.fn() }))

vi.mock('@/lib/ipc', () => ({
  notvex: { vault: { getHasKeyFile: ipc.getHasKeyFile } }
}))

const { SettingsDialog } = await import('@/components/settings-dialog')
const { usePrefsStore } = await import('@/store/prefs.store')

const setPref = vi.fn(async () => undefined)
const onOpenChange = vi.fn()

async function renderDialog(): Promise<void> {
  await act(async () => {
    render(createElement(SettingsDialog, { open: true, onOpenChange }))
  })
}

const tab = (name: string): HTMLElement => screen.getByRole('tab', { name })

beforeEach(() => {
  ipc.getHasKeyFile.mockResolvedValue({ success: true, data: false })
  usePrefsStore.setState({ setPref, lockOnMinimize: false, checkUpdatesOnStartup: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SettingsDialog', () => {
  it('opens on Security', async () => {
    await renderDialog()

    expect(tab('Security').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel').textContent).toMatch(/auto-lock/i)
  })

  it('names every section in a vertical tab list', async () => {
    await renderDialog()

    expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe('vertical')
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Security', 'Updates'])
  })

  it('switches sections with the arrow keys', async () => {
    await renderDialog()

    fireEvent.keyDown(tab('Security'), { key: 'ArrowDown' })

    // Radix moves focus to the next tab on a timeout, and focus is what activates it.
    await waitFor(() => expect(tab('Updates').getAttribute('aria-selected')).toBe('true'))
    expect(screen.getByRole('tabpanel').textContent).toMatch(/check for updates on startup/i)
  })

  it('switches sections on click', async () => {
    await renderDialog()

    // Radix tabs activate on mousedown, not click.
    fireEvent.mouseDown(tab('Updates'))

    expect(tab('Updates').getAttribute('aria-selected')).toBe('true')
  })

  it('saves a Security setting', async () => {
    await renderDialog()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Lock when minimized' }))

    expect(setPref).toHaveBeenCalledWith('lockOnMinimize', true)
  })

  it('saves the Updates setting', async () => {
    await renderDialog()
    fireEvent.mouseDown(tab('Updates'))

    fireEvent.click(screen.getByRole('checkbox', { name: 'Check for updates on startup' }))

    expect(setPref).toHaveBeenCalledWith('checkUpdatesOnStartup', false)
  })

  it('hands off to Change password by closing itself', async () => {
    await renderDialog()

    fireEvent.click(screen.getByRole('button', { name: /change password/i }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.getByRole('heading', { name: 'Change password' })).toBeTruthy()
  })
})
