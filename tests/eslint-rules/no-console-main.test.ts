import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

// The lint rule, not per-call-site tests, is what keeps main-process errors
// going through logError, so the config block itself needs a guard.

const eslint = new ESLint()

async function ruleIds(filePath: string): Promise<(string | null)[]> {
  const [result] = await eslint.lintText("console.error('x')\n", { filePath })
  return result.messages.map((m) => m.ruleId)
}

// The first lintText() loads the full config and its plugins, which takes seconds.
describe('no-console in src/main', { timeout: 30_000 }, () => {
  it('rejects console calls in main-process files', async () => {
    expect(await ruleIds('src/main/vault/some-module.ts')).toContain('no-console')
  })

  it('allows them in log.ts, the redacting helper', async () => {
    expect(await ruleIds('src/main/log.ts')).not.toContain('no-console')
  })
})
