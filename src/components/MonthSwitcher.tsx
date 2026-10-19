import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { addMonths, monthLabel } from '../lib/dates'
import type { IsoMonth } from '../lib/types'

type Props = {
  month: IsoMonth
  locale: string | null
  onChange: (m: IsoMonth) => void
  /** The month label opens the month/year picker. */
  onOpenPicker: () => void
}

export function MonthSwitcher({ month, locale, onChange, onOpenPicker }: Props) {
  return (
    <div className="flex items-center justify-between py-3">
      <button type="button" aria-label="Previous month" onClick={() => onChange(addMonths(month, -1))} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text">
        <ChevronLeft size={20} />
      </button>
      {/* Still the page's heading; the month in it is the way to any month of any year. A label too long for a 375 px phone
          (Spanish, "septiembre de 2026") is cut short rather than squeezing the arrows below 44 px. */}
      <h1 className="min-w-0 text-lg font-semibold">
        <button type="button" aria-haspopup="dialog" onClick={onOpenPicker} className="flex min-h-11 max-w-full items-center gap-1 rounded-full px-2 active:bg-surface-2">
          <span className="truncate">{monthLabel(month, locale)}</span>
          <ChevronDown size={16} className="shrink-0 text-muted" />
        </button>
      </h1>
      {/* Never disabled: future months stay reachable, so an entry saved with a wrong (future) date can be found and fixed. */}
      <button type="button" aria-label="Next month" onClick={() => onChange(addMonths(month, 1))} className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text">
        <ChevronRight size={20} />
      </button>
    </div>
  )
}
