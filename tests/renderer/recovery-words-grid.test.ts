// @vitest-environment jsdom
import { createElement } from 'react'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The recovery key grants full access to the vault: its copy is the one main always clears,
// and the user is told what copying risks before they press the button.

const ipc = vi.hoisted(() => ({ write: vi.fn(), openExternal: vi.fn() }))

vi.mock('@/lib/ipc', () => ({
  notvex: {
    clipboard: { write: ipc.write },
    shell: { openExternal: ipc.openExternal }
  }
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { RecoveryWordsGrid } = await import('@/components/recovery-words-grid')

const MNEMONIC = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima'

beforeEach(() => {
  ipc.write.mockReset().mockResolvedValue({ success: true, data: null })
  ipc.openExternal.mockReset().mockResolvedValue({ success: true, data: null })
})

afterEach(cleanup)

describe('RecoveryWordsGrid', () => {
  it('copies the key through main as a secret', async () => {
    render(createElement(RecoveryWordsGrid, { mnemonic: MNEMONIC }))

    fireEvent.click(screen.getByRole('button', { name: /copy to clipboard/i }))

    await waitFor(() =>
      expect(ipc.write).toHaveBeenCalledExactlyOnceWith(MNEMONIC, { secret: true })
    )
    expect(await screen.findByRole('button', { name: /copied/i })).toBeTruthy()
  })

  it('tells the user what copying risks and what Notvex does about it', () => {
    render(createElement(RecoveryWordsGrid, { mnemonic: MNEMONIC }))

    expect(screen.getByText(/can be read by other apps until it's cleared/i)).toBeTruthy()
    expect(screen.getByText(/clears it after 30 s/i)).toBeTruthy()
  })

  it('links to the security practices page and says it leaves the app', () => {
    render(createElement(RecoveryWordsGrid, { mnemonic: MNEMONIC }))

    fireEvent.click(
      screen.getByRole('button', { name: 'How Notvex protects copies (opens in your browser)' })
    )

    expect(ipc.openExternal).toHaveBeenCalledExactlyOnceWith(
      'https://notvex.vercel.app/docs/security-practices'
    )
  })
})
