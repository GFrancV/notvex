// @vitest-environment jsdom
import { createElement } from 'react'

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

// The unlock time shown on a level's card: "0.4 s" measured, "~0.8 s" estimated.
function timeOf(level: RegExp): string | null {
  const card = screen.getByRole('radio', { name: level }).closest('label')
  return card && (within(card).queryByText(/^~?\d+\.\d s$/)?.textContent ?? null)
}

// Whether a level's card shows the spinner that stands in for its time while it is measured.
function spinning(level: RegExp): boolean {
  const card = screen.getByRole('radio', { name: level }).closest('label')
  return card?.querySelector('.animate-spin') != null
}

// Presses "Measure all levels" once it is offered: it waits while the opening measurement runs.
async function measureAll(): Promise<void> {
  const button = screen.getByRole('button', { name: 'Measure all levels' }) as HTMLButtonElement
  await waitFor(() => expect(button.disabled).toBe(false))
  fireEvent.click(button)
}

describe('KdfLevelChooser', () => {
  it('shows the key derivation section closed, with the 256 MiB level as recommended', () => {
    renderChooser()

    const trigger = screen.getByRole('button', { name: /Key derivation/ })

    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.textContent).toContain('256 MiB (recommended)')
  })

  it('names the section by its title and the chosen level, as separate words', () => {
    renderChooser()

    expect(
      screen.getByRole('button', { name: 'Key derivation 256 MiB (recommended)' })
    ).toBeTruthy()
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
    await waitFor(() => expect(timeOf(/^64 MiB/)).toBe('0.4 s'))
    expect(timeOf(/^128 MiB/)).toBe('~0.8 s')
    expect(timeOf(/^256 MiB/)).toBe('~1.6 s')
    expect(timeOf(/^512 MiB/)).toBe('~3.2 s')
    expect(measureKdfLevel).toHaveBeenCalledExactlyOnceWith(7)
  })

  it('measures every level on request, replaces each estimate and announces each result', async () => {
    // Each call waits until the test answers it, so the status can be read between levels.
    const pending: Array<(ms: number) => void> = []
    measureKdfLevel.mockImplementation(
      () =>
        new Promise((resolve) =>
          pending.push((ms) => resolve({ success: true, data: { status: 'measured', ms } }))
        )
    )
    const answer = async (ms: number): Promise<void> => {
      await waitFor(() => expect(pending.length).toBeGreaterThan(0))
      pending.shift()?.(ms)
    }
    const status = (): string | null => screen.getByRole('status').textContent
    renderChooser()
    fireEvent.click(screen.getByRole('button', { name: /Key derivation/ }))
    expect(spinning(/^64 MiB/)).toBe(true)
    await answer(400)
    await waitFor(() => expect(timeOf(/^128 MiB/)).toBe('~0.8 s'))
    expect(spinning(/^64 MiB/)).toBe(false)

    await measureAll()

    await waitFor(() => expect(status()).toBe('Measuring 64 MiB (1 of 4)'))
    // The cards show the results; the live region is only for assistive technology.
    expect(screen.getByRole('status').classList.contains('sr-only')).toBe(true)
    expect(screen.queryByText('Measured all levels')).toBeNull()
    expect((screen.getByRole('button', { name: 'Measuring…' }) as HTMLButtonElement).disabled).toBe(
      true
    )
    // Only the level in turn spins; the others keep their estimate.
    expect([/^64 MiB/, /^128 MiB/, /^256 MiB/, /^512 MiB/].map(spinning)).toEqual([
      true,
      false,
      false,
      false
    ])
    expect(timeOf(/^128 MiB/)).toBe('~0.8 s')
    await answer(500)
    await waitFor(() => expect(status()).toBe('64 MiB: 0.5 s. Measuring 128 MiB (2 of 4)'))
    expect([/^64 MiB/, /^128 MiB/].map(spinning)).toEqual([false, true])
    expect(timeOf(/^64 MiB/)).toBe('0.5 s')
    await answer(900)
    await waitFor(() => expect(status()).toBe('128 MiB: 0.9 s. Measuring 256 MiB (3 of 4)'))
    await answer(1700)
    await waitFor(() => expect(status()).toBe('256 MiB: 1.7 s. Measuring 512 MiB (4 of 4)'))
    await answer(3400)
    await waitFor(() => expect(status()).toBe('512 MiB: 3.4 s'))
    expect(screen.getByText('Measured all levels')).toBeTruthy()

    // Measured times carry no "~"; the busy button's spinner is not a second status region.
    expect([/^64 MiB/, /^128 MiB/, /^256 MiB/, /^512 MiB/].map(timeOf)).toEqual([
      '0.5 s',
      '0.9 s',
      '1.7 s',
      '3.4 s'
    ])
    expect([/^64 MiB/, /^128 MiB/, /^256 MiB/, /^512 MiB/].some(spinning)).toBe(false)
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(measureKdfLevel.mock.calls.map(([id]) => id)).toEqual([7, 7, 5, 4, 2])
    expect(screen.getByRole('button', { name: 'Measure all levels' })).toBeTruthy()
  })

  it('shows a level that cannot run as unavailable and does not let it be chosen', async () => {
    measureKdfLevel.mockImplementation((id: number) =>
      Promise.resolve({
        success: true,
        data: id === 2 ? { status: 'unavailable' } : { status: 'measured', ms: 400 }
      })
    )
    renderChooser()
    fireEvent.click(screen.getByRole('button', { name: /Key derivation/ }))

    await measureAll()

    const card = (
      await screen.findByText('Not enough memory on this computer to use this level')
    ).closest('label')
    expect(card?.textContent).toContain('512 MiB')
    const radio = screen.getByRole('radio', { name: /^512 MiB/ })
    expect((radio as HTMLButtonElement).disabled).toBe(true)
    expect(timeOf(/^512 MiB/)).toBeNull()
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('512 MiB: unavailable'))
    expect((screen.getByRole('radio', { name: /^256 MiB/ }) as HTMLButtonElement).disabled).toBe(
      false
    )
  })

  it('offers "Measure all levels" only once the opening measurement is done', async () => {
    let finish: (answer: unknown) => void = () => undefined
    measureKdfLevel.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    renderChooser()
    fireEvent.click(screen.getByRole('button', { name: /Key derivation/ }))
    const button = screen.getByRole('button', { name: 'Measure all levels' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)

    finish({ success: true, data: { status: 'measured', ms: 400 } })

    await waitFor(() => expect(button.disabled).toBe(false))
  })

  it('stops measuring the remaining levels once it is no longer shown', async () => {
    const answers: Array<(answer: unknown) => void> = []
    measureKdfLevel.mockImplementation(() => new Promise((resolve) => answers.push(resolve)))
    renderChooser()
    fireEvent.click(screen.getByRole('button', { name: /Key derivation/ }))
    answers.shift()?.({ success: true, data: { status: 'measured', ms: 400 } })
    await measureAll()
    await waitFor(() => expect(answers).toHaveLength(1))

    cleanup()
    answers.shift()?.({ success: true, data: { status: 'measured', ms: 500 } })
    await new Promise((resolve) => setTimeout(resolve, 20))

    // The opening measurement and the first level of "Measure all levels", and no more.
    expect(measureKdfLevel).toHaveBeenCalledTimes(2)
  })

  it('measures again on the next opening when the opening measurement failed', async () => {
    measureKdfLevel.mockResolvedValueOnce({ success: false, error: 'Boom' })
    measureKdfLevel.mockResolvedValue({ success: true, data: { status: 'measured', ms: 400 } })
    renderChooser()
    const trigger = screen.getByRole('button', { name: /Key derivation/ })
    fireEvent.click(trigger)
    const button = screen.getByRole('button', { name: 'Measure all levels' }) as HTMLButtonElement
    await waitFor(() => expect(button.disabled).toBe(false))
    expect(timeOf(/^64 MiB/)).toBeNull()

    fireEvent.click(trigger)
    fireEvent.click(trigger)

    await waitFor(() => expect(timeOf(/^64 MiB/)).toBe('0.4 s'))
    expect(measureKdfLevel).toHaveBeenCalledTimes(2)
  })

  it('shows a level that could not be measured in place of its time and offers to measure again', async () => {
    measureKdfLevel.mockImplementation((id: number) =>
      id === 5 || id === 4
        ? Promise.reject(new Error('IPC failed'))
        : Promise.resolve({ success: true, data: { status: 'measured', ms: 400 } })
    )
    renderChooser()
    fireEvent.click(screen.getByRole('button', { name: /Key derivation/ }))
    await waitFor(() => expect(timeOf(/^64 MiB/)).toBe('0.4 s'))

    await measureAll()

    const again = (await screen.findByRole('button', {
      name: 'Measure again'
    })) as HTMLButtonElement
    expect(again.disabled).toBe(false)
    expect(screen.queryByText('Measured all levels')).toBeNull()
    // Only the levels that failed say so, where their time would be, and no summary repeats it.
    const failedNote = (level: RegExp): boolean => {
      const card = screen.getByRole('radio', { name: level }).closest('label')
      return card !== null && within(card).queryByText("Couldn't measure") !== null
    }
    expect([/^64 MiB/, /^128 MiB/, /^256 MiB/, /^512 MiB/].map(failedNote)).toEqual([
      false,
      true,
      true,
      false
    ])
    expect(screen.queryByText(/Couldn't measure \d/)).toBeNull()
    expect([/^128 MiB/, /^256 MiB/].map(timeOf)).toEqual([null, null])
    expect(timeOf(/^512 MiB/)).toBe('0.4 s')
    // A failed measurement says nothing about whether the level fits, so it stays selectable.
    const radios = screen.getAllByRole('radio') as HTMLButtonElement[]
    expect(radios.map((r) => r.disabled)).toEqual([false, false, false, false])
  })

  it('keeps the choice fixed while the levels are measured', async () => {
    // The opening measurement answers; the ones of "Measure all levels" never do.
    measureKdfLevel.mockResolvedValueOnce({ success: true, data: { status: 'measured', ms: 400 } })
    renderChooser()
    fireEvent.click(screen.getByRole('button', { name: /Key derivation/ }))
    await waitFor(() => expect(timeOf(/^64 MiB/)).toBe('0.4 s'))

    await measureAll()

    await screen.findByRole('button', { name: 'Measuring…' })
    const disabled = screen.getAllByRole('radio').map((r) => (r as HTMLButtonElement).disabled)
    expect(disabled).toEqual([true, true, true, true])
  })

  it('moves a chosen level that turns out unavailable to the highest one that fits', async () => {
    measureKdfLevel.mockImplementation((id: number) =>
      Promise.resolve({
        success: true,
        data: id === 2 ? { status: 'unavailable' } : { status: 'measured', ms: 400 }
      })
    )
    const onChange = vi.fn()
    render(createElement(KdfLevelChooser, { value: 2, onChange }))
    fireEvent.click(screen.getByRole('button', { name: /Key derivation/ }))

    await measureAll()

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        '512 MiB: unavailable. Switched to 256 MiB'
      )
    )
    expect(onChange).toHaveBeenCalledExactlyOnceWith(4)
  })
})
