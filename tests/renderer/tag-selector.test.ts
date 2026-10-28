// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { type Tag, TAG_NAME_MAX } from '@shared/types'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const { RemoveTagSelector, TagSelector } = await import('@/components/tags/TagSelector')
const { useVaultStore } = await import('@/store/vault.store')
const { toast } = await import('sonner')

const tag = (id: string, name: string): Tag => ({ id, name, color: '#fff', createdAt: 0 })
const WORK = tag('t-work', 'work')
const WORKOUT = tag('t-workout', 'workout')
const HOME = tag('t-home', 'home')

const addTagToNote = vi.fn(async (): Promise<void> => undefined)
const createTagAndAssign = vi.fn(async (): Promise<Tag> => tag('t-new', 'new'))
const onOpenChange = vi.fn()

beforeAll(() => {
  // cmdk measures and scrolls its list, and Radix positions the popover; jsdom does neither.
  globalThis.ResizeObserver ??= class {
    observe = (): void => {}
    unobserve = (): void => {}
    disconnect = (): void => {}
  }
  Element.prototype.scrollIntoView ??= (): void => {}
})

beforeEach(() => {
  useVaultStore.setState({
    tags: [WORK, WORKOUT, HOME],
    noteTagsMap: { n1: [HOME.id] },
    addTagToNote,
    createTagAndAssign
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function openAdd(): void {
  render(
    createElement(
      TagSelector,
      { noteId: 'n1', open: true, onOpenChange },
      createElement('button', null, 'Add tag')
    )
  )
}

const search = (): HTMLElement => screen.getByRole('combobox', { name: 'Search tags' })
const options = (): string[] => screen.queryAllByRole('option').map((o) => o.textContent ?? '')

async function press(key: string): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(search(), { key })
  })
}

describe('TagSelector', () => {
  it('offers the tags the note doesn’t have yet', () => {
    openAdd()

    expect(options()).toEqual(['work', 'workout'])
    expect(search().getAttribute('maxlength')).toBe(String(TAG_NAME_MAX))
  })

  it('filters as you type and assigns the highlighted tag on Enter', async () => {
    openAdd()

    fireEvent.change(search(), { target: { value: 'workout' } })
    await press('Enter')

    expect(addTagToNote).toHaveBeenCalledExactlyOnceWith('n1', WORKOUT.id)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('walks the list with the arrow keys', async () => {
    openAdd()

    await press('ArrowDown')
    await press('Enter')

    expect(addTagToNote).toHaveBeenCalledExactlyOnceWith('n1', WORKOUT.id)
  })

  it('creates the tag on Enter when nothing matches', async () => {
    openAdd()

    fireEvent.change(search(), { target: { value: 'errands' } })
    expect(options()).toEqual(['Create “errands”'])
    await press('Enter')

    expect(createTagAndAssign).toHaveBeenCalledExactlyOnceWith('n1', {
      name: 'errands',
      color: expect.any(String)
    })
    expect(addTagToNote).not.toHaveBeenCalled()
  })

  it('offers no Create for a name that already exists', () => {
    openAdd()

    fireEvent.change(search(), { target: { value: 'home' } })

    expect(options()).toEqual([])
  })

  it('shows the error and stays open when assigning fails', async () => {
    addTagToNote.mockRejectedValueOnce(new Error('Failed to assign tag'))
    openAdd()

    await press('Enter')

    expect(toast.error).toHaveBeenCalledWith('Failed to assign tag')
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('closes on Escape without assigning', async () => {
    openAdd()

    await press('Escape')

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(addTagToNote).not.toHaveBeenCalled()
  })
})

describe('RemoveTagSelector', () => {
  it('removes the picked tag', () => {
    const onRemove = vi.fn()
    render(
      createElement(
        RemoveTagSelector,
        { tags: [WORK, HOME], open: true, onOpenChange, onRemove },
        createElement('div', null, 'tags row')
      )
    )

    fireEvent.click(screen.getByRole('option', { name: 'home' }))

    expect(onRemove).toHaveBeenCalledExactlyOnceWith(HOME.id)
  })
})
