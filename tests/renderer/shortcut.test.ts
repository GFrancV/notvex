// @vitest-environment jsdom
import { createElement } from 'react'

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({ notvex: { platform: 'win32' } }))
vi.mock('@/lib/ipc', () => ipc)

const { formatShortcut } = await import('@/lib/shortcut')
const { Shortcut } = await import('@/components/Shortcut')

afterEach(() => {
  cleanup()
  ipc.notvex.platform = 'win32'
})

describe('formatShortcut', () => {
  it('spells modifiers out on Windows and Linux', () => {
    expect(formatShortcut('Mod-Shift-e')).toEqual(['Ctrl', 'Shift', 'E'])
    ipc.notvex.platform = 'linux'
    expect(formatShortcut('Mod-Alt-m')).toEqual(['Ctrl', 'Alt', 'M'])
  })

  it('uses the macOS symbols on macOS', () => {
    ipc.notvex.platform = 'darwin'
    expect(formatShortcut('Mod-Shift-e')).toEqual(['⌘', '⇧', 'E'])
    expect(formatShortcut('Shift-Alt-m')).toEqual(['⇧', '⌥', 'M'])
  })

  it('keeps named keys, digits and punctuation', () => {
    expect(formatShortcut('Shift-Enter')).toEqual(['Shift', 'Enter'])
    expect(formatShortcut('Escape')).toEqual(['Esc'])
    expect(formatShortcut('Mod-Shift-1')).toEqual(['Ctrl', 'Shift', '1'])
    expect(formatShortcut('Mod-Shift-.')).toEqual(['Ctrl', 'Shift', '.'])
  })
})

describe('<Shortcut>', () => {
  it('renders one key per label', () => {
    const { container } = render(createElement(Shortcut, { keys: 'Mod-Shift-f' }))

    const keys = [...container.querySelectorAll('[data-slot="kbd"]')].map((k) => k.textContent)
    expect(keys).toEqual(['Ctrl', 'Shift', 'F'])
  })

  it('reads as separate keys', () => {
    const { container } = render(createElement(Shortcut, { keys: 'Mod-Shift-f' }))

    expect(container.textContent).toBe('Ctrl Shift F')
  })
})
