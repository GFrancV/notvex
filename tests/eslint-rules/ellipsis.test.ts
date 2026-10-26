import { ESLint, RuleTester } from 'eslint'
import { describe, expect, it } from 'vitest'

import rule from '../../eslint-rules/ellipsis.mjs'

// RuleTester registers its own describe/it; vitest globals are off.
RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const threeDots = [{ messageId: 'threeDots' }]
const jsx = { languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } }

new RuleTester(jsx).run('ellipsis', rule, {
  valid: [
    '<span>Open vault…</span>',
    '<input placeholder="Search…" />',
    '<Button {...props}>Save</Button>',
    'const all = [...notes, note]',
    'const next = { ...prefs, theme }',
    "toast.loading('Exporting notes…')"
  ],
  invalid: [
    { code: '<span>Tag note with...</span>', errors: threeDots },
    { code: '<input placeholder="Search ..." />', errors: threeDots },
    { code: "const label = 'Key file...'", errors: threeDots },
    { code: 'const label = `Create note ${title}...`', errors: threeDots }
  ]
})

describe('ellipsis scope', { timeout: 30_000 }, () => {
  const eslint = new ESLint()
  const enabled = async (filePath: string): Promise<boolean> =>
    (await eslint.calculateConfigForFile(filePath)).rules?.['local/ellipsis'] !== undefined

  it('applies to renderer components', async () => {
    expect(await enabled('src/renderer/src/components/some-component.tsx')).toBe(true)
  })

  it.each([
    'src/renderer/src/components/ui/some-primitive.tsx',
    'src/renderer/src/lib/some-util.ts'
  ])('skips %s', async (filePath) => {
    expect(await enabled(filePath)).toBe(false)
  })
})
