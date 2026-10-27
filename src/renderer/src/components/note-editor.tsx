import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages as codeLanguages } from '@codemirror/language-data'
import { searchPanelOpen } from '@codemirror/search'
import { EditorView } from '@codemirror/view'
import { andromeda } from '@uiw/codemirror-theme-andromeda'
import CodeMirror from '@uiw/react-codemirror'
import {
  CopyIcon,
  DownloadIcon,
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

import { useDuplicateNote } from '@/hooks/use-duplicate-note'
import { useExportNote } from '@/hooks/use-export-note'
import { useTogglePin } from '@/hooks/use-toggle-pin'
import { useTrashNote } from '@/hooks/use-trash-note'
import { usePendingSave } from '@/hooks/use-pending-save'
import { findExtension } from '@/lib/editor/find'
import { formattingKeymap } from '@/lib/editor/formatting'
import { livePreviewPlugin, livePreviewTheme, tablePreviewField } from '@/lib/editor/live-preview'
import { notvex } from '@/lib/ipc'
import { countText, formatCount, type TextCount } from '@/lib/text-count'
import { useUiStore } from '@/store/ui.store'
import { useVaultStore } from '@/store/vault.store'
import type { Note, Tag } from '@shared/types'
import { ExportWarningDialog } from './dialogs/ExportWarningDialog'
import { EditorContextMenu } from './editor-context-menu'
import { EditorToolbar } from './editor/EditorToolbar'
import { NoteReadingView } from './note-reading-view'
import { Shortcut } from './Shortcut'
import { TagChip } from './tags/TagChip'
import { TagSelector } from './tags/TagSelector'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { Skeleton } from './ui/skeleton'

const notvexEditorTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--background) !important', height: '100%' },
  '.cm-scroller': { backgroundColor: 'var(--background)' },
  '.cm-content': {
    fontFamily: 'var(--font-mono)',
    fontSize: '14px',
    lineHeight: '1.7',
    padding: '24px 26px',
    color: 'var(--foreground)'
  },
  '.cm-line': { overflowWrap: 'anywhere' },
  '.cm-gutters': { display: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--primary) !important' },
  // One class more than Andromeda's !important selection rules, which are mounted later and would
  // win a tie.
  '& .cm-scroller .cm-selectionLayer .cm-selectionBackground': {
    background: 'color-mix(in oklch, var(--primary) 20%, transparent) !important'
  },
  '&.cm-focused .cm-scroller .cm-selectionLayer .cm-selectionBackground': {
    background: 'color-mix(in oklch, var(--primary) 25%, transparent) !important'
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklch, var(--foreground) 2%, transparent)' }
})

// Module scope: @uiw/react-codemirror reconfigures the view whenever these props change identity,
// and each markdown() call builds a new Language, so a reconfigure reparses the whole note.
// onChange is in the same dependency list, so handleContentChange must stay stable too.
const editorExtensions = [
  markdown({ base: markdownLanguage, codeLanguages }),
  formattingKeymap,
  findExtension,
  andromeda,
  notvexEditorTheme,
  livePreviewPlugin,
  tablePreviewField,
  livePreviewTheme,
  EditorView.lineWrapping
]

const editorBasicSetup = {
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
}

const AUTOSAVE_DELAY = 500
// Recounting scans the whole note, so it waits for a typing pause instead of running per keystroke.
const COUNT_DELAY = 300
const NO_COUNT: TextCount = { words: 0, chars: 0 }

