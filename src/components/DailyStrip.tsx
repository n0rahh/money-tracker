import type { MouseEvent } from 'react'
import { monthLabel, monthOf } from '../lib/dates'
import type { IsoDate, IsoMonth } from '../lib/types'

type Props = {
  /** Spending per day in minor units; index 0 is day 1. */
  values: number[]
  month: IsoMonth
  today: IsoDate
  onSelectDay: (date: IsoDate) => void
  formatValue: (minor: number) => string
  /** Locale for the month name in the label; the device locale when omitted. */
  locale?: string | null
}

const pad = (n: number) => String(n).padStart(2, '0')

export function DailyStrip({ values, month, today, onSelectDay, formatValue, locale }: Props) {
  const max = Math.max(1, ...values)
  const sum = values.reduce((a, b) => a + b, 0)
  // Only the current month has a today and days still to come. A future month is deliberately not dimmed:
  // it is only visited to find entries dated there by mistake, and those should read as spending.
  const todayDay = monthOf(today) === month ? Number(today.slice(8)) : null
  const tone = (day: number) => (day === todayDay ? 'bg-accent' : todayDay !== null && day > todayDay ? 'bg-surface-2' : 'bg-expense/70')

  // The columns are too thin to be targets of their own, so the whole strip is one and the tap's x position picks the day.
  const selectDay = (e: MouseEvent<HTMLDivElement>) => {
    const { left, width } = e.currentTarget.getBoundingClientRect()
    // A box without width (not laid out) would give 0 / 0 = NaN; read it as the first day instead.
    const ratio = width > 0 ? (e.clientX - left) / width : 0
    const day = Math.floor(ratio * values.length) + 1
    onSelectDay(`${month}-${pad(Math.max(1, Math.min(values.length, day)))}`)
  }

  return (
    // 44 px tall for the touch target, with a 40 px track inside the padding.
    <div
      role="img"
      aria-label={`Daily spending in ${monthLabel(month, locale)}: ${formatValue(sum)} over ${values.length} days`}
      onClick={selectDay}
      className="flex h-11 cursor-pointer touch-manipulation items-end gap-0.5 py-0.5"
    >
      {values.map((v, i) => (
        // min-h-0.5 keeps a 2 px baseline under days without spending, so the strip is always visible.
        <div key={i} data-testid="day" className={`min-h-0.5 min-w-1 flex-1 rounded-t-xs ${tone(i + 1)}`} style={{ height: `${(v / max) * 100}%` }} />
      ))}
    </div>
  )
}
