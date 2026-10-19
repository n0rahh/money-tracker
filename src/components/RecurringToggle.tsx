type Props = {
  checked: boolean
  onChange: (checked: boolean) => void
  /** The day of the entry's date: the day the entry repeats on (the last day of a shorter month). */
  dayOfMonth: number
}

/** The Add sheet's "repeat every month" switch: one 44 px row, the whole row is the control. */
export function RecurringToggle({ checked, onChange, dayOfMonth }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-chip bg-surface-2 px-3 text-left text-sm font-medium text-text"
    >
      <span>Repeat every month on day {dayOfMonth}</span>
      <span aria-hidden className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-border'}`}>
        <span className={`absolute top-0.5 size-5 rounded-full transition-[left] ${checked ? 'left-[1.125rem] bg-accent-ink' : 'left-0.5 bg-muted'}`} />
      </span>
    </button>
  )
}
