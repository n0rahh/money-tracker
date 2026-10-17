import { useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTransactions } from '../hooks/useTransactions'
import { addMonths, currentMonth, lastMonths, monthLabel, monthOf, monthRange, monthShortLabel } from '../lib/dates'
import { formatMoney } from '../lib/money'
import { categoryDeltas } from '../lib/stats'
import type { Category, IsoMonth } from '../lib/types'
import { CategoryIcon } from './CategoryChip'
import { DeltaBadge } from './DeltaBadge'

type Props = {
  /** Every category by id, archived ones included (`useCategories().byId`). */
  byId: Map<string, Category>
  currency: string
  locale: string | null
}

const CELL = 'px-2 py-2'
const AMOUNT = `${CELL} whitespace-nowrap text-right`
const HEAD = `${CELL} text-xs font-semibold uppercase tracking-wider text-muted`
/** The category column takes what the amounts leave and truncates long names, so the table fits a phone. */
const NAME = 'w-full max-w-0 text-left'
/** A and B in a smaller size below `sm`, which leaves the names their room on a phone. */
const MONTH_AMOUNT = `${AMOUNT} text-xs sm:text-sm`
/** The icon only from `sm` up: below it, its width goes to the name. */
const ICON = 'hidden shrink-0 sm:inline-flex'

/** Spending per category in two chosen months, biggest change first. B is compared against A (B is "current"). */
export function CompareSection({ byId, currency, locale }: Props) {
  const headingId = useId()
  const thisMonth = currentMonth()
  const options = useMemo(() => lastMonths(thisMonth, 24).reverse(), [thisMonth])
  const [a, setA] = useState<IsoMonth>(() => addMonths(thisMonth, -1))
  const [b, setB] = useState<IsoMonth>(thisMonth)
  // One subscription from the earlier month to the later one, whichever of A and B that is.
  const [first, last] = a <= b ? [a, b] : [b, a]
  const { transactions, loading, error } = useTransactions(monthRange(first).from, monthRange(last).to)
  const deltas = useMemo(
    () =>
      categoryDeltas(
        transactions.filter((t) => monthOf(t.date) === b),
        transactions.filter((t) => monthOf(t.date) === a),
        'expense',
      ),
    [transactions, a, b],
  )
  const money = (minor: number) => formatMoney(minor, currency, locale)

  const picker = (label: string, value: IsoMonth, onChange: (month: IsoMonth) => void) => (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="px-1 text-xs text-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="min-h-11 w-full rounded-chip border border-border bg-surface-2 px-3 text-text">
        {options.map((m) => (
          <option key={m} value={m}>
            {monthLabel(m, locale)}
          </option>
        ))}
      </select>
    </label>
  )

  let body
  if (loading) body = <p className="mt-4 text-center text-sm text-muted">Loading…</p>
  // A failed query is not two empty months: its error stands alone.
  else if (error) body = <p className="mt-4 text-center text-sm text-danger">{error.message}</p>
  else if (deltas.length === 0) body = <p className="mt-4 text-center text-sm text-muted">Nothing to compare yet.</p>
  else {
    body = (
      <div className="mt-3 rounded-card bg-surface">
        <table aria-label="Change by category" className="tnum w-full text-sm">
          <thead>
            <tr>
              <th scope="col" className={`${HEAD} ${NAME} truncate`}>
                Category
              </th>
              <th scope="col" className={`${HEAD} whitespace-nowrap text-right`}>
                {monthShortLabel(a, locale)}
              </th>
              <th scope="col" className={`${HEAD} whitespace-nowrap text-right`}>
                {monthShortLabel(b, locale)}
              </th>
              <th scope="col" aria-label="Change" className={`${HEAD} text-right`}>
                Δ
              </th>
            </tr>
          </thead>
          <tbody>
            {deltas.map((d) => {
              const category = byId.get(d.categoryId)
              return (
                <tr key={d.categoryId} className="border-t border-border">
                  <th scope="row" className={`${CELL} ${NAME} font-normal`}>
                    {/* Opens on month B, the one compared; a category removed by hand has no page to open, so its row is not a link. */}
                    {category ? (
                      <Link to={`/category/${d.categoryId}?month=${b}`} className="flex min-h-11 min-w-0 items-center gap-2">
                        <span className={ICON}>
                          <CategoryIcon category={category} size={28} />
                        </span>
                        <span className="truncate">{category.name}</span>
                      </Link>
                    ) : (
                      <span className="flex min-h-11 min-w-0 items-center gap-2">
                        <span className={ICON}>
                          <CategoryIcon category={undefined} size={28} />
                        </span>
                        <span className="truncate">Uncategorized</span>
                      </span>
                    )}
                  </th>
                  <td className={MONTH_AMOUNT}>{money(d.previous)}</td>
                  <td className={MONTH_AMOUNT}>{money(d.current)}</td>
                  <td className={AMOUNT}>
                    <span className="flex flex-col items-end gap-1">
                      {/* Below `sm` the badge alone carries the change, leaving A and B their room. */}
                      <span className="hidden sm:inline">{formatMoney(d.delta, currency, locale, { signed: true })}</span>
                      <DeltaBadge deltaPct={d.deltaPct} previous={d.previous} />
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <h2 id={headingId} className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted">
        Compare two months
      </h2>
      <div className="grid grid-cols-2 gap-3">
        {picker('Month A', a, setA)}
        {picker('Month B', b, setB)}
      </div>
      {body}
    </section>
  )
}
