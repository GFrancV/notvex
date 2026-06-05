import { useState } from 'react'

import { Plus, X, Edit2, Check } from 'lucide-react'

import { notvex } from '../lib/ipc'
import { useVaultStore } from '../store/vault.store'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import type { Tag } from '../../shared/types'

const PRESET_COLORS = [
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#06b6d4',
  '#84cc16',
]

interface TagManagerProps {
  noteId: string
  noteTags: Tag[]
  onTagsChanged: () => void
}

export function TagManager({ noteId, noteTags, onTagsChanged }: TagManagerProps): JSX.Element {
  const { tags, loadTags, loadTagCounts } = useVaultStore()
  const [open, setOpen] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState(PRESET_COLORS[0])
  const [editingTag, setEditingTag] = useState<Tag | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')

  const noteTagIds = new Set(noteTags.map((t) => t.id))

  const handleAddTag = async (tagId: string): Promise<void> => {
    await notvex.noteTags.add(noteId, tagId)
    onTagsChanged()
    void loadTagCounts()
  }

  const handleRemoveTag = async (tagId: string): Promise<void> => {
    await notvex.noteTags.remove(noteId, tagId)
    onTagsChanged()
    void loadTagCounts()
  }

  const handleCreateTag = async (): Promise<void> => {
    if (!newTagName.trim()) return
    const res = await notvex.tags.create({ name: newTagName.trim(), color: newTagColor })
    if (res.success) {
      await loadTags()
      await handleAddTag(res.data.id)
      setNewTagName('')
    }
  }

  const handleUpdateTag = async (): Promise<void> => {
    if (!editingTag || !editName.trim()) return
    await notvex.tags.update(editingTag.id, { name: editName.trim(), color: editColor })
    await loadTags()
    setEditingTag(null)
  }

  const handleDeleteTag = async (tag: Tag): Promise<void> => {
    await notvex.tags.delete(tag.id)
    await loadTags()
    await loadTagCounts()
    onTagsChanged()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1 text-xs text-[#737373] transition-colors hover:text-[#a3a3a3]">
          <Plus className="h-3 w-3" /> Add tag
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <div className="space-y-3">
          <p className="text-xs font-medium text-[#a3a3a3]">Tags</p>

          {/* Existing tags */}
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {tags.map((tag) => (
              <div key={tag.id} className="flex items-center gap-2">
                {editingTag?.id === tag.id ? (
                  <div className="flex flex-1 items-center gap-1">
                    <input
                      type="color"
                      value={editColor}
                      onChange={(e) => setEditColor(e.target.value)}
                      className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent"
                    />
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-6 flex-1 py-0 text-xs"
                      onKeyDown={(e): void => {
                        if (e.key === 'Enter') void handleUpdateTag()
                      }}
                    />
                    <button
                      onClick={(): void => {
                        void handleUpdateTag()
                      }}
                      className="text-emerald-400 hover:text-emerald-300"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={(): void => {
                        if (noteTagIds.has(tag.id)) {
                          void handleRemoveTag(tag.id)
                        } else {
                          void handleAddTag(tag.id)
                        }
                      }}
                      className="flex flex-1 items-center gap-2 rounded px-1.5 py-1 transition-colors hover:bg-[#222]"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span
                        className={`flex-1 text-left text-xs ${noteTagIds.has(tag.id) ? 'text-[#e5e5e5]' : 'text-[#737373]'}`}
                      >
                        {tag.name}
                      </span>
                      {noteTagIds.has(tag.id) && <Check className="h-3 w-3 text-emerald-400" />}
                    </button>
                    <button
                      onClick={() => {
                        setEditingTag(tag)
                        setEditName(tag.name)
                        setEditColor(tag.color)
                      }}
                      className="text-[#737373] hover:text-[#a3a3a3]"
                    >
                      <Edit2 className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(): void => {
                        void handleDeleteTag(tag)
                      }}
                      className="text-[#737373] hover:text-red-400"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Create new tag */}
          <div className="border-t border-[#2a2a2a] pt-3">
            <p className="mb-2 text-xs text-[#737373]">Create new tag</p>
            <div className="flex items-center gap-2">
              <div className="relative">
                <input
                  type="color"
                  value={newTagColor}
                  onChange={(e) => setNewTagColor(e.target.value)}
                  className="h-7 w-7 cursor-pointer rounded border border-[#2a2a2a] bg-transparent p-0.5"
                />
              </div>
              <Input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="Tag name"
                className="h-7 flex-1 text-xs"
                onKeyDown={(e): void => {
                  if (e.key === 'Enter') void handleCreateTag()
                }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={(): void => {
                  void handleCreateTag()
                }}
                className="h-7 px-2 text-xs"
              >
                Add
              </Button>
            </div>
            <div className="mt-2 flex gap-1.5">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  className={`h-4 w-4 rounded-full border-2 transition-all ${newTagColor === c ? 'scale-110 border-white' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setNewTagColor(c)}
                />
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
