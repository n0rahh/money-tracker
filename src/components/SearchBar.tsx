import { Search, X } from 'lucide-react'
import { useLayoutEffect, useRef } from 'react'
import type { Kind } from '../lib/types'
import { SegmentedControl } from './SegmentedControl'

/** The entries a search keeps by kind: both kinds, or one of them. */
export type KindFilter = 'all' | Kind

const KIND_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'expense', label: 'Expenses' },
  { value: 'income', label: 'Income' },
]

type Props = {
  value: string
  onChange: (value: string) => void
  kind: KindFilter
  onKindChange: (kind: KindFilter) => void
}

/** The query and kind filter for a list of entries. It appears on request only, so it takes the focus as it appears. */
export function SearchBar({ value, onChange, kind, onKindChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  // In the commit that mounts it, so a caller that renders it synchronously inside a tap gets the keyboard on iOS (which
  // raises it only for a focus given during the tap). Without scrolling: the caller puts the bar where it belongs.
  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
  }, [])
  return (
    <div role="search" className="flex flex-col gap-2">
      <div className="relative">
        <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        {/* 16 px like every input (index.css), so iOS does not zoom in; WebKit's own clear button gives way to the 44 px one. */}
        <input
          ref={inputRef}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // The keyboard's search key puts it away, uncovering the entries found.
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          placeholder="Search notes and categories"
          aria-label="Search notes and categories"
          className="h-11 w-full appearance-none rounded-chip border border-border bg-surface-2 pl-10 pr-11 text-text placeholder:text-muted [&::-webkit-search-cancel-button]:appearance-none"
        />
        {value ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              onChange('')
              inputRef.current?.focus()
            }}
            className="absolute right-0 top-0 flex size-11 items-center justify-center rounded-full text-muted"
          >
            <X size={18} />
          </button>
        ) : null}
      </div>
      <SegmentedControl ariaLabel="Kind" value={kind} options={KIND_OPTIONS} onChange={onKindChange} />
    </div>
  )
}
