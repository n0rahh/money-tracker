import { ChevronLeft, ChevronRight } from 'lucide-react'
import { addMonths, currentMonth, monthLabel } from '../lib/dates'
import type { IsoMonth } from '../lib/types'

type Props = { month: IsoMonth; locale: string | null; onChange: (m: IsoMonth) => void }

export function MonthSwitcher({ month, locale, onChange }: Props) {
  const isCurrent = month === currentMonth()
  return (
    <div className="flex items-center justify-between py-3">
      <button type="button" aria-label="Previous month" onClick={() => onChange(addMonths(month, -1))} className="flex size-11 items-center justify-center rounded-full bg-surface-2 text-text">
        <ChevronLeft size={20} />
      </button>
      <h1 className="text-lg font-semibold">{monthLabel(month, locale)}</h1>
      <button type="button" aria-label="Next month" disabled={isCurrent} onClick={() => onChange(addMonths(month, 1))} className="flex size-11 items-center justify-center rounded-full bg-surface-2 text-text disabled:opacity-30">
        <ChevronRight size={20} />
      </button>
    </div>
  )
}
