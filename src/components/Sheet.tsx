import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'

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
}

export function Sheet({ open, title, onClose, children, footer, full = false, headerRight, dismissible = true }: Props) {
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && dismissible) onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, dismissible])

  if (!open) return null

  const shape = full
    ? 'h-dvh rounded-none md:h-auto md:max-h-[90vh] md:rounded-card'
    : 'max-h-[92dvh] rounded-t-card md:max-h-[85vh] md:rounded-card'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6">
      <button
        type="button"
        aria-label="Dismiss"
        className="absolute inset-0 bg-black/60 transition-opacity duration-200 starting:opacity-0"
        onClick={dismissible ? onClose : undefined}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative z-10 flex w-full max-w-lg flex-col border border-border bg-surface transition-transform duration-200 ease-out starting:translate-y-full md:starting:translate-y-4 ${shape}`}
      >
        <div className="safe-pt flex items-center justify-between px-4 pb-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <div className="flex items-center gap-2">
            {headerRight}
            {dismissible ? (
              <button type="button" aria-label="Close" onClick={onClose} className="flex size-10 items-center justify-center rounded-full bg-surface-2 text-muted">
                <X size={18} />
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        {footer ? <div className="safe-pb border-t border-border px-4 pt-3">{footer}</div> : null}
      </div>
    </div>
  )
}
