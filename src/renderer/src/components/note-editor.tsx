import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages as codeLanguages } from '@codemirror/language-data'
import { EditorView } from '@codemirror/view'
import { andromeda } from '@uiw/codemirror-theme-andromeda'
import CodeMirror from '@uiw/react-codemirror'
import {
  EllipsisIcon,
  EyeIcon,
  FileTextIcon,
  Loader2Icon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  Trash2Icon
} from 'lucide-react'
import { toast } from 'sonner'

import { useClipboardAutoClear } from '@/hooks/use-clipboard-auto-clear'
import { livePreviewPlugin, livePreviewTheme, tablePreviewField } from '@/lib/editor/live-preview'
import { notvex } from '@/lib/ipc'
import { createPendingSave, type PendingSave } from '@/lib/pending-save'
import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'
import type { Note, Tag } from '@shared/types'
import { EditorContextMenu } from './editor-context-menu'
import { EditorToolbar } from './editor/EditorToolbar'
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
import { Skeleton } from './ui/skeleton'

const notvexEditorTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--background) !important', height: '100%' },
  '.cm-scroller': { backgroundColor: 'var(--background)' },
  '.cm-content': {
    fontFamily: '"JetBrains Mono","Fira Code","Consolas",monospace',
    fontSize: '14px',
    lineHeight: '1.7',
    padding: '24px 26px',
    color: 'var(--foreground)'
  },
  '.cm-line': { overflowWrap: 'anywhere' },
  '.cm-gutters': { display: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--primary) !important' },
  '.cm-selectionBackground': {
    backgroundColor: 'oklch(0.701913 0.15768 160.4375 / 0.2) !important'
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'oklch(0.701913 0.15768 160.4375 / 0.25) !important'
  },
  '.cm-activeLine': { backgroundColor: '#ffffff05' }
})

const AUTOSAVE_DELAY = 500

