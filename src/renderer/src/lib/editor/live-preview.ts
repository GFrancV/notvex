import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { EditorSelection, StateField } from '@codemirror/state'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view'

// ─── Widgets ──────────────────────────────────────────────────────────────────

class BulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.textContent = '•'
    span.className = 'cm-md-bullet'
    span.style.marginRight = '4px'
    return span
  }
  eq(): boolean {
    return true
  }
  ignoreEvent(): boolean {
    return true
  }
}

class HRWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-md-hr'
    return span
  }
  eq(): boolean {
    return true
  }
  ignoreEvent(): boolean {
    return true
  }
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly markerFrom: number,
    readonly markerTo: number
  ) {
    super()
  }

  toDOM(): HTMLElement {
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = this.checked
    cb.className = 'cm-task-checkbox'
    cb.dataset.markerFrom = String(this.markerFrom)
    cb.dataset.markerTo = String(this.markerTo)
    return cb
  }

  eq(other: CheckboxWidget): boolean {
    return (
      this.checked === other.checked &&
      this.markerFrom === other.markerFrom &&
      this.markerTo === other.markerTo
    )
  }

  ignoreEvent(): boolean {
    return false
  }
}

// ─── Table preview ────────────────────────────────────────────────────────────

type TableLine = { text: string; from: number }

function splitTableRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)

  const cells: string[] = []
  let current = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\' && s[i + 1] === '|') {
      current += '|'
      i++
    } else if (ch === '|') {
      cells.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  cells.push(current.trim())
  return cells
}

function parseColumnAlignment(cell: string): 'left' | 'center' | 'right' | null {
  const t = cell.trim()
  const left = t.startsWith(':')
  const right = t.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  if (left) return 'left'
  return null
}

const INLINE_TOKEN_RE =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(\[[^\]]+\]\([^)]+\))/g

function renderInlineMarkdown(text: string): DocumentFragment {
  const frag = document.createDocumentFragment()
  let lastIndex = 0
  INLINE_TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = INLINE_TOKEN_RE.exec(text))) {
    if (match.index > lastIndex) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)))
    }
    const token = match[0]
    if (token.startsWith('`')) {
      const code = document.createElement('code')
      code.className = 'cm-md-inlinecode'
      code.textContent = token.slice(1, -1)
      frag.appendChild(code)
    } else if (token.startsWith('**') || token.startsWith('__')) {
      const strong = document.createElement('strong')
      strong.className = 'cm-md-bold'
      strong.textContent = token.slice(2, -2)
      frag.appendChild(strong)
    } else if (token.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      if (linkMatch) {
        const a = document.createElement('a')
        a.className = 'cm-md-link'
        a.textContent = linkMatch[1]
        a.href = linkMatch[2]
        a.target = '_blank'
        a.rel = 'noreferrer'
        frag.appendChild(a)
      } else {
        frag.appendChild(document.createTextNode(token))
      }
    } else {
      const em = document.createElement('em')
      em.className = 'cm-md-italic'
      em.textContent = token.slice(1, -1)
      frag.appendChild(em)
    }
    lastIndex = match.index + token.length
  }
  if (lastIndex < text.length) {
    frag.appendChild(document.createTextNode(text.slice(lastIndex)))
  }
  return frag
}

class TableWidget extends WidgetType {
  constructor(readonly lines: TableLine[]) {
    super()
  }

