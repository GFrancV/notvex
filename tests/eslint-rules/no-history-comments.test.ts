import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'

import rule from '../../eslint-rules/no-history-comments.mjs'

// RuleTester registers its own describe/it; vitest globals are off.
RuleTester.describe = describe
RuleTester.it = it
RuleTester.itOnly = it.only

const history = [{ messageId: 'history' }]

new RuleTester().run('no-history-comments', rule, {
  valid: [
    '// see https://github.com/electron/electron/issues/123',
    '// background matches #121212 and #0a0a0a',
    '// upstream bug: electron#1234',
    "const label = 'issue #36'",
    "describe('closes on suspend (issue #36)', () => {})",
    '// rekey succeeded but the checkpoint threw: newRawKey must still be zeroed',
    '/* eslint-disable no-console */'
  ],
  invalid: [
    { code: '// refused before it runs (#57)', errors: history },
    { code: '// see issue #19', errors: history },
    { code: '// landed in PR #28', errors: history },
    { code: "// Task 6's unit tests above", errors: history },
    { code: '// post-Phase-6 cleanup', errors: history },
    { code: "// flagged by /agent-skills:ship's fan-out", errors: history },
    { code: '// Found by the security auditor', errors: history },
    { code: '// found while extending coverage', errors: history },
    { code: '// verified by hand that this passes', errors: history },
    { code: "// see tasks/plan.md's design note", errors: history },
    { code: '// doChangePassword() (vault.ts:657)', errors: history },
    { code: '/** Block comment too (#61). */', errors: history }
  ]
})