export function NoteEditor(): ReactNode {
  const {
    activeNoteId,
    setActiveNoteId,
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
  const [isLoading, setIsLoading] = useState(false)
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

  const activeIdRef = useRef<string | null>(null)
  const editorViewRef = useRef<EditorView | null>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const lastFocusTitleRef = useRef(0)

  const saveContent = useCallback(
    async (id: string, newContent: string): Promise<void> => {
      setSaving(true)
      const result = await notvex.notes.update(id, { content: newContent })
      setSaving(false)
      if (!result.success) {
        toast.error('Failed to save note. Your changes may not be saved.')
        return
      }
      void loadNotes({ trashed: useUiStore.getState().showTrash })
    },
    [loadNotes]
  )

  // The saver is created once and outlives note switches, so it commits through
  // a ref rather than closing over the first saveContent it ever saw.
  const saveContentRef = useRef(saveContent)
  useEffect(() => {
    saveContentRef.current = saveContent
  }, [saveContent])

  const contentSaverRef = useRef<PendingSave | null>(null)
  contentSaverRef.current ??= createPendingSave(
    (id, value) => saveContentRef.current(id, value),
    AUTOSAVE_DELAY
  )

  useEffect(() => {
    if (!activeNoteId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNote(null)
      setTitle('')
      setContent('')
      setIsLoading(false)
      return
    }
    activeIdRef.current = activeNoteId
    setIsLoading(true)
    setNote(null)
    setTitle('')
    setContent('')
    void notvex.notes.get(activeNoteId).then((res) => {
      if (activeIdRef.current !== activeNoteId) return
      setIsLoading(false)
      if (res.success && res.data) {
        setNote(res.data)
        setTitle(res.data.title)
        setContent(res.data.content)
        if (editorViewRef.current) {
          editorViewRef.current.dispatch({
            selection: { anchor: 0 },
            scrollIntoView: true
          })
        }
        const currentRequest = useUiStore.getState().focusTitleRequest
        if (currentRequest > lastFocusTitleRef.current) {
          lastFocusTitleRef.current = currentRequest
          requestAnimationFrame(() => {
            titleInputRef.current?.focus()
            titleInputRef.current?.select()
          })
        }
      }
    })

    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const editorFocused = editorViewRef.current?.hasFocus ?? false
      const titleFocused = document.activeElement === titleInputRef.current
      if (!editorFocused && !titleFocused) return
      e.stopPropagation()
      setActiveNoteId(null)
    }
    window.addEventListener('keydown', onKey, true)

    // Drain, never discard: this cleanup also runs when the note changes, and
    // anything still inside the debounce window would otherwise be lost (#19).
    return () => {
      void contentSaverRef.current?.flush()
      window.removeEventListener('keydown', onKey, true)
    }
  }, [activeNoteId, setActiveNoteId])

  // Dispose only on unmount — the saver outlives note switches. The flush above
  // runs first and captures the pending value synchronously, so the dispose here
  // cannot drop anything still unsaved.
  useEffect(() => {
    const saver = contentSaverRef.current
    return () => {
      void saver?.flush()
      saver?.dispose()
    }
  }, [])

  const handleContentChange = useCallback(
    (value: string): void => {
      if (!activeNoteId) return
      setContent(value)
      // The id is captured here, at schedule time. A flush fired by a note
      // switch must persist against *this* note, not whichever is open by then.
      contentSaverRef.current?.schedule(activeNoteId, value)
    },
    [activeNoteId]
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

  useClipboardAutoClear(editorView?.dom ?? null)

  // Derive assigned tags from noteTagsMap (kept in sync by optimistic store)
  const assignedTagIds = activeNoteId ? (noteTagsMap[activeNoteId] ?? []) : []
  const assignedTags = assignedTagIds
    .map((id) => allTags.find((t) => t.id === id))
    .filter((t): t is Tag => t != null)

  if (!activeNoteId) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center select-none">
        <div className="text-center">
          <FileTextIcon className="mx-auto mb-3 h-12 w-12 opacity-20" />
          <p className="text-sm">Select a note or create a new one</p>
          <p className="mt-1 text-xs opacity-60">Ctrl+N to create</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* Header */}
      <div className="shrink-0 px-6.5 pt-5 pb-3.5">
        {/* Title row */}
        <div className="flex items-center gap-2">
          {isLoading ? (
            <div className="flex-1">
              <Skeleton className="h-6.5 w-40 rounded" />
            </div>
          ) : (
            <input
              ref={titleInputRef}
              aria-label="Note title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              placeholder="Untitled"
              className="titlebar-no-drag placeholder:text-muted-foreground z-100 flex-1 bg-transparent text-xl font-semibold tracking-tight focus:outline-none"
            />
          )}
        </div>

        {/* Tags + action icons row */}
        <div className="mt-1 flex min-h-8.5 shrink-0 items-center gap-2">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            {note && (
              <>
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
                    className="text-muted-foreground border border-dashed"
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
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {saving && <span className="text-muted-foreground text-xs">Saving…</span>}
            <Button
              variant="ghost"
              size="icon"
              onClick={handlePin}
              title={note?.isPinned ? 'Unpin' : 'Pin'}
              className={note?.isPinned ? 'text-primary' : 'text-muted-foreground'}
            >
              <PinIcon className={`size-4 ${note?.isPinned ? 'fill-primary text-primary' : ''}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleEditorMode}
              title={
                editorMode === 'editing' ? 'Reading view (Ctrl+Shift+E)' : 'Edit (Ctrl+Shift+E)'
              }
              className={editorMode === 'reading' ? 'text-primary' : 'text-muted-forground'}
            >
              {editorMode === 'editing' ? (
                <EyeIcon className="h-4 w-4" />
              ) : (
                <PencilIcon className="h-4 w-4" />
              )}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="text-muted-foreground">
                  <EllipsisIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={handleTrash}
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
      </div>

      {/* Editor Toolbar */}
      {editorMode !== 'reading' && !isLoading && <EditorToolbar editorView={editorView} />}

      {/* Editor / Reading view */}
      <div className="relative flex min-h-0 min-w-0 flex-1">
        {isLoading && (
          <div className="bg-background absolute inset-0 z-50 flex items-center justify-center">
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2Icon className="size-4 animate-spin" />
              Decrypting note…
            </div>
          </div>
        )}
        {editorMode === 'reading' ? (
          <NoteReadingView content={content} />
        ) : (
          <EditorContextMenu editorView={editorView}>
            <CodeMirror
              value={content}
              theme="dark"
              extensions={[
                markdown({ base: markdownLanguage, codeLanguages }),
                andromeda,
                notvexEditorTheme,
                livePreviewPlugin,
                tablePreviewField,
                livePreviewTheme,
                EditorView.lineWrapping
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
}): ReactNode {
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
