// @vitest-environment jsdom
import { createElement } from 'react'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Tag } from '@shared/types'

vi.mock('@/lib/ipc', () => ({ notvex: {} }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { TagDeleteModal } = await import('@/components/tags/TagDeleteModal')
const { useVaultStore } = await import('@/store/vault.store')
const { toast } = await import('sonner')

const tag: Tag = { id: 't1', name: 'work', color: '#000000', createdAt: 0 }

afterEach(cleanup)

describe('TagDeleteModal', () => {
  it('describes how many notes lose the tag', () => {
    useVaultStore.setState({ tagCounts: { t1: 2 } })
    render(createElement(TagDeleteModal, { open: true, onClose: () => {}, tag }))

    expect(screen.getByRole('dialog', { description: /remove the tag from 2 notes/ })).toBeTruthy()
  })

  it('closes without a success toast, since the sidebar shows the tag gone', async () => {
    const deleteTag = vi.fn(async () => undefined)
    const onClose = vi.fn()
    useVaultStore.setState({ tagCounts: {}, deleteTag })
    render(createElement(TagDeleteModal, { open: true, onClose, tag }))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete tag' }))
    })

    expect(deleteTag).toHaveBeenCalledWith('t1')
    expect(onClose).toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })
})
