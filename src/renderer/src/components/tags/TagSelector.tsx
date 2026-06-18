import { type JSX, useEffect, useRef, useState } from 'react'

import { Plus } from 'lucide-react'
import { toast } from 'sonner'

import { useVaultStore } from '../../store/vault.store'
import { Button } from '../ui/button'

const PRESET_COLORS = [
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#6366f1',
  '#84cc16'
]

interface TagSelectorProps {
  noteId: string
  onClose: () => void
}

export function TagSelector({ noteId, onClose }: TagSelectorProps): JSX.Element {
  const { tags, noteTagsMap, addTagToNote, createTagAndAssign } = useVaultStore()
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const assignedIds = new Set(noteTagsMap[noteId] ?? [])
  const trimmed = search.trim()
  const available = tags.filter(
    (t) => !assignedIds.has(t.id) && t.name.toLowerCase().includes(trimmed.toLowerCase())
  )
  const showCreate =
    trimmed.length > 0 && !tags.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return (): void => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return (): void => document.removeEventListener('pointerdown', onPointerDown)
  }, [onClose])

  const handleSelect = async (tagId: string): Promise<void> => {
    try {
      await addTagToNote(noteId, tagId)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to assign tag')
    }
  }

  const handleCreate = async (): Promise<void> => {
    if (!trimmed || loading) return
    setLoading(true)
    try {
      await createTagAndAssign(noteId, { name: trimmed, color: PRESET_COLORS[0] })
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create tag')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div ref={containerRef} className="bg-sidebar w-52 overflow-hidden rounded-md border shadow-xl">
      <div className="border border-b px-3 py-2">
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && showCreate) void handleCreate()
          }}
          placeholder="Search tags…"
          className="placeholder:text-muted w-full bg-transparent text-xs focus:outline-none"
        />
      </div>

      <div className="max-h-48 overflow-y-auto py-1">
        {available.map((tag) => (
          <Button
            key={tag.id}
            variant="ghost"
            size="sm"
            onClick={() => void handleSelect(tag.id)}
            disabled={loading}
            className="w-full justify-start"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: tag.color }}
            />
            {tag.name}
          </Button>
        ))}

        {available.length === 0 && !showCreate && (
          <p className="text-muted px-3 py-2 text-xs">No tags found</p>
        )}

        {showCreate && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleCreate()}
            disabled={loading}
            className="text-primary w-full"
          >
            <Plus className="h-3 w-3" />
            Create &ldquo;{trimmed}&rdquo;
          </Button>
        )}
      </div>
    </div>
  )
}
