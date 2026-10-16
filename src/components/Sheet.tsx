import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'

type Props = {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Full-height sheet on phones (used by the Add/Edit form). */
  full?: boolean
  headerRight?: ReactNode
  /** When false, no close button and the backdrop does not close (first-run flows). */
  dismissible?: boolean
  /** Extra classes for the scrolling body, e.g. scroll padding under a sticky block. */
  bodyClassName?: string
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Sheet({ open, title, onClose, children, footer, full = false, headerRight, dismissible = true, bodyClassName = '' }: Props) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (dismissible) onClose()
        return
      }
      const dialog = dialogRef.current
      if (e.key !== 'Tab' || !dialog) return
      // Trap Tab inside the dialog: wrap at both ends, and pull focus back in if it ever left.
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) {
        e.preventDefault()
        dialog.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const outside = !dialog.contains(active)
      if (e.shiftKey && (outside || active === first || active === dialog)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (outside || active === last)) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, dismissible])

  // Kept apart from the effect above: that one re-runs whenever `onClose` changes identity and must not re-steal focus.
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement
    dialogRef.current?.focus({ preventScroll: true })
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [open])

  if (!open) return null

  const shape = full
    ? 'h-dvh rounded-none md:h-auto md:max-h-[90vh] md:rounded-card'
    : 'max-h-[92dvh] rounded-t-card md:max-h-[85vh] md:rounded-card'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/60 transition-opacity duration-200 starting:opacity-0"
        onClick={dismissible ? onClose : undefined}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative z-10 flex w-full max-w-lg flex-col border border-border bg-surface outline-none! transition-transform duration-200 ease-out starting:translate-y-full md:starting:translate-y-4 ${shape}`}
      >
        <div className="safe-pt flex items-center justify-between px-4 pb-2">
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          <div className="flex items-center gap-2">
            {headerRight}
            {dismissible ? (
              <button type="button" aria-label="Close" onClick={onClose} className="flex size-11 items-center justify-center rounded-full bg-surface-2 text-muted">
                <X size={18} />
              </button>
            ) : null}
          </div>
        </div>
        <div className={`flex-1 overflow-y-auto px-4 pb-4 ${bodyClassName}`}>{children}</div>
        {footer ? <div className="safe-pb border-t border-border px-4 pt-3">{footer}</div> : null}
      </div>
    </div>
  )
}
