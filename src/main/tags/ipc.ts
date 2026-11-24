import { TAG_NAME_MAX } from '@shared/types'
import type { CreateTagInput, TagPatch } from '../db/queries'
import {
  addTagToNote,
  createTag,
  createTagAndAssign,
  deleteTag,
  getAllNoteTags,
  getNoteCountPerTag,
  getNoteTags,
  listTags,
  removeTagFromNote,
  updateTag
} from '../db/queries'
import { fail, handle, ok, requireVault } from '../ipc/core'
import { getDb, withVaultLock } from '../vault/vault'

// The renderer's maxLength and color picker only limit what the UI offers, so any caller of
// window.notvex.tags.* reaches here unchecked. Validated on write only: tags stored before these
// checks stay readable.
function validTagName(name: unknown): string {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (trimmed.length === 0) throw new Error('Tag name cannot be empty')
  if (trimmed.length > TAG_NAME_MAX) {
    throw new Error(`Tag name must be at most ${TAG_NAME_MAX} characters`)
  }
  return trimmed
}

// The renderer builds a translucent background by appending a hex alpha, so only #rrggbb works.
function validTagColor(color: unknown): string {
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) {
    throw new Error('Tag color must be a #rrggbb hex value')
  }
  return color.toLowerCase()
}

export function registerTagsHandlers({ touchActivity }: { touchActivity: () => void }): void {
  handle('tags:create', async (_e, input: CreateTagInput) => {
    try {
      requireVault()
      const name = validTagName(input?.name)
      const color = validTagColor(input?.color)
      touchActivity()
      return ok(await withVaultLock(() => createTag(getDb(), { ...input, name, color })))
    } catch (e) {
      return fail(e)
    }
  })

  handle(
    'tags:create-and-assign',
    async (_e, input: { noteId: string; name: string; color: string }) => {
      try {
        requireVault()
        const name = validTagName(input?.name)
        const color = validTagColor(input?.color)
        touchActivity()
        return ok(await withVaultLock(() => createTagAndAssign(getDb(), { ...input, name, color })))
      } catch (e) {
        return fail(e)
      }
    }
  )

  handle('tags:list', async () => {
    try {
      requireVault()
      touchActivity()
      return ok(await withVaultLock(() => listTags(getDb())))
    } catch (e) {
      return fail(e)
    }
  })

  handle('tags:update', async (_e, id: string, patch: TagPatch) => {
    try {
      requireVault()
      const checked = {
        ...patch,
        ...(patch?.name !== undefined && { name: validTagName(patch.name) }),
        ...(patch?.color !== undefined && { color: validTagColor(patch.color) })
      }
      touchActivity()
      await withVaultLock(() => updateTag(getDb(), id, checked))
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('tags:delete', async (_e, id: string) => {
    try {
      requireVault()
      touchActivity()
      await withVaultLock(() => deleteTag(getDb(), id))
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  // ── Note-tags ─────────────────────────────────────────────────────────────

  handle('note-tags:add', async (_e, noteId: string, tagId: string) => {
    try {
      requireVault()
      touchActivity()
      await withVaultLock(() => addTagToNote(getDb(), noteId, tagId))
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('note-tags:remove', async (_e, noteId: string, tagId: string) => {
    try {
      requireVault()
      touchActivity()
      await withVaultLock(() => removeTagFromNote(getDb(), noteId, tagId))
      return ok(null)
    } catch (e) {
      return fail(e)
    }
  })

  handle('note-tags:list', async (_e, noteId: string) => {
    try {
      requireVault()
      touchActivity()
      return ok(await withVaultLock(() => getNoteTags(getDb(), noteId)))
    } catch (e) {
      return fail(e)
    }
  })

  handle('note-tags:counts', async () => {
    try {
      requireVault()
      touchActivity()
      return ok(await withVaultLock(() => getNoteCountPerTag(getDb())))
    } catch (e) {
      return fail(e)
    }
  })

  handle('note-tags:all', async () => {
    try {
      requireVault()
      touchActivity()
      return ok(await withVaultLock(() => getAllNoteTags(getDb())))
    } catch (e) {
      return fail(e)
    }
  })
}
