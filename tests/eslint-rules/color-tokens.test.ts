import { ESLint, RuleTester } from 'eslint'
import { describe, expect, it } from 'vitest'

import rule from '../../eslint-rules/color-tokens.mjs'

// RuleTester registers its own describe/it; vitest globals are off.
RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const mutedText = [{ messageId: 'mutedText' }]
const hardcoded = [{ messageId: 'hardcoded' }]
const jsx = { languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } }

new RuleTester(jsx).run('color-tokens', rule, {
  valid: [
    '<p className="text-muted-foreground mt-1" />',
    '<input className="placeholder:text-muted-foreground" />',
    '<p className="text-muted-foreground/70" />',
    '<div className="bg-muted text-sm" />',
    "const label = 'Muted text'",
    '<div className="bg-primary/15 text-success border-warning/20 shadow-glow-primary" />',
    "const t = { background: 'color-mix(in oklch, var(--primary) 20%, transparent)' }",
    "const href = '#add'",
    "const id = '#bad'",
    '<p className="text-sm">Pick red or blue</p>',
    '<div className="bg-accent text-accent-foreground" />'
  ],
  invalid: [
    { code: '<p className="text-muted mt-1 text-sm" />', errors: mutedText },
    { code: '<input className="placeholder:text-muted w-full" />', errors: mutedText },
    { code: '<p className="h-auto text-muted" />', errors: mutedText },
    { code: 'cn("p-0", "text-muted")', errors: mutedText },
    { code: 'const c = `text-muted ${x}`', errors: mutedText },
    { code: '<p className="text-muted/70 text-xs" />', errors: mutedText },
    { code: '<p className="text-muted! text-xs" />', errors: mutedText },
    { code: '<p className="!text-muted text-xs" />', errors: mutedText },
    { code: "const t = { backgroundColor: '#ffffff05' }", errors: hardcoded },
    { code: "const t = { color: '#121212' }", errors: hardcoded },
    { code: '<div className="bg-[#121212]" />', errors: hardcoded },
    { code: '<div className="shadow-[0_0_4px_oklch(0.7_0.1_160/0.5)]" />', errors: hardcoded },
    { code: "const t = { color: 'rgba(0, 0, 0, 0.5)' }", errors: hardcoded },
    { code: '<p className="text-emerald-400" />', errors: hardcoded },
    { code: '<div className="bg-zinc-900 p-2" />', errors: hardcoded },
    { code: '<div className="hover:border-white/10" />', errors: hardcoded },
    { code: '<div className="text-white" />', errors: hardcoded }
  ]
})

describe('color-tokens scope', { timeout: 30_000 }, () => {
  const eslint = new ESLint()
  const enabled = async (filePath: string): Promise<boolean> =>
    (await eslint.calculateConfigForFile(filePath)).rules?.['local/color-tokens'] !== undefined

  it('applies to renderer components', async () => {
    expect(await enabled('src/renderer/src/components/some-component.tsx')).toBe(true)
  })

  it.each([
    'src/renderer/src/components/ui/some-primitive.tsx',
    'src/renderer/src/lib/tag-colors.ts'
  ])('skips %s', async (filePath) => {
    expect(await enabled(filePath)).toBe(false)
  })
})