  eq(other: TableWidget): boolean {
    if (this.lines.length !== other.lines.length) return false
    return this.lines.every(
      (l, i) => l.text === other.lines[i].text && l.from === other.lines[i].from
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'cm-md-table-wrap'

    if (this.lines.length < 2) {
      wrapper.textContent = this.lines.map((l) => l.text).join('\n')
      return wrapper
    }

    const [headerLine, delimiterLine, ...bodyLines] = this.lines
    const headerCells = splitTableRow(headerLine.text)
    const alignments = splitTableRow(delimiterLine.text).map(parseColumnAlignment)

    const table = document.createElement('table')
    table.className = 'cm-md-table'

    const thead = document.createElement('thead')
    const headRow = document.createElement('tr')
    headRow.dataset.line = String(headerLine.from)
    headerCells.forEach((cellText, i) => {
      const th = document.createElement('th')
      if (alignments[i]) th.style.textAlign = alignments[i]!
      th.appendChild(renderInlineMarkdown(cellText))
      headRow.appendChild(th)
    })
    thead.appendChild(headRow)
    table.appendChild(thead)

    const tbody = document.createElement('tbody')
    bodyLines.forEach((line) => {
      const cells = splitTableRow(line.text)
      const tr = document.createElement('tr')
      tr.dataset.line = String(line.from)
      cells.forEach((cellText, i) => {
        const td = document.createElement('td')
        if (alignments[i]) td.style.textAlign = alignments[i]!
        td.appendChild(renderInlineMarkdown(cellText))
        tr.appendChild(td)
      })
      tbody.appendChild(tr)
    })
    table.appendChild(tbody)

    wrapper.appendChild(table)

    wrapper.addEventListener('mousedown', (event) => {
      const target = event.target as HTMLElement
      const tr = target.closest('tr')
      const lineFrom = tr?.dataset.line
      if (lineFrom === undefined) return
      event.preventDefault()
      view.dispatch({ selection: EditorSelection.cursor(Number(lineFrom)) })
      view.focus()
    })

    return wrapper
  }

  ignoreEvent(): boolean {
    return true
  }
}

function buildTableDecorations(state: EditorState): DecorationSet {
  const { doc, selection } = state
  const cursorLine = doc.lineAt(selection.main.head).number
  const entries: DecoEntry[] = []

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'Table') return

      const { from, to } = node
      const startLine = doc.lineAt(from).number
      const endLine = doc.lineAt(Math.max(from, to - 1)).number
      if (cursorLine >= startLine && cursorLine <= endLine) return

      const lines: TableLine[] = []
      for (let ln = startLine; ln <= endLine; ln++) {
        const line = doc.line(ln)
        lines.push({ text: line.text, from: line.from })
      }
      if (lines.length < 2) return

      const lineStart = doc.line(startLine).from
      const lineEnd = doc.line(endLine).to
      entries.push({
        from: lineStart,
        to: lineEnd,
        dec: Decoration.replace({ widget: new TableWidget(lines), block: true })
      })
    }
  })

  if (entries.length === 0) return Decoration.set([])
  const ranges = entries.map(({ from, to, dec }) => dec.range(from, to))
  return Decoration.set(ranges, true)
}

export const tablePreviewField = StateField.define<DecorationSet>({
  create(state) {
    return buildTableDecorations(state)
  },
  update(value, tr) {
    if (!tr.docChanged && tr.startState.selection.eq(tr.state.selection)) {
      return value.map(tr.changes)
    }
    return buildTableDecorations(tr.state)
  },
  provide: (field) => EditorView.decorations.from(field)
})

// ─── Static decoration instances (reused to reduce allocations) ────────────────

const hide = Decoration.replace({})
const boldMark = Decoration.mark({ class: 'cm-md-bold' })
const italicMark = Decoration.mark({ class: 'cm-md-italic' })
const inlineCodeMark = Decoration.mark({ class: 'cm-md-inlinecode' })
const linkMark = Decoration.mark({ class: 'cm-md-link' })
const blockquoteLine = Decoration.line({ class: 'cm-md-blockquote' })
const codeBlockLine = Decoration.line({ class: 'cm-md-codeblock' })

const headingLines = [1, 2, 3, 4, 5, 6].map((n) =>
  Decoration.line({ class: `cm-md-heading cm-md-h${n}` })
)

// ─── Decoration builder ───────────────────────────────────────────────────────

