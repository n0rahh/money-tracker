import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type ToastOptions = {
  /** The label of a button in the toast, such as "Undo"; the button is shown only together with `onAction`. */
  actionLabel?: string
  /** Runs on the first tap of the button, which also dismisses the toast; never more than once. */
  onAction?: () => void
  /** How long the toast stays: 3 s by default, 6 s when it offers an action. */
  durationMs?: number
}
type ToastApi = {
  showToast: (message: string, options?: ToastOptions) => void
  /** Takes the toast on screen away at once, whatever its timer says. */
  dismissToast: () => void
}
const ToastContext = createContext<ToastApi | null>(null)

type Toast = { message: string; action: { label: string; run: () => void } | null }

const DURATION_MS = 3000
/** How long a toast with an action stays; also the time for a message that answers one, such as a failed Undo. */
export const ACTION_DURATION_MS = 6000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const dismiss = useCallback(() => {
    window.clearTimeout(timer.current)
    setToast(null)
  }, [])

  // One toast at a time: a new one replaces the one on screen, with its action and its timer.
  const showToast = useCallback(
    (message: string, { actionLabel, onAction, durationMs }: ToastOptions = {}) => {
      let ran = false
      const action =
        actionLabel && onAction
          ? {
              label: actionLabel,
              run: () => {
                if (ran) return
                ran = true
                dismiss() // first, so a toast the action shows itself stays up
                onAction()
              },
            }
          : null
      setToast({ message, action })
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setToast(null), durationMs ?? (action ? ACTION_DURATION_MS : DURATION_MS))
    },
    [dismiss],
  )

  useEffect(() => () => window.clearTimeout(timer.current), [])
  const api = useMemo(() => ({ showToast, dismissToast: dismiss }), [showToast, dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Always mounted, so assistive technology is already listening when a toast comes in (a live region inserted together
          with its text is often not announced); the toast itself is the status. Portalled under <body>, so this empty row is
          no part of the markup of what the provider wraps: it is fixed, so where it sits in the DOM does not show. */}
      {createPortal(
        <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4">
          {toast ? (
            toast.action ? (
              // Takes its own taps, so a near miss of the button does not fall through to the page beneath.
              <div role="status" className="pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-surface-2 pl-4 pr-1 text-sm text-text shadow-lg">
                <span className="py-2">{toast.message}</span>
                <button type="button" onClick={toast.action.run} className="min-h-11 rounded-full px-4 font-semibold text-accent">
                  {toast.action.label}
                </button>
              </div>
            ) : (
              <div role="status" className="rounded-full border border-border bg-surface-2 px-4 py-2 text-sm text-text shadow-lg">{toast.message}</div>
            )
          ) : null}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
