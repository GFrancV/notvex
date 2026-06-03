import { useState } from 'react'
import { notvex } from '../lib/ipc'
import { useVaultStore } from '../store/vault.store'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Plus, X, Edit2, Check } from 'lucide-react'
import type { Tag } from '../../preload/index'

const PRESET_COLORS = [
  '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b',
  '#ef4444', '#ec4899', '#06b6d4', '#84cc16',
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
    loadTagCounts()
  }

  const handleRemoveTag = async (tagId: string): Promise<void> => {
    await notvex.noteTags.remove(noteId, tagId)
    onTagsChanged()
    loadTagCounts()
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
        <button className="flex items-center gap-1 text-xs text-[#737373] hover:text-[#a3a3a3] transition-colors">
          <Plus className="h-3 w-3" /> Add tag
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <div className="space-y-3">
          <p className="text-xs font-medium text-[#a3a3a3]">Tags</p>

          {/* Existing tags */}
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {tags.map((tag) => (
              <div key={tag.id} className="flex items-center gap-2">
                {editingTag?.id === tag.id ? (
                  <div className="flex flex-1 items-center gap-1">
                    <input
                      type="color"
                      value={editColor}
                      onChange={(e) => setEditColor(e.target.value)}
                      className="h-5 w-5 rounded cursor-pointer border-0 bg-transparent"
                    />
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-6 flex-1 text-xs py-0"
                      onKeyDown={(e) => e.key === 'Enter' && handleUpdateTag()}
                      autoFocus
                    />
                    <button onClick={handleUpdateTag} className="text-emerald-400 hover:text-emerald-300">
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => noteTagIds.has(tag.id) ? handleRemoveTag(tag.id) : handleAddTag(tag.id)}
                      className="flex flex-1 items-center gap-2 rounded px-1.5 py-1 hover:bg-[#222] transition-colors"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className={`flex-1 text-left text-xs ${noteTagIds.has(tag.id) ? 'text-[#e5e5e5]' : 'text-[#737373]'}`}>
                        {tag.name}
                      </span>
                      {noteTagIds.has(tag.id) && <Check className="h-3 w-3 text-emerald-400" />}
                    </button>
                    <button
                      onClick={() => { setEditingTag(tag); setEditName(tag.name); setEditColor(tag.color) }}
                      className="text-[#737373] hover:text-[#a3a3a3]"
                    >
                      <Edit2 className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => handleDeleteTag(tag)}
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
            <p className="text-xs text-[#737373] mb-2">Create new tag</p>
            <div className="flex items-center gap-2">
              <div className="relative">
                <input
                  type="color"
                  value={newTagColor}
                  onChange={(e) => setNewTagColor(e.target.value)}
                  className="h-7 w-7 rounded cursor-pointer border border-[#2a2a2a] bg-transparent p-0.5"
                />
              </div>
              <Input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="Tag name"
                className="flex-1 h-7 text-xs"
                onKeyDown={(e) => e.key === 'Enter' && handleCreateTag()}
              />
              <Button size="sm" variant="outline" onClick={handleCreateTag} className="h-7 px-2 text-xs">
                Add
              </Button>
            </div>
            <div className="flex gap-1.5 mt-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  className={`h-4 w-4 rounded-full border-2 transition-all ${newTagColor === c ? 'border-white scale-110' : 'border-transparent'}`}
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
