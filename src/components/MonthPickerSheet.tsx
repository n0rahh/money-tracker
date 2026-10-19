import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useId, useState } from 'react'
import { addMonths, monthsBetween } from '../lib/dates'
import type { IsoMonth } from '../lib/types'
import { Sheet } from './Sheet'

type Props = {
  open: boolean
  /** The month on show: the picker opens on its year, with its button pressed. */
  month: IsoMonth
  locale: string | null
  onSelect: (month: IsoMonth) => void
  onClose: () => void
}

/** Any month of any year in two taps; months ahead too, so an entry saved with a wrong (future) date can be found. */
export function MonthPickerSheet({ open, month, locale, onSelect, onClose }: Props) {
  return (
    // The safe-area padding keeps the last row of months clear of the home indicator.
    <Sheet open={open} title="Choose month" onClose={onClose} bodyClassName="safe-pb">
      {/* Mounted while the sheet is open only (a closed Sheet renders nothing), so every opening starts on the month on show. */}
      <YearOfMonths
        month={month}
        locale={locale}
        onPick={(picked) => {
          onSelect(picked)
          onClose()
        }}
      />
    </Sheet>
  )
}

function YearOfMonths({ month, locale, onPick }: { month: IsoMonth; locale: string | null; onPick: (month: IsoMonth) => void }) {
  const yearId = useId()
  // January of the year on show. The arrows move it a year at a time and pick nothing.
  const [january, setJanuary] = useState<IsoMonth>(() => `${month.slice(0, 4)}-01`)
  const months = monthsBetween(january, addMonths(january, 11))
  const year = Number(january.slice(0, 4))
  const monthName = new Intl.DateTimeFormat(locale ?? undefined, { month: 'long' })
  const arrow = 'flex size-11 items-center justify-center rounded-full bg-surface-2 text-text'
  return (
    <>
      <div className="flex items-center justify-between">
        <button type="button" aria-label="Previous year" onClick={() => setJanuary(addMonths(january, -12))} className={arrow}>
          <ChevronLeft size={20} />
        </button>
        {/* Read out as it changes: the arrows keep the focus, so nothing else would say which year is on show. */}
        <p id={yearId} aria-live="polite" className="tnum text-lg font-semibold">
          {new Intl.DateTimeFormat(locale ?? undefined, { year: 'numeric' }).format(new Date(year, 0, 1))}
        </p>
        <button type="button" aria-label="Next year" onClick={() => setJanuary(addMonths(january, 12))} className={arrow}>
          <ChevronRight size={20} />
        </button>
      </div>
      <div role="group" aria-labelledby={yearId} className="mt-3 grid grid-cols-3 gap-2">
        {months.map((m, i) => (
          <button
            key={m}
            type="button"
            aria-pressed={m === month}
            onClick={() => onPick(m)}
            className={`min-h-11 rounded-chip px-2 text-[15px] transition active:scale-[0.97] ${m === month ? 'bg-accent font-semibold text-accent-ink' : 'bg-surface-2 text-text'}`}
          >
            {monthName.format(new Date(year, i, 1))}
          </button>
        ))}
      </div>
    </>
  )
}
