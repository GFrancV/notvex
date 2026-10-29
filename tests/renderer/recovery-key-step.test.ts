// @vitest-environment jsdom
import { createElement } from 'react'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ipc', () => ({ notvex: { clipboard: { write: vi.fn() } } }))

const { RecoveryKeyStep } = await import('@/components/RecoveryKeyStep')

const MNEMONIC = Array.from({ length: 24 }, (_, i) => `word${i}`).join(' ')

afterEach(cleanup)

function renderStep(props: Partial<Parameters<typeof RecoveryKeyStep>[0]> = {}): {
  onConfirm: ReturnType<typeof vi.fn>
} {
  const onConfirm = vi.fn()
  render(
    createElement(RecoveryKeyStep, {
      mnemonic: MNEMONIC,
      context: 'Your recovery key has changed and the previous one no longer works.',
      confirmLabel: 'Done',
      onConfirm,
      ...props
    })
  )
  return { onConfirm }
}

describe('RecoveryKeyStep', () => {
  it('shows the words, the context line and the shared advice', () => {
    renderStep()

    expect(screen.getByText('word23')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe(
      "Your recovery key has changed and the previous one no longer works. Write it down by hand or copy it on a device you trust, and keep it somewhere safe. It won't be shown again."
    )
  })

  it('confirms only once the key is marked as saved', () => {
    const { onConfirm } = renderStep()
    const done = screen.getByRole('button', { name: 'Done' }) as HTMLButtonElement

    expect(done.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('Recovery key saved somewhere safe'))
    expect(done.disabled).toBe(false)

    fireEvent.click(done)
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('shows an extra note when given one', () => {
    renderStep({ note: 'Your key file has not changed.' })

    expect(screen.getByText('Your key file has not changed.')).toBeTruthy()
  })
})
