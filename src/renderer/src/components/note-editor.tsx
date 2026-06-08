import { type JSX, useCallback, useEffect, useRef, useState } from 'react'

import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView } from '@codemirror/view'
import CodeMirror from '@uiw/react-codemirror'
import {
  EllipsisVerticalIcon,
  Eye,
  FileText,
  Pencil,
  PinIcon,
  PlusIcon,
  Trash2Icon
} from 'lucide-react'
import { toast } from 'sonner'

import type { Note, Tag } from '@shared/types'
import { livePreviewPlugin, livePreviewTheme } from '../lib/editor/live-preview'
import { notvex } from '../lib/ipc'
import { useUiStore } from '../store/ui.store'
import { useVaultStore } from '../store/vault.store'
import { EditorContextMenu } from './editor-context-menu'
import { NoteReadingView } from './note-reading-view'
import { TagChip } from './tags/TagChip'
import { TagSelector } from './tags/TagSelector'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger
} from './ui/dropdown-menu'

const notvexEditorTheme = EditorView.theme({
  '&': { backgroundColor: '#111111 !important', height: '100%' },
  '.cm-scroller': { backgroundColor: '#111111' },
  '.cm-content': {
    fontFamily: '"JetBrains Mono","Fira Code","Consolas",monospace',
    fontSize: '14px',
    lineHeight: '1.75',
    padding: '16px 20px'
  },
  '.cm-gutters': { display: 'none' },
  '.cm-cursor': { borderLeftColor: '#10b981 !important' },
  '.cm-selectionBackground': { backgroundColor: '#10b98130 !important' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: '#10b98140 !important' },
  '.cm-activeLine': { backgroundColor: '#ffffff05' }
})

const AUTOSAVE_DELAY = 500

