import { CATEGORY_COLORS } from '../lib/categoryColors'
import { formatMoney } from '../lib/money'
import type { CategoryDelta, CategoryTotal } from '../lib/stats'
import type { Category } from '../lib/types'
import { CategoryIcon } from './CategoryChip'
import { DeltaBadge } from './DeltaBadge'

type Props = {
  rows: CategoryTotal[]
  byId: Map<string, Category>
  currency: string
  locale: string | null
  /** The change against last month by category id; each row then ends with its badge. */
  deltas?: Map<string, CategoryDelta>
  /** What the badges compare with, beside the heading while there are badges. */
  legend?: string
  /** Makes each row a button that opens its category; a category removed by hand has no page, so its row stays plain. */
  onSelect?: (categoryId: string) => void
}

export function BreakdownList({ rows, byId, currency, locale, deltas, legend = 'vs previous month', onSelect }: Props) {
  if (rows.length === 0) return null
  const max = rows[0].total
  return (
    <section className="mt-4">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">By category</h2>
        {deltas ? <span className="text-xs text-muted">{legend}</span> : null}
      </div>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => {
          const category = byId.get(r.categoryId)
          const color = category ? CATEGORY_COLORS[category.color] : CATEGORY_COLORS.slate
          const delta = deltas?.get(r.categoryId)
          // Spans only: inside a button the row may hold phrasing content alone.
          const content = (
            <>
              <span className="flex items-center gap-3">
                <CategoryIcon category={category} size={32} />
                <span className="flex-1 truncate text-[15px]">{category?.name ?? 'Uncategorized'}</span>
                <span className="tnum text-[15px] font-medium">{formatMoney(r.total, currency, locale)}</span>
                <span className="tnum w-10 text-right text-xs text-muted">{Math.round(r.share * 100)}%</span>
              </span>
              <span className="mt-2 flex items-center gap-2">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <span className="block h-full rounded-full" style={{ width: `${(r.total / max) * 100}%`, background: color }} />
                </span>
                {/* Under the share, clear of the name; the same minimum slot width in every row keeps the bars comparable. */}
                {deltas ? (
                  <span className="flex min-w-14 justify-end">{delta ? <DeltaBadge deltaPct={delta.deltaPct} previous={delta.previous} /> : null}</span>
                ) : null}
              </span>
            </>
          )
          return onSelect && category ? (
            <li key={r.categoryId}>
              <button type="button" onClick={() => onSelect(r.categoryId)} className="block w-full rounded-chip bg-surface px-3 py-2 text-left active:bg-surface-2">
                {content}
              </button>
            </li>
          ) : (
            <li key={r.categoryId} className="rounded-chip bg-surface px-3 py-2">
              {content}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
