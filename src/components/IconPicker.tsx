import { useState } from 'react'
import { CATEGORY_ICONS, type IconKey } from '../lib/categoryIcons'
import { filterIcons } from '../lib/iconSearch'

type Props = { value: IconKey; onChange: (k: IconKey) => void; color: string }

export function IconPicker({ value, onChange, color }: Props) {
  const [query, setQuery] = useState('')
  const keys = filterIcons(query)
  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search icons"
        aria-label="Search icons"
        className="mb-2 min-h-11 w-full rounded-chip border border-border bg-surface-2 px-3 text-text placeholder:text-muted"
      />
      <div className="grid grid-cols-6 gap-2" role="listbox" aria-label="Icon">
        {keys.map((k) => {
          const Icon = CATEGORY_ICONS[k]
          const selected = k === value
          return (
            <button
              key={k}
              type="button"
              role="option"
              aria-selected={selected}
              aria-label={k}
              onClick={() => onChange(k)}
              className="flex aspect-square items-center justify-center rounded-chip transition active:scale-95"
              style={selected ? { background: color, color: '#0a0a0d' } : { background: 'var(--color-surface-2)', color: 'var(--color-text)' }}
            >
              <Icon size={22} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
