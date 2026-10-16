type Option<T extends string> = { value: T; label: string }
type Props<T extends string> = { value: T; options: Option<T>[]; onChange: (v: T) => void; ariaLabel: string }

export function SegmentedControl<T extends string>({ value, options, onChange, ariaLabel }: Props<T>) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex rounded-full bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`min-h-11 flex-1 rounded-full text-sm font-medium transition ${o.value === value ? 'bg-surface text-text' : 'text-muted'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
