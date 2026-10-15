// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { forceParsing, syntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { livePreviewPlugin } from '@/lib/editor/live-preview'

// jsdom has no layout, and the real CodeMirror measures ranges.
beforeAll(() => {
  Range.prototype.getClientRects = (): DOMRectList => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = (): DOMRect => new DOMRect()
})

let view: EditorView | null = null
afterEach(() => {
  view?.destroy()
  view = null
})

// Far longer than what the initial parse covers past the viewport, so the rest is left to the
// background parser.
const longDoc = '## Heading\n\nSome **bold** and *italic* text.\n\n'.repeat(4_000)

function mount(doc: string): EditorView {
  view = new EditorView({
    state: EditorState.create({
      doc,
      // The cursor sits at the end so no decoration near the top is skipped for being on its line.
      selection: { anchor: doc.length },
      extensions: [markdown({ base: markdownLanguage }), livePreviewPlugin]
    }),
    parent: document.body
  })
  return view
}

const decorationStarts = (v: EditorView): number[] => {
  const starts: number[] = []
  v.plugin(livePreviewPlugin)!.decorations.between(0, v.state.doc.length, (from) => {
    starts.push(from)
  })
  return starts
}

describe('live preview — long notes', () => {
  it('decorates only the visible part of the document', () => {
    const v = mount(longDoc)
    forceParsing(v, v.state.doc.length, 10_000)
    // Precondition: with a partial tree this would pass no matter what the plugin visits.
    expect(syntaxTree(v.state).length).toBe(v.state.doc.length)
    // A selection change rebuilds against the complete tree, which covers far past the screen.
    v.dispatch({ selection: { anchor: v.state.doc.length } })

    const starts = decorationStarts(v)
    expect(starts.length).toBeGreaterThan(0)
    // A node that starts on screen may end just past it; nothing starts beyond it.
    expect(starts.every((from) => from <= v.viewport.to)).toBe(true)
  }, 30_000)

  it('rebuilds once the parser catches up, without waiting for an edit', () => {
    const v = mount(longDoc)
    const tree = syntaxTree(v.state)
    const before = v.plugin(livePreviewPlugin)!.decorations

    forceParsing(v, v.state.doc.length, 10_000)

    // Precondition: the initial parse really stopped short and the tree advanced.
    expect(syntaxTree(v.state)).not.toBe(tree)
    expect(v.plugin(livePreviewPlugin)!.decorations).not.toBe(before)
  }, 30_000)
})
