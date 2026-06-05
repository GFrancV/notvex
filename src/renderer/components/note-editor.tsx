import { useCallback, useEffect, useRef, useState } from 'react'

import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView } from '@codemirror/view'
import CodeMirror from '@uiw/react-codemirror'
import { EllipsisVerticalIcon, Eye, FileText, Pencil, Pin, Trash2Icon } from 'lucide-react'

import type { Note } from '../../shared/types'
import { livePreviewPlugin, livePreviewTheme } from '../lib/editor/live-preview'
import { notvex } from '../lib/ipc'
import { useUiStore } from '../store/ui.store'
import { useVaultStore } from '../store/vault.store'
import { EditorToolbar } from './editor-toolbar'
import { NoteReadingView } from './note-reading-view'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
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

export function NoteEditor(): JSX.Element | null {
  const { activeNoteId, loadNotes, loadTagCounts } = useVaultStore()
  const { editorMode, toggleEditorMode } = useUiStore()

  const [note, setNote] = useState<Note | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  const saveTimer = useRef<ReturnType<typeof setTimeout>>()
  const activeIdRef = useRef<string | null>(null)
  const editorViewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    if (!activeNoteId) {
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
        // Reset scroll and cursor to top when switching notes
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

  if (!activeNoteId) {
    return (
      <div className="flex flex-1 items-center justify-center text-[#737373] select-none">
        <div className="text-center">
          <FileText className="mx-auto mb-3 h-12 w-12 opacity-20" />
          <p className="text-sm">Select a note or create a new one</p>
          <p className="mt-1 text-xs opacity-60">Ctrl+N to create</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col border-l border-[#1e1e1e]">
      {/* Title bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[#1e1e1e] px-4 py-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={(): void => {
            void handleTitleBlur()
          }}
          placeholder="Untitled"
          className="flex-1 bg-transparent text-base font-semibold text-[#e5e5e5] placeholder:text-[#737373] focus:outline-none"
        />
        <div className="flex items-center gap-1">
          {saving && <span className="text-xs text-[#737373]">Saving…</span>}
          <Button
            variant="ghost"
            size="icon"
            onClick={(): void => {
              void handlePin()
            }}
            title={note?.isPinned ? 'Unpin' : 'Pin'}
            className={note?.isPinned ? 'text-emerald-400' : 'text-[#737373]'}
          >
            <Pin className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleEditorMode}
            title={editorMode === 'editing' ? 'Reading view (Ctrl+Shift+E)' : 'Edit (Ctrl+Shift+E)'}
            className={editorMode === 'reading' ? 'text-emerald-400' : 'text-[#737373]'}
          >
            {editorMode === 'editing' ? (
              <Eye className="h-4 w-4" />
            ) : (
              <Pencil className="h-4 w-4" />
            )}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted">
                <EllipsisVerticalIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuGroup>
                <DropdownMenuItem>Profile</DropdownMenuItem>
                <DropdownMenuItem>Billing</DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem>Team</DropdownMenuItem>
                <DropdownMenuItem>Subscription</DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
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

      {/* Formatting toolbar — only in editing mode */}
      {editorMode === 'editing' && <EditorToolbar editorView={editorViewRef.current} />}

      {/* Editor / Reading view */}
      <div className="flex min-h-0 flex-1">
        {editorMode === 'reading' ? (
          <NoteReadingView content={content} />
        ) : (
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
        )}
      </div>
    </div>
  )
}
