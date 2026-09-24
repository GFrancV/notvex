// @vitest-environment jsdom
import { createElement } from 'react'

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
// No @testing-library/jest-dom in this repo — stick to plain queries/assertions.
import { afterEach, describe, expect, it, vi } from 'vitest'

type RequiredCallback = (data: { vaultPath: string }) => void

const ipc = vi.hoisted(() => ({
  onDevBuildWarningRequired: vi.fn<(cb: RequiredCallback) => () => void>(),
  confirmDevBuildWarning: vi.fn(),
  cancelDevBuildWarning: vi.fn()
}))

vi.mock('@/lib/ipc', () => ({
  notvex: {
    // AppLogo renders via useIsDev(), which calls this on mount.
    app: { isDev: vi.fn().mockResolvedValue({ success: true, data: false }) },
    vault: {
      onDevBuildWarningRequired: ipc.onDevBuildWarningRequired,
      confirmDevBuildWarning: ipc.confirmDevBuildWarning,
      cancelDevBuildWarning: ipc.cancelDevBuildWarning
    }
  }
}))

const { DevBuildWarningDialog } = await import('@/components/dialogs/DevBuildWarningDialog')

const TEST_VAULT_PATH = '/vaults/real-notes.nvx'
const DIALOG_TITLE = /Opening a real vault in a development build/i

// Captures the callback the component registers, so tests can fire it
// directly instead of going through a real IPC round-trip. Renders and
// triggers the warning in one step since every test needs the dialog open
// before it can act.
async function renderOpenDialog(): Promise<void> {
  let trigger: RequiredCallback | undefined
  ipc.onDevBuildWarningRequired.mockImplementation((cb) => {
    trigger = cb
    return () => {}
  })
  render(createElement(DevBuildWarningDialog))
  trigger?.({ vaultPath: TEST_VAULT_PATH })
  await screen.findByText(DIALOG_TITLE)
}

describe('DevBuildWarningDialog (issue #34)', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('shows the vault path once vault:dev-build-warning-required fires', async () => {
    await renderOpenDialog()

    expect(screen.getByText(TEST_VAULT_PATH)).not.toBeNull()
  })

  it('calls confirmDevBuildWarning(), not cancelDevBuildWarning(), when "Open anyway" is clicked', async () => {
    ipc.confirmDevBuildWarning.mockResolvedValue({ success: true, data: null })
    await renderOpenDialog()

    fireEvent.click(screen.getByRole('button', { name: /open anyway/i }))

    await waitFor(() => expect(ipc.confirmDevBuildWarning).toHaveBeenCalledTimes(1))
    expect(ipc.cancelDevBuildWarning).not.toHaveBeenCalled()
  })

  it('calls cancelDevBuildWarning(), not confirmDevBuildWarning(), when "Cancel" is clicked', async () => {
    ipc.cancelDevBuildWarning.mockResolvedValue({ success: true, data: null })
    await renderOpenDialog()

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))

    await waitFor(() => expect(ipc.cancelDevBuildWarning).toHaveBeenCalledTimes(1))
    expect(ipc.confirmDevBuildWarning).not.toHaveBeenCalled()
  })
})
