import { useState } from 'react'
import { filterCurrencies } from '../lib/currencies'
import { Sheet } from './Sheet'

type Props = {
  open: boolean
  current: string | null
  onSelect: (code: string) => void
  onClose?: () => void
  dismissible?: boolean
  title?: string
  note?: string
}

export function CurrencySheet({ open, current, onSelect, onClose, dismissible = true, title = 'Choose currency', note }: Props) {
  const [query, setQuery] = useState('')
  const list = filterCurrencies(query)
  return (
    <Sheet open={open} title={title} onClose={onClose ?? (() => {})} dismissible={dismissible}>
      {note ? <p className="mb-3 text-sm text-muted">{note}</p> : null}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search"
        aria-label="Search currency"
        className="mb-3 min-h-11 w-full rounded-chip border border-border bg-surface-2 px-3 text-text placeholder:text-muted"
      />
      <ul className="flex flex-col gap-1">
        {list.map((c) => (
          <li key={c.code}>
            <button
              type="button"
              onClick={() => onSelect(c.code)}
              className={`flex min-h-12 w-full items-center justify-between rounded-chip px-3 text-left ${c.code === current ? 'bg-surface-2 text-accent' : 'active:bg-surface-2'}`}
            >
              <span>{c.name}</span>
              <span className="tnum text-sm text-muted">{c.code}</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}