type DecoEntry = { from: number; to: number; dec: Decoration }

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view
  const { doc, selection } = state
  const cursorLine = doc.lineAt(selection.main.head).number

  function cursorInRange(from: number, to: number): boolean {
    const a = doc.lineAt(from).number
    const b = doc.lineAt(Math.min(to, doc.length > 0 ? doc.length - 1 : 0)).number
    return cursorLine >= a && cursorLine <= b
  }

  const entries: DecoEntry[] = []

  syntaxTree(state).iterate({
    enter(node) {
      const { from, to, name } = node

      switch (name) {
        case 'ATXHeading1':
        case 'ATXHeading2':
        case 'ATXHeading3':
        case 'ATXHeading4':
        case 'ATXHeading5':
        case 'ATXHeading6': {
          if (cursorInRange(from, to)) return
          const level = parseInt(name.charAt(name.length - 1), 10) - 1
          const ls = doc.lineAt(from).from
          entries.push({ from: ls, to: ls, dec: headingLines[level] })
          break
        }

        case 'HeaderMark': {
          if (cursorInRange(from, to)) return
          const afterSpace = doc.sliceString(to, to + 1) === ' ' ? to + 1 : to
          entries.push({ from, to: afterSpace, dec: hide })
          break
        }

        case 'StrongEmphasis': {
          if (cursorInRange(from, to)) return
          const fc = node.node.firstChild
          const lc = node.node.lastChild
          if (fc && lc && fc !== lc && fc.to <= lc.from) {
            entries.push({ from: fc.to, to: lc.from, dec: boldMark })
          }
          break
        }

        case 'Emphasis': {
          if (cursorInRange(from, to)) return
          const fc = node.node.firstChild
          const lc = node.node.lastChild
          if (fc && lc && fc !== lc && fc.to <= lc.from) {
            entries.push({ from: fc.to, to: lc.from, dec: italicMark })
          }
          break
        }

        case 'EmphasisMark': {
          if (cursorInRange(from, to)) return
          entries.push({ from, to, dec: hide })
          break
        }

        case 'InlineCode': {
          if (cursorInRange(from, to)) return
          const fc = node.node.firstChild
          const lc = node.node.lastChild
          if (fc && lc && fc !== lc && fc.to <= lc.from) {
            entries.push({ from: fc.to, to: lc.from, dec: inlineCodeMark })
          }
          break
        }

        case 'CodeMark': {
          const parent = node.node.parent
          if (parent?.name === 'FencedCode') {
            if (cursorInRange(parent.from, parent.to)) return
            entries.push({ from, to, dec: hide })
          } else if (parent?.name === 'InlineCode') {
            if (cursorInRange(from, to)) return
            entries.push({ from, to, dec: hide })
          }
          break
        }

        case 'Blockquote': {
          if (cursorInRange(from, to)) return
          const startLine = doc.lineAt(from).number
          const endLine = doc.lineAt(Math.max(from, to - 1)).number
          for (let ln = startLine; ln <= endLine; ln++) {
            const ls = doc.line(ln).from
            entries.push({ from: ls, to: ls, dec: blockquoteLine })
          }
          break
        }

        case 'FencedCode':
        case 'CodeBlock': {
          if (cursorInRange(from, to)) return
          const startLine = doc.lineAt(from).number
          const endLine = doc.lineAt(Math.max(from, to - 1)).number
          for (let ln = startLine; ln <= endLine; ln++) {
            const ls = doc.line(ln).from
            entries.push({ from: ls, to: ls, dec: codeBlockLine })
          }
          break
        }

        case 'QuoteMark': {
          if (cursorInRange(from, to)) return
          const afterSpace = doc.sliceString(to, to + 1) === ' ' ? to + 1 : to
          entries.push({ from, to: afterSpace, dec: hide })
          break
        }

        case 'ListMark': {
          if (cursorInRange(from, to)) return
          const text = doc.sliceString(from, to)
          if (text === '-' || text === '*' || text === '+') {
            const afterSpace = doc.sliceString(to, to + 1) === ' ' ? to + 1 : to
            // Detect task item by checking if the char after the space is '['
            const isTask = doc.sliceString(afterSpace, afterSpace + 1) === '['
            entries.push({
              from,
              to: afterSpace,
              dec: isTask ? hide : Decoration.replace({ widget: new BulletWidget() })
            })
          }
          break
        }

        case 'TaskMarker': {
          if (cursorInRange(from, to)) return
          const markerText = doc.sliceString(from, to)
          const isChecked = markerText.toLowerCase().includes('x')
          // Include the trailing space after ] if present
          const afterSpace = doc.sliceString(to, to + 1) === ' ' ? to + 1 : to
          entries.push({
            from,
            to: afterSpace,
            dec: Decoration.replace({ widget: new CheckboxWidget(isChecked, from, to) })
          })
          break
        }

        case 'Link': {
          if (cursorInRange(from, to)) return
          // Apply link styling to the whole range; replace decorations on markers take precedence
          entries.push({ from, to, dec: linkMark })
          break
        }

        case 'LinkMark': {
          if (cursorInRange(from, to)) return
          if (node.node.parent?.name === 'Link') {
            entries.push({ from, to, dec: hide })
          }
          break
        }

        case 'URL': {
          if (cursorInRange(from, to)) return
          if (node.node.parent?.name === 'Link') {
            entries.push({ from, to, dec: hide })
          }
          break
        }

        case 'HorizontalRule': {
          if (cursorInRange(from, to)) return
          const line = doc.lineAt(from)
          // No block: true — block decorations are not allowed in ViewPlugins
          entries.push({
            from: line.from,
            to: line.to,
            dec: Decoration.replace({ widget: new HRWidget() })
          })
          break
        }
      }
    }
  })

  // Sort by from, then by to (shorter ranges first for same from)
  entries.sort((a, b) => a.from - b.from || a.to - b.to)

  if (entries.length === 0) return Decoration.set([])

  const ranges = entries.map(({ from, to, dec }) => dec.range(from, to))
  return Decoration.set(ranges, true)
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

