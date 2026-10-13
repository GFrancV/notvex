import { Component, type ReactNode } from 'react'

import { AlertTriangleIcon } from 'lucide-react'

import { BugReportActions } from '@/components/BugReportActions'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { notvex } from '@/lib/ipc'
import { reportError } from '@/lib/report-error'

interface Props {
  children: ReactNode
}

interface State {
  failed: boolean
  reloadRefused: boolean
}

// A class because React only catches render errors in componentDidCatch. The fallback reads no
// store and never shows error.message: the broken state may be the cause, and the message can
// carry note content.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, reloadRefused: false }

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true }
  }

  componentDidCatch(error: Error): void {
    reportError(error)
  }

  // reloadWindow drains and locks the vault before reloading; a raw reload would not. It only
  // locks when the vault failed to pack, and the Toaster that would say so is inside the
  // crashed App, so the fallback says it itself.
  reload = async (): Promise<void> => {
    const result = await notvex.app.reloadWindow().catch(() => null)
    if (!result?.success || !result.data) this.setState({ reloadRefused: true })
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children

    return (
      <div className="bg-background flex h-screen items-center justify-center p-6">
        <div className="flex w-full max-w-md flex-col gap-4">
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>Something went wrong</AlertTitle>
            <AlertDescription>
              Notvex hit an unexpected error. Reloading locks the vault and returns to the unlock
              screen.
            </AlertDescription>
          </Alert>
          <Button onClick={() => void this.reload()}>Reload</Button>
          {this.state.reloadRefused && (
            <p className="text-muted-foreground text-center text-sm">
              Couldn&apos;t reload yet. The vault is locked; press Reload again.
            </p>
          )}
          <BugReportActions />
        </div>
      </div>
    )
  }
}
