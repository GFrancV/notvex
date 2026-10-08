// @vitest-environment jsdom
import { createElement } from 'react'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Tag } from '@shared/types'

vi.mock('@/lib/ipc', () => ({ notvex: {} }))

const { TagItem } = await import('@/components/tags/TagItem')
const { SidebarMenu, SidebarProvider } = await import('@/components/ui/sidebar')
const { TagFilter } = await import('@/components/tags/TagFilter')
const { useUiStore } = await import('@/store/ui.store')
const { useVaultStore } = await import('@/store/vault.store')

const work: Tag = { id: 't-work', name: 'work', color: '#22c55e', createdAt: 0 }

beforeAll(() => {
  // SidebarProvider's mobile detection needs matchMedia, which jsdom lacks.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  })) as typeof window.matchMedia
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderTagItem(active: boolean): Record<'onClick' | 'onToggle', ReturnType<typeof vi.fn>> {
  const handlers = { onClick: vi.fn(), onToggle: vi.fn() }
  render(
    createElement(
      SidebarProvider,
      null,
      createElement(
        SidebarMenu,
        null,
        createElement(TagItem, {
          tag: work,
          count: 3,
          active,
          onEdit: vi.fn(),
          onDelete: vi.fn(),
          ...handlers
        })
      )
    )
  )
  return handlers
}

describe('sidebar tag row checkbox', () => {
  it('reflects the active state', () => {
    renderTagItem(true)
    expect(screen.getByRole('checkbox', { name: 'Filter by work' }).dataset.state).toBe('checked')
  })

  it('toggles without firing the exclusive row click', () => {
    const { onClick, onToggle } = renderTagItem(false)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Filter by work' }))
    expect(onToggle).toHaveBeenCalledOnce()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('is not nested inside the row button', () => {
    renderTagItem(false)
    const checkbox = screen.getByRole('checkbox', { name: 'Filter by work' })
    expect(checkbox.parentElement?.closest('button')).toBeNull()
  })

  it('the name click still reaches the row handler', () => {
    const { onClick, onToggle } = renderTagItem(false)
    fireEvent.click(screen.getByRole('button', { name: 'work' }))
    expect(onClick).toHaveBeenCalledOnce()
    expect(onToggle).not.toHaveBeenCalled()
  })
})

describe('TagFilter active chips', () => {
  const tags: Tag[] = ['a', 'b', 'c'].map((id) => ({
    id,
    name: `tag-${id}`,
    color: '#22c55e',
    createdAt: 0
  }))

  beforeEach(() => {
    useVaultStore.setState({ tags, notes: [], noteTagsMap: {} })
    useUiStore.setState({ searchQuery: '' })
  })

  it.each([
    [['a', 'b'], 1],
    [['a', 'b', 'c'], 2]
  ])('%j active → %i "and" separators', (activeTags, separators) => {
    useUiStore.setState({ activeTags })
    render(createElement(TagFilter, { count: 0 }))
    expect(screen.getAllByText('and')).toHaveLength(separators)
  })

  it('a single active tag has no separator', () => {
    useUiStore.setState({ activeTags: ['a'] })
    render(createElement(TagFilter, { count: 0 }))
    expect(screen.queryByText('and')).toBeNull()
  })

  it('removing a chip drops only that tag', () => {
    useUiStore.setState({ activeTags: ['a', 'b'] })
    render(createElement(TagFilter, { count: 0 }))
    fireEvent.click(screen.getByTitle('Remove tag tag-a'))
    expect(useUiStore.getState().activeTags).toEqual(['b'])
  })

  it('shows the count it is given, not one recomputed without the search', () => {
    useUiStore.setState({ activeTags: ['a'], searchQuery: 'x' })
    render(createElement(TagFilter, { count: 1 }))
    expect(screen.getByText('(1 note)')).toBeTruthy()
  })

  it('appends the title clause when a search is active', () => {
    useUiStore.setState({ activeTags: ['a'], searchQuery: '  seed  ' })
    render(createElement(TagFilter, { count: 0 }))
    expect(screen.getByText('title contains "seed"')).toBeTruthy()
    expect(screen.getAllByText('and')).toHaveLength(1)
  })

  it('has no title clause for a blank search', () => {
    useUiStore.setState({ activeTags: ['a'], searchQuery: '   ' })
    render(createElement(TagFilter, { count: 0 }))
    expect(screen.queryByText(/title contains/)).toBeNull()
  })

  it('removing the last chip clears the filter', () => {
    useUiStore.setState({ activeTags: ['a'] })
    render(createElement(TagFilter, { count: 0 }))
    fireEvent.click(screen.getByTitle('Remove tag tag-a'))
    expect(useUiStore.getState().activeTags).toEqual([])
  })
})

describe('toggleActiveTag semantics used by the checkbox', () => {
  beforeEach(() => useUiStore.setState({ activeTags: [] }))

  it('additive toggle keeps other tags, exclusive click replaces them', () => {
    const { toggleActiveTag } = useUiStore.getState()
    toggleActiveTag('a', false)
    toggleActiveTag('b', true)
    expect(useUiStore.getState().activeTags).toEqual(['a', 'b'])
    toggleActiveTag('b', true)
    expect(useUiStore.getState().activeTags).toEqual(['a'])
    toggleActiveTag('c', false)
    expect(useUiStore.getState().activeTags).toEqual(['c'])
  })
})