class LivePreviewView {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view)
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = buildDecorations(update.view)
    }
  }
}

export const livePreviewPlugin = ViewPlugin.fromClass(LivePreviewView, {
  decorations: (v) => v.decorations,
  eventHandlers: {
    mousedown(event: MouseEvent, view: EditorView) {
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox') {
        const from = parseInt(target.dataset.markerFrom ?? '', 10)
        const to = parseInt(target.dataset.markerTo ?? '', 10)
        if (!isNaN(from) && !isNaN(to) && from >= 0 && to > from) {
          const text = view.state.sliceDoc(from, to)
          const wasChecked = text.toLowerCase().includes('x')
          view.dispatch({ changes: { from, to, insert: wasChecked ? '[ ]' : '[x]' } })
          event.preventDefault()
          return true
        }
      }
    }
  }
})

// ─── Additional CM6 theme styles for live preview elements ────────────────────

export const livePreviewTheme = EditorView.theme({
  '.cm-md-h1': { fontSize: '2em', fontWeight: 'bold', lineHeight: '1.3' },
  '.cm-md-h2': { fontSize: '1.5em', fontWeight: 'bold', lineHeight: '1.3' },
  '.cm-md-h3': { fontSize: '1.25em', fontWeight: 'bold', lineHeight: '1.3' },
  '.cm-md-h4': { fontSize: '1.1em', fontWeight: 'bold' },
  '.cm-md-h5': { fontSize: '1em', fontWeight: 'bold' },
  '.cm-md-h6': { fontSize: '0.9em', fontWeight: 'bold', color: 'var(--muted-foreground)' },
  '.cm-md-bold': { fontWeight: 'bold' },
  '.cm-md-italic': { fontStyle: 'italic' },
  '.cm-md-inlinecode': {
    fontFamily: '"JetBrains Mono","Fira Code",monospace',
    backgroundColor: 'var(--card)',
    borderRadius: '3px',
    padding: '0 3px'
  },
  '.cm-md-link': { color: 'var(--success)', textDecoration: 'underline', cursor: 'pointer' },
  '.cm-md-blockquote': {
    borderLeft: '3px solid var(--primary)',
    paddingLeft: '12px',
    color: 'var(--muted-foreground)',
    fontStyle: 'italic',
    backgroundColor: 'var(--card)'
  },
  '.cm-md-codeblock': {
    backgroundColor: 'var(--card)',
    paddingLeft: '15px',
    paddingRight: '15px',
    fontSize: '12.5px',
    fontFamily: 'var(--font-mono)'
  },
  '.cm-md-bullet': { color: 'var(--primary)' },
  '.cm-md-table-wrap': { padding: '4px 0', overflowX: 'auto' },
  '.cm-md-table': {
    borderCollapse: 'collapse',
    width: '100%',
    fontSize: '0.95em'
  },
  '.cm-md-table th, .cm-md-table td': {
    border: '1px solid var(--border)',
    padding: '6px 10px',
    textAlign: 'left'
  },
  '.cm-md-table th': {
    backgroundColor: 'var(--card)',
    fontWeight: 'bold'
  },
  '.cm-md-table tr:hover td': { backgroundColor: 'var(--card)' },
  '.cm-md-hr': {
    display: 'inline-block',
    width: '100%',
    height: '1px',
    backgroundColor: 'var(--border)',
    verticalAlign: 'middle'
  },
  '.cm-task-checkbox': {
    cursor: 'pointer',
    marginRight: '6px',
    accentColor: 'var(--success)',
    verticalAlign: 'middle'
  }
})
