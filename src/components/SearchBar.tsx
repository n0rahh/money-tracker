import { Search, X } from 'lucide-react'
import { useImperativeHandle, useRef, type Ref } from 'react'
import type { KindFilter } from '../lib/search'
import { SegmentedControl } from './SegmentedControl'

const KIND_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'expense', label: 'Expenses' },
  { value: 'income', label: 'Income' },
]

/** What the caller can do with the bar: focus its field, without scrolling (the caller puts the bar where it belongs). */
export type SearchBarHandle = { focus: () => void }

type Props = {
  value: string
  onChange: (value: string) => void
  kind: KindFilter
  onKindChange: (kind: KindFilter) => void
  /**
   * For the caller to focus the field when it reveals the bar. The bar never takes the focus by itself: one that comes back
   * on its own (the list it searches returns after an undone delete) leaves the focus where it is.
   */
  ref?: Ref<SearchBarHandle>
}

/** The query and kind filter for a list of entries. */
export function SearchBar({ value, onChange, kind, onKindChange, ref }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus({ preventScroll: true }) }), [])
  return (
    <div role="search" className="flex flex-col gap-2">
      <div className="relative">
        <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        {/* 16 px like every input (index.css), so iOS does not zoom in; WebKit's own clear button gives way to the 44 px one.
            The keyboard shows a search key, and nothing corrects, capitalises or underlines what is typed: "zabka" stays zabka. */}
        <input
          ref={inputRef}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // The keyboard's search key puts it away, uncovering the entries found.
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          enterKeyHint="search"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
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
