import { describe, expect, it } from 'vitest'

import { confirmError, newPasswordError } from '@/lib/password-rules'

describe('newPasswordError', () => {
  it('asks for 12 characters', () => {
    expect(newPasswordError('elevenchars')).toBe('Use at least 12 characters')
  })

  it('accepts 12 characters whatever their strength', () => {
    expect(newPasswordError('aaaaaaaaaaaa')).toBeNull()
    // Spaces count like any other character; main applies the same rule.
    expect(newPasswordError(' '.repeat(12))).toBeNull()
  })

  it('refuses the current password when one is given', () => {
    expect(newPasswordError('same password 1', 'same password 1')).toBe(
      'Use a different password from the current one'
    )
    expect(newPasswordError('a new password 2', 'same password 1')).toBeNull()
  })
})

describe('confirmError', () => {
  it('flags a confirmation that differs', () => {
    expect(confirmError('a password here', 'a password her')).toBe("Passwords don't match")
    expect(confirmError('a password here', 'a password here')).toBeNull()
  })
})
