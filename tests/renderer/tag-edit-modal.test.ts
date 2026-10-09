// @vitest-environment jsdom
import { createElement } from 'react'

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Tag } from '@shared/types'

vi.mock('@/lib/ipc', () => ({ notvex: {} }))

const { TagCreateModal } = await import('@/components/tags/TagCreateModal')
const { PRESET_COLORS } = await import('@/lib/tag-colors')
const { useVaultStore } = await import('@/store/vault.store')

// Longer than TAG_NAME_MAX, as tags stored before main enforced it can be.
const legacy: Tag = { id: 't-old', name: 'a'.repeat(30), color: PRESET_COLORS[0], createdAt: 0 }

afterEach(cleanup)

function renderEditModal(): ReturnType<typeof vi.fn> {
  const updateTag = vi.fn(() => Promise.resolve())
  useVaultStore.setState({ tags: [legacy], updateTag })
  render(createElement(TagCreateModal, { open: true, onClose: () => {}, editTag: legacy }))
  return updateTag
}

describe('TagCreateModal in edit mode', () => {
  it('sends only the color when the name is unchanged', async () => {
    const updateTag = renderEditModal()

    fireEvent.click(screen.getAllByRole('button', { name: /^Color:/ })[1])
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateTag).toHaveBeenCalledWith('t-old', { color: PRESET_COLORS[1] })
    )
  })

  it('sends the trimmed name when it changed', async () => {
    const updateTag = renderEditModal()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  renamed  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(updateTag).toHaveBeenCalledWith('t-old', { name: 'renamed', color: PRESET_COLORS[0] })
    )
  })
})
