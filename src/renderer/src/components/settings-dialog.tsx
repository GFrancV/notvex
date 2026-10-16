import { useState, type ReactNode } from 'react'

import { DatabaseIcon, RefreshCwIcon, ShieldIcon } from 'lucide-react'
import { toast } from 'sonner'

import { notvex } from '@/lib/ipc'
import { usePrefsStore } from '@/store/prefs.store'
import { ExportWarningDialog } from './dialogs/ExportWarningDialog'
import { SecurityPanel } from './settings/SecurityPanel'
import { SectionTitle, SettingRow } from './settings/SettingRow'
import { VaultDataPanel } from './settings/VaultDataPanel'
import { Checkbox } from './ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'

// The divider lives on the panel, which already spans the dialog's height; stretching the tab
// list instead would stretch every tab with it.
const PANEL = 'border-border min-h-0 space-y-5 overflow-y-auto border-l py-1 pr-2 pl-6'

// Active indicator on the left in the primary color; the same variant prefix as the shadcn
// classes lets tailwind-merge replace them instead of stacking on top.
const TAB =
  'pl-3 after:bg-primary group-data-[orientation=vertical]/tabs:after:right-auto group-data-[orientation=vertical]/tabs:after:left-0'

// The warning dialog stays open while this runs, but the OS folder dialog hides it; the
// toast is what reports progress and the result.
const handleExportAll = async (): Promise<void> => {
  const toastId = toast.loading('Exporting notes…')
  const result = await notvex.notes.exportAll()
  if (!result.success) {
    toast.error(result.error, { id: toastId })
  } else if (result.data === null) {
    toast.dismiss(toastId) // user canceled the folder dialog
  } else {
    const noun = result.data === 1 ? 'note' : 'notes'
    toast.success(`Exported ${result.data} ${noun}`, { id: toastId })
  }
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: Props): ReactNode {
  const setPref = usePrefsStore((s) => s.setPref)
  const checkUpdatesOnStartup = usePrefsStore((s) => s.checkUpdatesOnStartup)
  const [exportAllOpen, setExportAllOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A fixed size keeps the tab list still while switching between short and long panels. */}
      <DialogContent className="flex h-[min(640px,85vh)] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        {/* DialogContent unmounts on close, so every open starts on defaultValue. */}
        <Tabs defaultValue="security" orientation="vertical" className="min-h-0 flex-1 gap-3">
          <TabsList aria-label="Settings sections" variant="line" className="w-44 shrink-0">
            <TabsTrigger value="security" className={TAB}>
              <ShieldIcon />
              Security
            </TabsTrigger>
            <TabsTrigger value="updates" className={TAB}>
              <RefreshCwIcon />
              Updates
            </TabsTrigger>
            <TabsTrigger value="vault" className={TAB}>
              <DatabaseIcon />
              Vault & Data
            </TabsTrigger>
          </TabsList>

          {/* Scrolls only past the fixed height, e.g. at high zoom; at the default size it fits. */}
          <TabsContent value="security" className={PANEL}>
            <SecurityPanel />
          </TabsContent>

          <TabsContent value="updates" className={PANEL}>
            <section className="space-y-3">
              <SectionTitle>Updates</SectionTitle>

              <SettingRow
                label="Check for updates on startup"
                description="Contacts GitHub when Notvex starts. GitHub sees your IP address, OS and app version. You can still check manually from About."
              >
                <Checkbox
                  aria-label="Check for updates on startup"
                  checked={checkUpdatesOnStartup}
                  onCheckedChange={(v) => void setPref('checkUpdatesOnStartup', v === true)}
                />
              </SettingRow>
            </section>
          </TabsContent>

          <TabsContent value="vault" className={PANEL}>
            <VaultDataPanel onExportAll={() => setExportAllOpen(true)} />
          </TabsContent>
        </Tabs>

        {/* Confirmations render inside DialogContent: Radix decides "outside" by React tree, so a
            sibling dialog's clicks would count as outside this one and dismiss it. */}
        <ExportWarningDialog
          open={exportAllOpen}
          onOpenChange={setExportAllOpen}
          title="Export all notes"
          onConfirm={handleExportAll}
        />
      </DialogContent>
    </Dialog>
  )
}
