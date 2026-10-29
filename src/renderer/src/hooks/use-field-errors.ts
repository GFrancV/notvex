import { useState } from 'react'

interface FieldErrors<F extends string> {
  /** The field's error, once the field has been left or the form submitted; null otherwise. */
  error: (field: F) => string | null
  /** For the field's onBlur. */
  touch: (field: F) => () => void
  /** Marks the form submitted, so every error shows; true when there are none. */
  submit: () => boolean
}

/**
 * The forms' validation timing: a field says what's wrong once the user leaves it, and every field
 * does on submit. `errors` is recomputed each render from the current values.
 */
export function useFieldErrors<F extends string>(errors: Record<F, string | null>): FieldErrors<F> {
  const [touched, setTouched] = useState<Partial<Record<F, boolean>>>({})
  const [submitted, setSubmitted] = useState(false)

  return {
    error: (field) => (submitted || touched[field] ? errors[field] : null),
    touch: (field) => () => setTouched((t) => ({ ...t, [field]: true })),
    submit: () => {
      setSubmitted(true)
      return Object.values<string | null>(errors).every((e) => e === null)
    }
  }
}
