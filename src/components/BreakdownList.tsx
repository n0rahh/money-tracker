import { CATEGORY_COLORS } from '../lib/categoryColors'
import { formatMoney } from '../lib/money'
import type { CategoryTotal } from '../lib/stats'
import type { Category } from '../lib/types'
import { CategoryIcon } from './CategoryChip'

type Props = { rows: CategoryTotal[]; byId: Map<string, Category>; currency: string; locale: string | null }

export function BreakdownList({ rows, byId, currency, locale }: Props) {
  if (rows.length === 0) return null
  const max = rows[0].total
  return (
    <section className="mt-4">
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted">By category</h2>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => {
          const category = byId.get(r.categoryId)
          const color = category ? CATEGORY_COLORS[category.color] : CATEGORY_COLORS.slate
          return (
            <li key={r.categoryId} className="rounded-chip bg-surface px-3 py-2">
              <div className="flex items-center gap-3">
                <CategoryIcon category={category} size={32} />
                <span className="flex-1 truncate text-[15px]">{category?.name ?? 'Uncategorized'}</span>
                <span className="tnum text-[15px] font-medium">{formatMoney(r.total, currency, locale)}</span>
                <span className="tnum w-10 text-right text-xs text-muted">{Math.round(r.share * 100)}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full" style={{ width: `${(r.total / max) * 100}%`, background: color }} />
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
