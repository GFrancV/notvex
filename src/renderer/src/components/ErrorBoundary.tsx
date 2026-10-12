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
}

// A class because React only catches render errors in componentDidCatch. The fallback reads no
// store and never shows error.message: the broken state may be the cause, and the message can
// carry note content.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error): void {
    reportError(error)
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
          {/* reloadWindow drains and locks the vault before reloading; a raw reload would not. */}
          <Button onClick={() => void notvex.app.reloadWindow()}>Reload</Button>
          <BugReportActions />
        </div>
      </div>
    )
  }
}
