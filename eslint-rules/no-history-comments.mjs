// Comments explain why the code is the way it is; how a fix was found belongs
// in the commit or PR. Only comment tokens are checked, so strings and test
// titles (e.g. describe('… (issue #36)')) are never flagged.
const PATTERNS = [
  /(?<![\w&/])#\d{1,4}\b/, // issue/PR tag; the 4-digit cap leaves #121212 hex alone
  /\b(?:issue|PR) #?\d+/i,
  /\bTask \d+/,
  /\bphase[- ]?\d+/i,
  /agent-skills/,
  /\bflagged by\b/i,
  /\bfound (?:by|while)\b/i,
  /verified by hand/i,
  /tasks\/(?:plan|todo)\.md/,
  /\b[\w.-]+\.(?:tsx?|mjs|cjs|js):\d+/ // line reference, e.g. vault.ts:657
]

export default {
  meta: {
    type: 'suggestion',
    docs: { description: 'Forbid fix history (issue/task/line refs) in comments' },
    schema: [],
    messages: {
      history: 'Comments explain why, not history — move issue/task/line refs to the commit or PR.'
    }
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (PATTERNS.some((p) => p.test(comment.value))) {
            context.report({ loc: comment.loc, messageId: 'history' })
          }
        }
      }
    }
  }
}
