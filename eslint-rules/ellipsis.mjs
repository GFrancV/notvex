// UI copy uses the ellipsis character. Spread syntax is not a string, so only text nodes are checked.
const THREE_DOTS = /\.\.\./

export default {
  meta: {
    type: 'suggestion',
    docs: { description: 'Forbid three dots in UI copy; use the ellipsis character' },
    schema: [],
    messages: { threeDots: 'Use … (U+2026) instead of three dots.' }
  },
  create(context) {
    const check = (node, text) => {
      if (typeof text === 'string' && THREE_DOTS.test(text)) {
        context.report({ node, messageId: 'threeDots' })
      }
    }
    return {
      JSXText: (node) => check(node, node.value),
      Literal: (node) => check(node, node.value),
      TemplateElement: (node) => check(node, node.value.raw)
    }
  }
}
