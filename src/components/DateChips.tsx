import { addDays, todayIso } from '../lib/dates'
import type { IsoDate } from '../lib/types'

type Props = { value: IsoDate; onChange: (d: IsoDate) => void }

export function DateChips({ value, onChange }: Props) {
  const today = todayIso()
  const yesterday = addDays(today, -1)
  const custom = value !== today && value !== yesterday
  const chip = (label: string, date: IsoDate) => (
    <button
      key={label}
      type="button"
      aria-pressed={value === date}
      onClick={() => onChange(date)}
      className={`min-h-11 rounded-full px-3 text-sm font-medium ${value === date ? 'bg-text text-bg' : 'bg-surface-2 text-muted'}`}
    >
      {label}
    </button>
  )
  return (
    <div className="flex items-center gap-2">
      {chip('Today', today)}
      {chip('Yesterday', yesterday)}
      <label className={`relative flex min-h-11 items-center rounded-full px-3 text-sm font-medium ${custom ? 'bg-text text-bg' : 'bg-surface-2 text-muted'}`}>
        {custom ? value : 'Pick…'}
        <input
          type="date"
          aria-label="Pick a date"
          value={value}
          onChange={(e) => {
            if (e.target.value) onChange(e.target.value)
          }}
          className="absolute inset-0 opacity-0"
        />
      </label>
    </div>
  )
}
