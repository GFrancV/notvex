// @vitest-environment jsdom
import { createElement } from 'react'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_KDF_LEVEL_ID } from '@shared/kdf-levels'

const openExternal = vi.fn()
const measureKdfLevel = vi.fn()
vi.mock('@/lib/ipc', () => ({ notvex: { shell: { openExternal }, vault: { measureKdfLevel } } }))

const { KdfLevelChooser } = await import('@/components/KdfLevelChooser')

// A measurement that never answers, unless a test says otherwise.
beforeEach(() => {
  measureKdfLevel.mockReturnValue(new Promise(() => undefined))
})

afterEach(() => {
  cleanup()
  openExternal.mockReset()
  measureKdfLevel.mockReset()
})

function renderChooser(): void {
  render(createElement(KdfLevelChooser, { value: DEFAULT_KDF_LEVEL_ID, onChange: vi.fn() }))
}

describe('KdfLevelChooser', () => {
  it('shows the key derivation section closed, with the 256 MiB level as recommended', () => {
    renderChooser()

    const trigger = screen.getByRole('button', { name: /Key derivation/ })

    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.textContent).toContain('256 MiB (recommended)')
  })

  it('opens onto the four levels, the chosen one checked, and a link to the documentation', () => {
    renderChooser()

    fireEvent.click(screen.getByRole('button', { name: /Key derivation/ }))

    const names = [/^64 MiB/, /^128 MiB/, /^256 MiB \(recommended\)/, /^512 MiB/]
    expect(screen.getAllByRole('radio')).toHaveLength(4)
    const checked = names.map(
      (name) => screen.getByRole('radio', { name }).getAttribute('aria-checked') === 'true'
    )
    expect(checked).toEqual([false, false, true, false])

    expect(screen.getByText('Least memory, fastest unlock')).toBeTruthy()
    expect(
      screen.getByText('Balances unlock time and resistance to guessing on most computers')
    ).toBeTruthy()
    expect(screen.getByText('Most memory, slowest unlock')).toBeTruthy()

    fireEvent.click(
      screen.getByRole('button', { name: 'How to choose a level (opens in your browser)' })
    )
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(
      'https://notvex.vercel.app/docs/security-practices#key-derivation'
    )
  })

  it('measures 64 MiB once on opening and extrapolates the other estimates by memory', async () => {
    measureKdfLevel.mockResolvedValue({ success: true, data: { status: 'measured', ms: 400 } })
    renderChooser()
    expect(measureKdfLevel).not.toHaveBeenCalled()

    const trigger = screen.getByRole('button', { name: /Key derivation/ })
    fireEvent.click(trigger)
    fireEvent.click(trigger)
    fireEvent.click(trigger)

    // 400 ms at 64 MiB: twice, four times and eight times the memory take proportionally longer.
    await screen.findByRole('radio', {
      name: /^64 MiB Least memory, fastest unlock · 0\.4 s to unlock on this computer$/
    })
    expect(
      screen.getByRole('radio', { name: /^128 MiB about 0\.8 s to unlock on this computer$/ })
    ).toBeTruthy()
    expect(
      screen.getByRole('radio', {
        name: /^256 MiB \(recommended\) Balances .* computers · about 1\.6 s to unlock on this computer$/
      })
    ).toBeTruthy()
    expect(
      screen.getByRole('radio', {
        name: /^512 MiB Most memory, slowest unlock · about 3\.2 s to unlock on this computer$/
      })
    ).toBeTruthy()
    expect(measureKdfLevel).toHaveBeenCalledExactlyOnceWith(7)
  })
})
