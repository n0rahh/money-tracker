import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './Button'

type Props = { children: ReactNode }
type State = { failed: boolean }

/** Last line of defence around the whole app: a render error shows a reload panel instead of a blank screen. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="safe-pt safe-pb flex min-h-dvh items-center justify-center bg-bg px-6 text-text">
        <div className="w-full max-w-sm space-y-4 rounded-card border border-border bg-surface p-6 text-center">
          <p role="alert" className="text-lg font-semibold">Something went wrong</p>
          <Button className="w-full" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    )
  }
}
