import { PASSWORD_MIN_LENGTH } from '@shared/types'

/** A new password's error, or null. Strength is guidance only: length is the rule. */
export function newPasswordError(password: string, current?: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters`
  if (current !== undefined && password === current) {
    return 'Use a different password from the current one'
  }
  return null
}

export function confirmError(password: string, confirm: string): string | null {
  return password === confirm ? null : "Passwords don't match"
}