export function NoteEditor(): JSX.Element {
  const {
    activeNoteId,
    loadNotes,
    loadTagCounts,
    noteTagsMap,
    tags: allTags,
    removeTagFromNote
  } = useVaultStore()
  const {
    editorMode,
    toggleEditorMode,
    tagSelectorNoteId,
    setTagSelectorNoteId,
    removeTagNoteId,
    setRemoveTagNoteId
  } = useUiStore()

  const [note, setNote] = useState<Note | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [editorView, setEditorView] = useState<EditorView | null>(null)
  const [tagSelectorOpen, setTagSelectorOpen] = useState(false)
  const [removeTagSelectorOpen, setRemoveTagSelectorOpen] = useState(false)

  // Derive open state from both local button clicks and command palette triggers
  const showTagSelector =
    tagSelectorOpen || (tagSelectorNoteId === activeNoteId && tagSelectorNoteId != null)
  const showRemoveSelector =
    removeTagSelectorOpen || (removeTagNoteId === activeNoteId && removeTagNoteId != null)

  const handleTagSelectorClose = (): void => {
    setTagSelectorOpen(false)
    if (tagSelectorNoteId) setTagSelectorNoteId(null)
  }

  const handleRemoveSelectorClose = (): void => {
    setRemoveTagSelectorOpen(false)
    if (removeTagNoteId) setRemoveTagNoteId(null)
  }

  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const activeIdRef = useRef<string | null>(null)
  const editorViewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    if (!activeNoteId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNote(null)
      setTitle('')
      setContent('')
      return
    }
    activeIdRef.current = activeNoteId
    void notvex.notes.get(activeNoteId).then((res) => {
      if (res.success && res.data && activeIdRef.current === activeNoteId) {
        setNote(res.data)
        setTitle(res.data.title)
        setContent(res.data.content)
        if (editorViewRef.current) {
          editorViewRef.current.dispatch({
            selection: { anchor: 0 },
            scrollIntoView: true
          })
        }
      }
    })
  }, [activeNoteId])

  const saveContent = useCallback(
    async (id: string, newContent: string): Promise<void> => {
      setSaving(true)
      await notvex.notes.update(id, { content: newContent })
      setSaving(false)
      void loadNotes()
    },
    [loadNotes]
  )

  const handleContentChange = useCallback(
    (value: string): void => {
      if (!activeNoteId) return
      setContent(value)
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout((): void => {
        void saveContent(activeNoteId, value)
      }, AUTOSAVE_DELAY)
    },
    [activeNoteId, saveContent]
  )

  const handleTitleBlur = async (): Promise<void> => {
    if (!activeNoteId || !note || title === note.title) return
    await notvex.notes.update(activeNoteId, { title })
    void loadNotes()
  }

  const handlePin = async (): Promise<void> => {
    if (!activeNoteId || !note) return
    await notvex.notes.update(activeNoteId, { isPinned: !note.isPinned })
    setNote({ ...note, isPinned: !note.isPinned })
    void loadNotes()
  }

  const handleTrash = async (): Promise<void> => {
    if (!activeNoteId) return
    await notvex.notes.trash(activeNoteId)
    useVaultStore.getState().setActiveNoteId(null)
    void loadNotes()
    void loadTagCounts()
  }

  // Derive assigned tags from noteTagsMap (kept in sync by optimistic store)
  const assignedTagIds = activeNoteId ? (noteTagsMap[activeNoteId] ?? []) : []
  const assignedTags = assignedTagIds
    .map((id) => allTags.find((t) => t.id === id))
    .filter((t): t is Tag => t != null)

  if (!activeNoteId) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center select-none">
        <div className="text-center">
          <FileText className="mx-auto mb-3 h-12 w-12 opacity-20" />
          <p className="text-sm">Select a note or create a new one</p>
          <p className="mt-1 text-xs opacity-60">Ctrl+N to create</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col border-l">
      {/* Title bar */}
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={(): void => {
            void handleTitleBlur()
          }}
          placeholder="Untitled"
          className="placeholder:text-muted-foreground flex-1 bg-transparent text-base font-semibold focus:outline-none"
        />
        <div className="flex items-center gap-1">
          {saving && <span className="text-muted-foreground text-xs">Saving…</span>}
          <Button
            variant="ghost"
            size="icon"
            onClick={(): void => {
              void handlePin()
            }}
            title={note?.isPinned ? 'Unpin' : 'Pin'}
            className={note?.isPinned ? 'text-primary' : 'text-muted-foreground'}
          >
            <PinIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleEditorMode}
            title={editorMode === 'editing' ? 'Reading view (Ctrl+Shift+E)' : 'Edit (Ctrl+Shift+E)'}
            className={editorMode === 'reading' ? 'text-primary' : 'text-muted-forground'}
          >
            {editorMode === 'editing' ? (
              <Eye className="h-4 w-4" />
            ) : (
              <Pencil className="h-4 w-4" />
            )}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-foreground">
                <EllipsisVerticalIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuGroup>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => void handleTrash()}
                  title="Move to trash"
                >
                  <Trash2Icon className="size-4" />
                  Delete file
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Tags row */}
      {note && (
        <div className="flex min-h-8.5 shrink-0 flex-wrap items-center gap-1.5 border-b px-4 py-1.5">
          {assignedTags.map((tag) => (
            <TagChip
              key={tag.id}
              tag={tag}
              onRemove={() =>
                void removeTagFromNote(activeNoteId, tag.id).catch((e: Error) =>
                  toast.error(e.message)
                )
              }
            />
          ))}
          <div className="relative">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setTagSelectorOpen(true)}
              className="text-muted-foreground"
            >
              <PlusIcon className="size-3" /> Add tag
            </Button>
            {showTagSelector && (
              <div className="absolute top-full left-0 z-50 mt-1">
                <TagSelector noteId={activeNoteId} onClose={handleTagSelectorClose} />
              </div>
            )}
          </div>
          {/* Remove-tag selector (for command palette) */}
          {showRemoveSelector && assignedTags.length > 0 && (
            <div className="absolute z-50 mt-8">
              <RemoveTagSelector
                tags={assignedTags}
                onRemove={(tagId) => {
                  void removeTagFromNote(activeNoteId, tagId).catch((e: Error) =>
                    toast.error(e.message)
                  )
                  handleRemoveSelectorClose()
                }}
                onClose={handleRemoveSelectorClose}
              />
            </div>
          )}
        </div>
      )}

      {/* Editor / Reading view */}
      <div className="flex min-h-0 flex-1">
        {editorMode === 'reading' ? (
          <NoteReadingView content={content} />
        ) : (
          <EditorContextMenu editorView={editorView}>
            <CodeMirror
              value={content}
              theme="dark"
              extensions={[
                markdown({ base: markdownLanguage }),
                oneDark,
                notvexEditorTheme,
                livePreviewPlugin,
                livePreviewTheme
              ]}
              onChange={handleContentChange}
              onCreateEditor={(view) => {
                editorViewRef.current = view
                setEditorView(view)
                view.focus()
              }}
              basicSetup={{
                lineNumbers: false,
                foldGutter: false,
                dropCursor: false,
                allowMultipleSelections: false,
                indentOnInput: false,
                highlightActiveLine: true,
                highlightSelectionMatches: false,
                closeBrackets: false,
                autocompletion: false,
                crosshairCursor: false,
                highlightActiveLineGutter: false
              }}
              className="h-full w-full overflow-auto"
            />
          </EditorContextMenu>
        )}
      </div>
    </div>
  )
}

function RemoveTagSelector({
  tags,
  onRemove,
  onClose
}: {
  tags: Tag[]
  onRemove: (tagId: string) => void
  onClose: () => void
}): JSX.Element {
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

  return (
    <div className="bg-sidebar w-48 overflow-hidden rounded-md border shadow-xl">
      <div className="border-b px-3 py-1.5">
        <p className="text-muted-foreground text-xs">Remove tag</p>
      </div>
      <div className="py-1">
        {tags.map((tag) => (
          <Button
            key={tag.id}
            variant="ghost"
            size="xs"
            onClick={() => onRemove(tag.id)}
            className="w-full"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: tag.color }}
            />
            {tag.name}
          </Button>
        ))}
      </div>
    </div>
  )
}
