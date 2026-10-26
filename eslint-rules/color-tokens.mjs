// Every renderer color comes from a main.css token. Class names live in string literals and
// template chunks, so those are the only nodes checked.
const MUTED_TEXT = /(?:^|[\s:!])text-muted(?=[\s/!]|$)/

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Forbid colors that bypass the main.css tokens' },
    schema: [],
    messages: {
      mutedText: 'Use text-muted-foreground for text; --muted is a background token.'
    }
  },
  create(context) {
    const check = (node, text) => {
      if (typeof text === 'string' && MUTED_TEXT.test(text)) {
        context.report({ node, messageId: 'mutedText' })
      }
    }
    return {
      Literal: (node) => check(node, node.value),
      TemplateElement: (node) => check(node, node.value.raw)
    }
  }
}
