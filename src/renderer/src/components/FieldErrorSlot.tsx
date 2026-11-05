import type { ReactNode } from 'react'

import { FieldError } from './ui/field'

/**
 * A field's error in a line kept in the layout, so showing or clearing it moves nothing below:
 * a moving button can swallow the click whose blur raised the error. Only `FieldError` mounts
 * and unmounts, so `role="alert"` is still announced when it appears.
 */
export function FieldErrorSlot({ children }: { children: string | null }): ReactNode {
  return (
    <div data-slot="field-error-slot" className="-mt-2 min-h-5">
      <FieldError>{children}</FieldError>
    </div>
  )
}
