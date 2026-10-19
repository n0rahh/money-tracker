import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type ToastOptions = {
  /** The label of a button in the toast, such as "Undo"; the button is shown only together with `onAction`. */
  actionLabel?: string
  /** Runs on the first tap of the button, which also dismisses the toast; never more than once. */
  onAction?: () => void
  /** How long the toast stays: 3 s by default, 6 s when it offers an action. A toast with an action waits while it is in use. */
  durationMs?: number
}
type ToastApi = {
  showToast: (message: string, options?: ToastOptions) => void
  /** Takes the toast on screen away at once, whatever its timer says, if it offers an action; a plain toast stays. */
  dismissActionToast: () => void
}
const ToastContext = createContext<ToastApi | null>(null)

type Toast = { message: string; action: { label: string; run: () => void } | null }

const DURATION_MS = 3000
/** How long a toast with an action stays; also the time for a message that answers one, such as a failed Undo. */
export const ACTION_DURATION_MS = 6000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)
  const timer = useRef<number | undefined>(undefined)
  // Whether the toast on screen offers an action, for dismissActionToast, which keeps one identity from toast to toast.
  const offersAction = useRef(false)
  // A toast with an action waits while the pointer is over it or the keyboard focus is in it, so its button can still be
  // reached (WCAG 2.2.1): what holds it now, when its time runs out (on performance.now(), a clock that never jumps), and,
  // while it is held, the time it has left.
  const held = useRef({ pointer: false, focus: false })
  const endsAt = useRef(0)
  const timeLeft = useRef<number | null>(null)

  const dismiss = useCallback(() => {
    window.clearTimeout(timer.current)
    offersAction.current = false
    held.current = { pointer: false, focus: false }
    timeLeft.current = null
    setToast(null)
  }, [])

  /** Lets the toast's time run: it goes in `ms`. */
  const runFor = useCallback(
    (ms: number) => {
      window.clearTimeout(timer.current)
      timeLeft.current = null
      endsAt.current = performance.now() + ms
      timer.current = window.setTimeout(dismiss, ms)
    },
    [dismiss],
  )

  /** The pointer or the focus comes to the toast (`on`) or leaves it: its time stops while either is there, and runs on once both have gone. */
  const hold = useCallback(
    (by: 'pointer' | 'focus', on: boolean) => {
      held.current = { ...held.current, [by]: on }
      const isHeld = held.current.pointer || held.current.focus
      if (isHeld && timeLeft.current === null) {
        window.clearTimeout(timer.current)
        timeLeft.current = Math.max(0, endsAt.current - performance.now())
      } else if (!isHeld && timeLeft.current !== null) {
        runFor(timeLeft.current)
      }
    },
    [runFor],
  )

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
      offersAction.current = action !== null
      const ms = durationMs ?? (action ? ACTION_DURATION_MS : DURATION_MS)
      // A plain toast takes neither the pointer nor the focus: whatever held the toast before it has let go.
      if (!action) held.current = { pointer: false, focus: false }
      if (held.current.pointer || held.current.focus) {
        // Drawn where the held one was, under the same pointer or focus: its own time starts once they leave.
        window.clearTimeout(timer.current)
        timeLeft.current = ms
      } else {
        runFor(ms)
      }
    },
    [dismiss, runFor],
  )

  const dismissActionToast = useCallback(() => {
    if (offersAction.current) dismiss()
  }, [dismiss])

  useEffect(() => () => window.clearTimeout(timer.current), [])
  const api = useMemo(() => ({ showToast, dismissActionToast }), [showToast, dismissActionToast])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Always mounted, so assistive technology is already listening when a toast comes in (a live region inserted together
          with its text is often not announced); the toast itself is the status. Portalled under <body>, so this empty row is
          no part of the markup of what the provider wraps: it is fixed, so where it sits in the DOM does not show. */}
      {createPortal(
        <div data-testid="toast-region" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4">
          {toast ? (
            toast.action ? (
              // Takes its own taps, so a near miss of the button does not fall through to the page beneath; waits while in use.
              <div
                role="status"
                onPointerEnter={() => hold('pointer', true)}
                onPointerLeave={() => hold('pointer', false)}
                onFocus={() => hold('focus', true)}
                onBlur={() => hold('focus', false)}
                className="pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-surface-2 pl-4 pr-1 text-sm text-text shadow-lg"
              >
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

/**
 * For whatever opens over the page, such as a sheet: as `open` turns true, takes away a toast that offers an action. A toast
 * is drawn above a sheet (z-60 over its z-50), over its lower part (the Add form's keypad, the month picker's last row), and
 * one with a button takes the taps meant for the sheet there. A plain toast stays: it lets taps through, and it may say what
 * failed. Does nothing outside a ToastProvider.
 */
export function useDismissToastWhenOpened(open: boolean): void {
  const dismissActionToast = useContext(ToastContext)?.dismissActionToast
  useEffect(() => {
    if (open) dismissActionToast?.()
  }, [open, dismissActionToast])
}