export function NoteEditor(): ReactNode {
  const {
    activeNoteId,
    setActiveNoteId,
    loadNotes,
    notes,
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
  const [counts, setCounts] = useState<TextCount>(NO_COUNT)
  const [saving, setSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [editorView, setEditorView] = useState<EditorView | null>(null)
  const [tagSelectorOpen, setTagSelectorOpen] = useState(false)
  const [removeTagSelectorOpen, setRemoveTagSelectorOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

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
  const countTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const titleInputRef = useRef<HTMLInputElement>(null)
  // Starts at the store's count: requests made before this mount (e.g. before a lock
  // unmounted the previous editor) were already handled and must not steal focus.
  const lastFocusTitleRef = useRef(useUiStore.getState().focusTitleRequest)
  const focusTitlePendingRef = useRef(false)
  // Last title known to be on disk. Compared against instead of note.title,
  // which goes stale as soon as the first title save lands.
  const persistedTitleRef = useRef('')

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

  const saveTitle = useCallback(
    async (id: string, newTitle: string): Promise<void> => {
      if (newTitle === persistedTitleRef.current) return
      const result = await notvex.notes.update(id, { title: newTitle })
      if (!result.success) {
        toast.error('Failed to save note title. Your changes may not be saved.')
        return
      }
      // A flush fired by a note switch resolves after the next note has loaded
      // and already set this ref. Only the note still on screen may update it.
      if (activeIdRef.current === id) persistedTitleRef.current = newTitle
      void loadNotes({ trashed: useUiStore.getState().showTrash })
    },
    [loadNotes]
  )

  const contentSaver = usePendingSave(saveContent, AUTOSAVE_DELAY)
  const titleSaver = usePendingSave(saveTitle, AUTOSAVE_DELAY)

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
    // A request belongs to the note opened right after it. Consuming it here rather than on
    // load keeps a failed load or a quick switch from handing it to a different note.
    const request = useUiStore.getState().focusTitleRequest
    const wantsTitleFocus = request > lastFocusTitleRef.current
    lastFocusTitleRef.current = request
    focusTitlePendingRef.current = false
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
        persistedTitleRef.current = res.data.title
        setContent(res.data.content)
        setCounts(countText(res.data.content))
        if (wantsTitleFocus) focusTitlePendingRef.current = true
      }
    })

    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const view = editorViewRef.current
      const editorFocused = view?.hasFocus ?? false
      const titleFocused = document.activeElement === titleInputRef.current
      if (!editorFocused && !titleFocused) return
      // Left to CodeMirror, whose Escape closes the find bar; the next Escape closes the note.
      if (view?.hasFocus && searchPanelOpen(view.state)) return
      e.stopPropagation()
      setActiveNoteId(null)
    }
    window.addEventListener('keydown', onKey, true)

    // Drain, never discard: this cleanup also runs when the note changes, and
    // anything still inside the debounce window would otherwise be lost.
    return () => {
      void contentSaver.flush().catch(() => undefined)
      void titleSaver.flush().catch(() => undefined)
      // A recount still pending belongs to the note being left; letting it fire would
      // overwrite the next note's count.
      clearTimeout(countTimerRef.current)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [activeNoteId, setActiveNoteId, contentSaver, titleSaver])

  // The title input only exists once loading ends, so focus it after that commit. A frame
  // callback can run before React commits and find no input.
  useEffect(() => {
    const input = titleInputRef.current
    if (isLoading || !focusTitlePendingRef.current || !input) return
    focusTitlePendingRef.current = false
    input.focus()
    input.select()
  }, [isLoading])

  const handleContentChange = useCallback(
    (value: string): void => {
      if (!activeNoteId) return
      setContent(value)
      // The id is captured here, at schedule time. A flush fired by a note
      // switch must persist against *this* note, not whichever is open by then.
      contentSaver.schedule(activeNoteId, value)
      clearTimeout(countTimerRef.current)
      countTimerRef.current = setTimeout(() => setCounts(countText(value)), COUNT_DELAY)
    },
    [activeNoteId, contentSaver]
  )

  const handleTitleChange = useCallback(
    (value: string): void => {
      if (!activeNoteId) return
      setTitle(value)
      titleSaver.schedule(activeNoteId, value)
    },
    [activeNoteId, titleSaver]
  )

  // Blur is only the fast path: focus may never leave before a note switch, a lock or a quit.
  const handleTitleBlur = (): void => {
    void titleSaver.flush().catch(() => undefined)
  }

  // Skips the tag and toolbar buttons that sit between the title and the body in tab order.
  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    const toContent = (e.key === 'Tab' && !e.shiftKey) || e.key === 'Enter'
    // editorView outlives the editor in reading mode: it still points at the destroyed view.
    if (!toContent || e.nativeEvent.isComposing || editorMode !== 'editing' || !editorView) return
    e.preventDefault()
    editorView.dispatch({ selection: { anchor: 0 } })
    editorView.focus()
  }

  // A pin made from the list only reaches the store's entry; the local copy is the fallback
  // for a note the current list doesn't hold.
  const isPinned = notes.find((n) => n.id === note?.id)?.isPinned ?? note?.isPinned ?? false

  const togglePin = useTogglePin()
  const handlePin = async (): Promise<void> => {
    if (!note) return
    if (!(await togglePin({ id: note.id, isPinned }))) return
    // The user may have switched notes while the pin was saving.
    setNote((current) => (current?.id === note.id ? { ...current, isPinned: !isPinned } : current))
  }

  const exportNote = useExportNote()

  const trashNote = useTrashNote()
  const handleTrash = async (): Promise<void> => {
    if (activeNoteId) await trashNote(activeNoteId)
  }

  const duplicateNote = useDuplicateNote()

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
          <p className="mt-1 text-xs opacity-60">
            <Shortcut keys="Mod-n" /> to create
          </p>
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
              onChange={(e) => handleTitleChange(e.target.value)}
              onBlur={handleTitleBlur}
              onKeyDown={handleTitleKeyDown}
              placeholder="Untitled"
              className="titlebar-no-drag placeholder:text-muted-foreground z-10 flex-1 bg-transparent text-xl font-semibold tracking-tight focus:outline-none"
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
              title={isPinned ? 'Unpin' : 'Pin'}
              className={isPinned ? 'text-primary' : 'text-muted-foreground'}
            >
              <PinIcon className={`size-4 ${isPinned ? 'fill-primary text-primary' : ''}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleEditorMode}
              title={
                editorMode === 'editing' ? 'Reading view (Ctrl+Shift+E)' : 'Edit (Ctrl+Shift+E)'
              }
              className={editorMode === 'reading' ? 'text-primary' : 'text-muted-foreground'}
            >
              {editorMode === 'editing' ? (
                <EyeIcon className="h-4 w-4" />
              ) : (
                <PencilIcon className="h-4 w-4" />
              )}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Note actions"
                  className="text-muted-foreground"
                >
                  <EllipsisIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {note && !note.isTrashed && (
                  <>
                    <DropdownMenuGroup>
                      <DropdownMenuItem onClick={() => void duplicateNote(note.id)}>
                        <CopyIcon className="size-4" />
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setExportOpen(true)}>
                        <DownloadIcon className="size-4" />
                        Export note…
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuGroup>
                  <DropdownMenuItem variant="destructive" onClick={handleTrash}>
                    <Trash2Icon className="size-4" />
                    Move to trash
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Outside DropdownMenuContent, which unmounts its children when the menu closes. */}
            <ExportWarningDialog
              open={exportOpen}
              onOpenChange={setExportOpen}
              title="Export note"
              onConfirm={() => exportNote(activeNoteId)}
            />
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
          // Mounted only once the note has decrypted: it takes focus on mount, and a keystroke
          // into an empty document before the content arrives would be autosaved over the note.
          !isLoading && (
            <EditorContextMenu editorView={editorView}>
              <CodeMirror
                // One instance per note: @uiw/react-codemirror defers external value updates while
                // the user is typing, and a deferred update outlives a note switch, leaving the
                // view showing (and editing) a document that isn't the open note's.
                key={activeNoteId}
                value={content}
                theme="dark"
                extensions={editorExtensions}
                onChange={handleContentChange}
                onCreateEditor={(view) => {
                  editorViewRef.current = view
                  setEditorView(view)
                  // Mounted after load, so a title focused for a new note must keep its focus.
                  if (document.activeElement !== titleInputRef.current) view.focus()
                }}
                basicSetup={editorBasicSetup}
                className="h-full w-full overflow-auto"
              />
            </EditorContextMenu>
          )
        )}
      </div>

      {note && !isLoading && (
        <footer className="text-muted-foreground border-border shrink-0 border-t px-4 py-1 text-end text-xs tabular-nums">
          {formatCount(counts.words, 'word', 'words')} ·{' '}
          {formatCount(counts.chars, 'character', 'characters')}
        </footer>
      )}
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
