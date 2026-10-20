import { useCallback } from 'react'

import { toast } from 'sonner'

import { notvex } from '@/lib/ipc'

// No flush here: ExportWarningDialog saves pending edits before calling this.
export function useExportNote(): (id: string) => Promise<void> {
  return useCallback(async (id: string) => {
    const res = await notvex.notes.export(id)
    if (!res.success) toast.error(res.error)
    else if (res.data) toast.success('Note exported')
  }, [])
}
