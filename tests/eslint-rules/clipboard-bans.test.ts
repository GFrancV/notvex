import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

// Clipboard history and cloud sync are only opted out of when main writes the clipboard, so
// these bans, not per-call-site tests, keep a new copy path from bypassing it.

const eslint = new ESLint()

async function ruleIds(code: string, filePath: string): Promise<(string | null)[]> {
  const [result] = await eslint.lintText(code, { filePath })
  return result.messages.map((m) => m.ruleId)
}

const RENDERER_FILE = 'src/renderer/src/components/some-component.tsx'

// The first lintText() loads the full config and its plugins, which takes seconds.
describe('clipboard bans', { timeout: 30_000 }, () => {
  it.each([
    'void navigator.clipboard.writeText("x")\n',
    'void window.navigator.clipboard.writeText("x")\n'
  ])('rejects %s in the renderer', async (code) => {
    expect(await ruleIds(code, RENDERER_FILE)).toContain('no-restricted-syntax')
  })

  it('allows reading clipboardData from a copy event', async () => {
    const code = 'export const f = (e: ClipboardEvent): unknown => e.clipboardData\n'
    expect(await ruleIds(code, RENDERER_FILE)).not.toContain('no-restricted-syntax')
  })

  it.each(['src/main/ipc-handlers.ts', 'src/preload/index.ts'])(
    "rejects importing electron's clipboard in %s",
    async (filePath) => {
      const code = "import { clipboard } from 'electron'\n\nexport const c = clipboard\n"
      expect(await ruleIds(code, filePath)).toContain('no-restricted-imports')
    }
  )

  it('allows it in clipboard-guard.ts, the one writer', async () => {
    const code = "import { clipboard } from 'electron'\n\nexport const c = clipboard\n"
    expect(await ruleIds(code, 'src/main/clipboard-guard.ts')).not.toContain(
      'no-restricted-imports'
    )
  })
})
