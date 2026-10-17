import { dayLabel } from '../lib/dates'
import { formatMoney } from '../lib/money'
import type { DayGroup } from '../lib/stats'
import type { Category, IsoDate, Transaction } from '../lib/types'
import { CategoryIcon } from './CategoryChip'

type Props = {
  groups: DayGroup[]
  byId: Map<string, Category>
  currency: string
  locale: string | null
  today: IsoDate
  onSelect: (tx: Transaction) => void
}

export function TransactionList({ groups, byId, currency, locale, today, onSelect }: Props) {
  return (
    <section className="mt-4">
      {groups.map((g) => (
        // The id is the daily strip's jump target; the scroll margin keeps the day's heading clear of the status bar.
        <div key={g.date} id={`day-${g.date}`} className="mb-3 scroll-mt-[max(0.5rem,env(safe-area-inset-top))]">
          <div className="flex items-baseline justify-between px-1 py-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">{dayLabel(g.date, today, locale)}</h3>
            <span className="tnum text-xs text-muted">
              {g.totals.expense > 0 ? `−${formatMoney(g.totals.expense, currency, locale)}` : ''}
              {g.totals.income > 0 ? ` +${formatMoney(g.totals.income, currency, locale)}` : ''}
            </span>
          </div>
          <ul className="overflow-hidden rounded-card bg-surface">
            {g.items.map((t) => {
              const category = byId.get(t.categoryId)
              return (
                <li key={t.id}>
                  <button type="button" onClick={() => onSelect(t)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-surface-2">
                    <CategoryIcon category={category} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px]">{category?.name ?? 'Uncategorized'}</span>
                      {t.note ? <span className="block truncate text-xs text-muted">{t.note}</span> : null}
                    </span>
                    <span className={`tnum text-[15px] font-medium ${t.kind === 'income' ? 'text-accent' : 'text-text'}`}>
                      {t.kind === 'income' ? '+' : ''}
                      {formatMoney(t.amount, currency, locale)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </section>
  )
}
