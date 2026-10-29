// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []
const flushAllPending = vi.hoisted(() => vi.fn())

vi.mock('@/lib/pending-save', () => ({ flushAllPending }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const { ExportWarningDialog } = await import('@/components/dialogs/ExportWarningDialog')
const { toast } = await import('sonner')

function renderDialog(): {
  onConfirm: ReturnType<typeof vi.fn>
  onOpenChange: ReturnType<typeof vi.fn>
} {
  flushAllPending.mockImplementation(async () => void calls.push('flush'))
  const onConfirm = vi.fn(async () => void calls.push('export'))
  const onOpenChange = vi.fn()
  render(
    createElement(ExportWarningDialog, {
      open: true,
      onOpenChange,
      title: 'Export note',
      onConfirm
    })
  )
  return { onConfirm, onOpenChange }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  calls.length = 0
})

describe('ExportWarningDialog', () => {
  it('warns that the exported files are not encrypted', () => {
    renderDialog()

    expect(screen.getByText('Export note')).not.toBeNull()
    expect(screen.getByText(/not encrypted/i)).not.toBeNull()
  })

  it('exports nothing on Cancel', () => {
    const { onConfirm, onOpenChange } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(flushAllPending).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('saves pending edits before exporting, then closes', async () => {
    const { onOpenChange } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(calls).toEqual(['flush', 'export'])
  })

  it('waits for pending edits to finish saving before exporting', async () => {
    const { onConfirm } = renderDialog()
    let finishSaving = (): void => {}
    flushAllPending.mockImplementation(() => new Promise<void>((r) => (finishSaving = r)))

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    await act(async () => {})
    expect(onConfirm).not.toHaveBeenCalled()

    await act(async () => finishSaving())
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('exports nothing and says so when pending edits fail to save', async () => {
    const { onConfirm, onOpenChange } = renderDialog()
    flushAllPending.mockRejectedValue(new Error('disk full'))

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(
      "Your latest edits couldn't be saved, so nothing was exported"
    )
  })
})
