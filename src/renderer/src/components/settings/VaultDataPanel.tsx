import type { ReactNode } from 'react'

import { CheckIcon, CopyIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput
} from '@/components/ui/input-group'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { summarizeImport } from '@/lib/import-summary'
import { notvex } from '@/lib/ipc'
import { truncatePath } from '@/lib/utils'
import { useVaultStore } from '@/store/vault.store'
import { SettingRow, SettingsSection } from './SettingRow'

// The OS file dialogs hide the settings window while they're open, so a persistent toast is the
// only feedback that survives until the action finishes.
const handleSaveCopy = async (): Promise<void> => {
  const toastId = toast.loading('Saving a copy…')
  const result = await notvex.vault.saveCopyAs()
  if (!result.success) {
    toast.error('Failed to save copy', { id: toastId })
    return
  }
  if (result.data) {
    toast.success('Copy saved successfully', { id: toastId })
  } else {
    toast.dismiss(toastId) // user canceled the save dialog
  }
}

const handleImport = async (): Promise<void> => {
  const toastId = toast.loading('Importing notes…')
  const res = await notvex.notes.import()
  if (!res.success) {
    toast.error(res.error, { id: toastId })
    return
  }
  if (!res.data) {
    toast.dismiss(toastId) // user canceled the file dialog
    return
  }
  if (res.data.imported > 0) {
    // The notes are already committed; a failed refresh (e.g. the vault locked meanwhile) must
    // not leave the progress toast spinning instead of reporting what was imported.
    await useVaultStore
      .getState()
      .refreshAll()
      .catch(() => {})
  }
  const { message, details } = summarizeImport(res.data)
  if (details.length === 0) {
    toast.success(message, { id: toastId })
    return
  }
  toast.warning(message, {
    id: toastId,
    description: <span className="whitespace-pre-line">{details.join('\n')}</span>
  })
}

const handleOpenBackupsFolder = async (): Promise<void> => {
  const res = await notvex.vault.openBackupsFolder()
  if (!res.success) toast.error(res.error)
}

interface Props {
  /** Opens the plaintext warning, which the settings dialog renders above itself. */
  onExportAll: () => void
}

export function VaultDataPanel({ onExportAll }: Props): ReactNode {
  const vaultPath = useVaultStore((s) => s.currentVaultPath)
  const { isCopied, copyToClipboard } = useCopyToClipboard()

  return (
    <>
      <SettingsSection title="Vault">
        {vaultPath && (
          <div className="space-y-1.5">
            <p className="text-sm">Location</p>
            {/* Read-only, with a copy button: the full path is what users paste into a file manager. */}
            <InputGroup>
              <InputGroupInput
                readOnly
                aria-label="Vault location"
                value={truncatePath(vaultPath, 80)}
              />
              <InputGroupAddon align="inline-end">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <InputGroupButton
                      onClick={() => copyToClipboard(vaultPath)}
                      aria-label="Copy to clipboard"
                    >
                      {isCopied ? <CheckIcon className="text-success" /> : <CopyIcon />}
                    </InputGroupButton>
                  </TooltipTrigger>
                  <TooltipContent>Copy to clipboard</TooltipContent>
                </Tooltip>
              </InputGroupAddon>
            </InputGroup>
          </div>
        )}

        <SettingRow
          label="Vault copy"
          description="Save an encrypted copy of this vault file somewhere else."
        >
          <Button variant="secondary" size="sm" onClick={handleSaveCopy}>
            Save a vault copy as…
          </Button>
        </SettingRow>

        <SettingRow
          label="Backups"
          description="Copies Notvex takes before upgrading a vault. The newest 3 are kept."
        >
          <Button variant="secondary" size="sm" onClick={handleOpenBackupsFolder}>
            Open backups folder
          </Button>
        </SettingRow>
      </SettingsSection>

      <Separator />

      <SettingsSection title="Notes">
        <SettingRow
          label="Export"
          description="Write every note to a folder as Markdown. Exported files are not encrypted."
        >
          <Button variant="secondary" size="sm" onClick={onExportAll}>
            Export all notes…
          </Button>
        </SettingRow>

        <SettingRow label="Import" description="Add Markdown files to this vault as new notes.">
          <Button variant="secondary" size="sm" onClick={handleImport}>
            Import Markdown…
          </Button>
        </SettingRow>
      </SettingsSection>
    </>
  )
}
