type Bar = { key: string; label: string; value: number; secondary?: number }

type Props = {
  bars: Bar[]
  selectedKey?: string | null
  onSelect?: (key: string) => void
  /** Formats a minor-unit amount for the accessible labels. */
  formatValue: (minor: number) => string
  ariaLabel: string
}

export function BarChart({ bars, selectedKey, onSelect, formatValue, ariaLabel }: Props) {
  if (bars.length === 0) return <p className="text-sm text-muted">No data for this range.</p>
  // Bars and income dots share one scale; the floor of 1 keeps an all-zero range flat instead of dividing by zero.
  const max = Math.max(1, ...bars.map((b) => b.value), ...bars.flatMap((b) => (b.secondary === undefined ? [] : [b.secondary])))
  const pct = (minor: number) => `${(minor / max) * 100}%`
  return (
    <div role="group" aria-label={ariaLabel} className="flex">
      {bars.map(({ key, label, value, secondary }) => {
        const selected = key === selectedKey
        return (
          // Each column is one full-width button; the gap between bars is padding inside it, so the hit areas touch.
          <button
            key={key}
            type="button"
            aria-pressed={selected}
            aria-label={`${label}: ${formatValue(value)}${secondary !== undefined ? `, income ${formatValue(secondary)}` : ''}`}
            onClick={() => onSelect?.(key)}
            className="flex min-h-11 min-w-0 flex-1 flex-col items-center gap-1.5 rounded-md px-0.5 pt-1.5 pb-1"
          >
            <span className="relative flex h-[120px] w-full items-end justify-center">
              <span data-testid="bar" className={`w-full max-w-10 rounded-t-md ${selected ? 'bg-accent' : 'bg-expense/80'}`} style={{ height: pct(value) }} />
              {secondary !== undefined ? (
                // Centred on its value; the ring in the page colour keeps it visible over a selected (accent) bar.
                <span
                  data-testid="dot"
                  className="absolute left-1/2 size-1.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-accent ring-2 ring-bg"
                  style={{ bottom: pct(secondary) }}
                />
              ) : null}
            </span>
            <span className={`tnum text-[11px] leading-tight ${selected ? 'text-text' : 'text-muted'}`}>{label}</span>
          </button>
        )
      })}
    </div>
  )
}
