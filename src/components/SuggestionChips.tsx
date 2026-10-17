import { formatMoney } from '../lib/money'
import type { Suggestion } from '../lib/stats'
import type { Category } from '../lib/types'
import { CategoryIcon } from './CategoryChip'

type Props = {
  items: Suggestion[]
  /** Categories by id; a combo whose category is gone reads "Uncategorized". */
  byId: Map<string, Category>
  currency: string
  locale: string | null
  onPick: (s: Suggestion) => void
}

/** One-tap combos for a new entry, e.g. "Coffee · €3.50 · canteen"; nothing at all when there are none. */
export function SuggestionChips({ items, byId, currency, locale, onPick }: Props) {
  if (items.length === 0) return null
  return (
    <div role="group" aria-label="Quick add" className="-mx-4 overflow-x-auto px-4">
      {/* As wide as the chips, so the scroller's end padding comes after the last one instead of under it. */}
      <div className="flex w-max gap-2">
        {items.map((s) => {
          const category = byId.get(s.categoryId)
          return (
            <button
              key={`${s.kind}|${s.categoryId}|${s.amount}|${s.note}`}
              type="button"
              onClick={() => onPick(s)}
              className="flex min-h-11 shrink-0 items-center gap-2 rounded-chip bg-surface-2 px-3 text-sm font-medium transition active:scale-95"
            >
              <CategoryIcon category={category} size={28} />
              {/* One run of text, so the accessible name reads as shown. The spaces between the parts sit outside the inner spans,
                  since a name computation may trim each element's own text ("€4.20· oat latte"). A long note is cut short. */}
              <span className="whitespace-nowrap">
                {category?.name ?? 'Uncategorized'} · <span className={s.kind === 'income' ? 'tnum text-accent' : 'tnum'}>{formatMoney(s.amount, currency, locale)}</span>
                {s.note ? (
                  <>
                    {' '}
                    <span className="text-muted">
                      {'· '}
                      <span className="inline-block max-w-40 truncate align-bottom">{s.note}</span>
                    </span>
                  </>
                ) : null}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
