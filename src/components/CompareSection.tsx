import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTransactions } from '../hooks/useTransactions'
import { addMonths, currentMonth, isIsoMonth, lastMonths, monthLabel, monthRange, monthShortLabel } from '../lib/dates'
import { formatMoney } from '../lib/money'
import { readErrorText } from '../lib/readError'
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

/** A and B are remembered for the session, so Back from a category page returns to the same comparison. */
const A_KEY = 'compare.a'
const B_KEY = 'compare.b'

function rememberedMonth(key: string, offered: IsoMonth[], fallback: IsoMonth): IsoMonth {
  try {
    const stored = sessionStorage.getItem(key)
    // Only a month the pickers still offer: a session can outlive the 24 months on offer.
    return isIsoMonth(stored) && offered.includes(stored) ? stored : fallback
  } catch {
    return fallback // storage refused (a locked-down browser)
  }
}

function rememberMonth(key: string, month: IsoMonth) {
  try {
    sessionStorage.setItem(key, month)
  } catch {
    // Storage refused: the pick is simply not remembered.
  }
}

/** Spending per category in two chosen months, biggest change first. B is compared against A (B is "current"). */
export function CompareSection({ byId, currency, locale }: Props) {
  const headingId = useId()
  const thisMonth = currentMonth()
  const options = useMemo(() => lastMonths(thisMonth, 24).reverse(), [thisMonth])
  const [a, setA] = useState<IsoMonth>(() => rememberedMonth(A_KEY, options, addMonths(thisMonth, -1)))
  const [b, setB] = useState<IsoMonth>(() => rememberedMonth(B_KEY, options, thisMonth))
  // One month-shaped subscription per month, the same queries Home makes: a pick reads only the month picked (or finds it
  // in the cache), never the months between A and B.
  const rangeA = monthRange(a)
  const rangeB = monthRange(b)
  const inA = useTransactions(rangeA.from, rangeA.to)
  const inB = useTransactions(rangeB.from, rangeB.to)
  const loading = inA.loading || inB.loading
  const error = inA.error ?? inB.error
  const deltas = useMemo(() => categoryDeltas(inB.transactions, inA.transactions, 'expense'), [inA.transactions, inB.transactions])
  const money = (minor: number) => formatMoney(minor, currency, locale)
  // The category page shows the last twelve months, so it can open on B only when B is one of them.
  const linkMonth = b >= lastMonths(thisMonth, 12)[0] ? b : null
  // While a new pair of months loads, the section keeps the height it had settled at, so the page below
  // does not collapse and the scroll position is not clamped.
  const bodyRef = useRef<HTMLDivElement>(null)
  const [settledHeight, setSettledHeight] = useState(0)
  useLayoutEffect(() => {
    if (!loading && bodyRef.current) setSettledHeight(bodyRef.current.offsetHeight)
  })

  function pickA(month: IsoMonth) {
    setA(month)
    rememberMonth(A_KEY, month)
  }

  function pickB(month: IsoMonth) {
    setB(month)
    rememberMonth(B_KEY, month)
  }

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
  else if (error) body = <p className="mt-4 text-center text-sm text-danger">{readErrorText(error)}</p>
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
                    {/* Opens on month B, the one compared, when the page can show it; a category removed by hand has no page, so no link. */}
                    {category ? (
                      <Link
                        to={linkMonth ? `/category/${d.categoryId}?month=${linkMonth}` : `/category/${d.categoryId}`}
                        className="flex min-h-11 min-w-0 items-center gap-2"
                      >
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
        {picker('Month A', a, pickA)}
        {picker('Month B', b, pickB)}
      </div>
      {/* flow-root: the children's top margins count inside the measured height. */}
      <div ref={bodyRef} className="flow-root" style={loading ? { minHeight: settledHeight } : undefined}>
        {body}
      </div>
    </section>
  )
}
