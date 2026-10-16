import { useState, type ReactNode } from 'react'

import {
  ActivityIcon,
  DatabaseIcon,
  FolderOpenIcon,
  InfoIcon,
  RefreshCwIcon,
  ShieldIcon,
  Trash2Icon
} from 'lucide-react'
import { toast } from 'sonner'

import { openLogsFolder } from '@/lib/bug-report'
import { notvex } from '@/lib/ipc'
import { usePrefsStore } from '@/store/prefs.store'
import { ClearLogsDialog } from './dialogs/ClearLogsDialog'
import { ExportWarningDialog } from './dialogs/ExportWarningDialog'
import { AboutPanel } from './settings/AboutPanel'
import { SecurityPanel } from './settings/SecurityPanel'
import { SectionTitle, SettingRow } from './settings/SettingRow'
import { VaultDataPanel } from './settings/VaultDataPanel'
import { Button } from './ui/button'
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

export type SettingsTab = 'security' | 'updates' | 'vault' | 'diagnostics' | 'about'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab?: SettingsTab
}

export function SettingsDialog({ open, onOpenChange, initialTab = 'security' }: Props): ReactNode {
  const setPref = usePrefsStore((s) => s.setPref)
  const checkUpdatesOnStartup = usePrefsStore((s) => s.checkUpdatesOnStartup)
  const [exportAllOpen, setExportAllOpen] = useState(false)
  const [clearLogsOpen, setClearLogsOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A fixed size keeps the tab list still while switching between short and long panels. */}
      <DialogContent className="flex h-[min(640px,85vh)] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        {/* DialogContent unmounts on close, so every open starts on defaultValue. */}
        <Tabs defaultValue={initialTab} orientation="vertical" className="min-h-0 flex-1 gap-3">
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
            <TabsTrigger value="diagnostics" className={TAB}>
              <ActivityIcon />
              Diagnostics
            </TabsTrigger>
            <TabsTrigger value="about" className={TAB}>
              <InfoIcon />
              About
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

          <TabsContent value="diagnostics" className={PANEL}>
            <section className="space-y-3">
              <SectionTitle>Error log</SectionTitle>

              <SettingRow
                label="Logs folder"
                description="Errors are recorded only on this device, with no note content or file paths. Open the folder to attach the log to a bug report."
              >
                <Button variant="secondary" size="sm" onClick={() => void openLogsFolder()}>
                  <FolderOpenIcon />
                  Open logs folder
                </Button>
              </SettingRow>

              {/* Destructive, so it goes last and confirms first. */}
              <SettingRow
                label="Clear logs"
                description="Delete the local error log. A later bug report won't include the errors recorded so far."
              >
                <Button variant="destructive" size="sm" onClick={() => setClearLogsOpen(true)}>
                  <Trash2Icon />
                  Clear logs…
                </Button>
              </SettingRow>
            </section>
          </TabsContent>

          <TabsContent value="about" className={PANEL}>
            <AboutPanel />
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
        <ClearLogsDialog open={clearLogsOpen} onOpenChange={setClearLogsOpen} />
      </DialogContent>
    </Dialog>
  )
}
