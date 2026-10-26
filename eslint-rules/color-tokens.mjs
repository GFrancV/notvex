// Every renderer color comes from a main.css token. Class names live in string literals and
// template chunks, so those are the only nodes checked.
const MUTED_TEXT = /(?:^|[\s:!])text-muted(?=[\s/!]|$)/

const PALETTE =
  'white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const COLOR_UTILITY =
  'text|bg|border|ring|shadow|fill|stroke|outline|placeholder|from|via|to|divide|decoration|caret|accent'

const HARDCODED = [
  // ponytail: whole-string hex needs 6 or 8 digits, so '#fff' slips; 3/4 digits would flag ids like '#add'
  /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i,
  /\[#[0-9a-f]{3,8}\]/i,
  /(?<![a-z])(?:oklch|oklab|lab|lch|rgba?|hsla?)\(/,
  new RegExp(`(?:^|[\\s:])(?:${COLOR_UTILITY})-(?:${PALETTE})(?:-\\d{2,3})?(?:/\\d+)?(?=\\s|$)`)
]

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Forbid colors that bypass the main.css tokens' },
    schema: [],
    messages: {
      mutedText: 'Use text-muted-foreground for text; --muted is a background token.',
      hardcoded: 'Use a token from main.css instead of a hardcoded color.'
    }
  },
  create(context) {
    const check = (node, text) => {
      if (typeof text !== 'string') return
      if (MUTED_TEXT.test(text)) context.report({ node, messageId: 'mutedText' })
      else if (HARDCODED.some((p) => p.test(text))) context.report({ node, messageId: 'hardcoded' })
    }
    return {
      Literal: (node) => check(node, node.value),
      TemplateElement: (node) => check(node, node.value.raw)
    }
  }
}
