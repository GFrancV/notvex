import { useEffect, useState, type ReactNode } from 'react'

import { ArrowRightIcon } from 'lucide-react'
import { toast } from 'sonner'

import { AppLogo } from '@/components/AppLogo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { notvex } from '@/lib/ipc'
import { truncatePath } from '@/lib/utils'

interface MigrationState {
  reason: 'header'
  vaultPath: string
  fromVersion: number
  toVersion: number
}

export function MigrationRequiredDialog(): ReactNode {
  const [state, setState] = useState<MigrationState | null>(null)
  const [createBackup, setCreateBackup] = useState(true)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    return notvex.vault.onMigrationRequired((data) => setState(data))
  }, [])

  const respond = async (confirmed: boolean): Promise<void> => {
    setLoading(true)
    try {
      const res = confirmed
        ? await notvex.vault.confirmMigration(createBackup)
        : await notvex.vault.cancelMigration()
      if (!res.success) toast.error(res.error)
    } finally {
      setLoading(false)
      setState(null)
      setCreateBackup(true)
    }
  }

  return (
    <Dialog
      open={state !== null}
      onOpenChange={(v) => {
        if (!v) void respond(false)
      }}
    >
      <DialogContent className="max-w-md" showCloseButton={false}>
        {state && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                <AppLogo className="size-10 shrink-0" />
                <DialogTitle>Vault update required</DialogTitle>
              </div>
            </DialogHeader>
            <DialogDescription>
              <span className="text-foreground block truncate">
                {truncatePath(state.vaultPath)}
              </span>
              was last opened by an older version of Notvex. Its internal format needs a one-time
              update before it can be opened with this version of the app.
            </DialogDescription>

            <div className="flex items-center justify-center gap-2">
              <Badge variant="secondary">v{state.fromVersion}</Badge>
              <ArrowRightIcon className="text-muted-foreground size-4" />
              <Badge variant="secondary">v{state.toVersion}</Badge>
            </div>

            <Field orientation="horizontal">
              <Checkbox
                id="migration-create-backup"
                checked={createBackup}
                onCheckedChange={(v) => setCreateBackup(v === true)}
              />
              <FieldContent>
                <FieldLabel htmlFor="migration-create-backup" className="font-normal">
                  Create a backup before updating
                </FieldLabel>
                <FieldDescription>
                  A plain copy of your vault file, saved next to it before the update runs. Nothing
                  you need to manage — safe to delete anytime, and not required to open the vault
                  again.
                </FieldDescription>
              </FieldContent>
            </Field>

            <DialogFooter>
              <Button
                variant="ghost"
                disabled={loading}
                onClick={() => {
                  void respond(false)
                }}
              >
                Cancel
              </Button>
              <Button
                disabled={loading}
                onClick={() => {
                  void respond(true)
                }}
              >
                Update vault
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
