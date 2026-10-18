import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

// A misconfigured shadcn CLI writes `from 'cn'` and installs an unvetted npm package to satisfy
// it, so the bare specifier is banned rather than trusting every generated diff to be read.

const eslint = new ESLint()

async function ruleIds(code: string, filePath: string): Promise<(string | null)[]> {
  const [result] = await eslint.lintText(code, { filePath })
  return result.messages.map((m) => m.ruleId)
}

const UI_FILE = 'src/renderer/src/components/ui/some-primitive.tsx'

// The first lintText() loads the full config and its plugins, which takes seconds.
describe('shadcn imports', { timeout: 30_000 }, () => {
  it("rejects importing cn from the bare 'cn' module", async () => {
    const code = "import { cn } from 'cn'\n\nexport const c = cn\n"
    expect(await ruleIds(code, UI_FILE)).toContain('no-restricted-imports')
  })

  it("allows importing cn from '@/lib/utils'", async () => {
    const code = "import { cn } from '@/lib/utils'\n\nexport const c = cn\n"
    expect(await ruleIds(code, UI_FILE)).not.toContain('no-restricted-imports')
  })
})
