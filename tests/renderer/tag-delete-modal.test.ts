// @vitest-environment jsdom
import { createElement } from 'react'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Tag } from '@shared/types'

vi.mock('@/lib/ipc', () => ({ notvex: {} }))

const { TagDeleteModal } = await import('@/components/tags/TagDeleteModal')
const { useVaultStore } = await import('@/store/vault.store')

const tag: Tag = { id: 't1', name: 'work', color: '#000000', createdAt: 0 }

afterEach(cleanup)

describe('TagDeleteModal', () => {
  it('describes how many notes lose the tag', () => {
    useVaultStore.setState({ tagCounts: { t1: 2 } })
    render(createElement(TagDeleteModal, { open: true, onClose: () => {}, tag }))

    expect(screen.getByRole('dialog', { description: /remove the tag from 2 notes/ })).toBeTruthy()
  })
})
