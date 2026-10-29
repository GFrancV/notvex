import { type JSX, useId, useState } from 'react'

import { AlertTriangleIcon, InfoIcon } from 'lucide-react'

import { RecoveryWordsGrid } from './recovery-words-grid'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Field, FieldLabel } from './ui/field'

/** The `context` for a key that replaced the previous one. */
export const KEY_REPLACED = 'Your recovery key has changed and the previous one no longer works.'

interface RecoveryKeyStepProps {
  mnemonic: string
  /** Why this key is being shown: a first key, or one that replaced the previous key. */
  context: string
  /** Something else to keep in mind, such as an unchanged key file. */
  note?: string
  confirmLabel: string
  onConfirm: () => void
}

/** Every screen that shows a recovery key: the words, the same advice and the same confirmation. */
export function RecoveryKeyStep({
  mnemonic,
  context,
  note,
  confirmLabel,
  onConfirm
}: RecoveryKeyStepProps): JSX.Element {
  const [saved, setSaved] = useState(false)
  const checkboxId = useId()

  return (
    <div className="space-y-4">
      <Alert variant="warning">
        <AlertTriangleIcon />
        <AlertDescription>
          {context} Write it down by hand or copy it on a device you trust, and keep it somewhere
          safe. It won&apos;t be shown again.
        </AlertDescription>
      </Alert>

      <RecoveryWordsGrid mnemonic={mnemonic} />

      {note && (
        <Alert>
          <InfoIcon />
          <AlertDescription>{note}</AlertDescription>
        </Alert>
      )}

      <Field orientation="horizontal">
        <Checkbox id={checkboxId} checked={saved} onCheckedChange={(c) => setSaved(c === true)} />
        <FieldLabel htmlFor={checkboxId}>Recovery key saved somewhere safe</FieldLabel>
      </Field>

      <Button className="w-full" disabled={!saved} onClick={onConfirm}>
        {confirmLabel}
      </Button>
    </div>
  )
}
