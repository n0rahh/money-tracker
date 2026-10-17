import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart } from '../components/BarChart'
import { CacheHint } from '../components/CacheHint'
import { CategoryChip } from '../components/CategoryChip'
import { CompareSection } from '../components/CompareSection'
import { DeltaBadge } from '../components/DeltaBadge'
import { SegmentedControl } from '../components/SegmentedControl'
import { useCategories } from '../hooks/useCategories'
import { useSettings } from '../hooks/useSettings'
import { useTransactions } from '../hooks/useTransactions'
import { useVisibilityTick } from '../hooks/useVisibilityTick'
import { addMonths, currentMonth, monthLabel, monthRange, monthShortLabel } from '../lib/dates'
import { formatMoney } from '../lib/money'
import { readErrorText } from '../lib/readError'
import { monthlyTotals, percentChange, rangeMonths } from '../lib/stats'
import type { MonthTotals, RangeKey } from '../lib/stats'
import type { IsoMonth } from '../lib/types'

const RANGES: RangeKey[] = ['3M', '6M', '12M', 'YTD']
const RANGE_OPTIONS = RANGES.map((r) => ({ value: r, label: r }))
/** Remembered for the session only: a fresh launch opens on 6M again. */
const RANGE_KEY = 'trends.range'

function rememberedRange(): RangeKey {
  try {
    const stored = sessionStorage.getItem(RANGE_KEY)
    return RANGES.find((r) => r === stored) ?? '6M'
  } catch {
    return '6M' // storage refused (a locked-down browser)
  }
}

const CELL = 'px-2 py-2'
const AMOUNT = `${CELL} whitespace-nowrap text-right`
const HEAD = `${CELL} whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-muted`
/** Income and Net get columns of their own from `sm` up; below it they sit under the month, so the table fits a phone. */
const WIDE = 'hidden sm:table-cell'
/** Income and net while a filter is on: the chosen expense categories hold no income, so the figures would only echo the spending. */
const NONE = '—'

export function TrendsPage() {
  useVisibilityTick() // re-renders on each return to the foreground, so the range moves on with the calendar
  const { categories, byId, loading: categoriesLoading, error: categoriesError } = useCategories()
  const { settings, loading: settingsLoading } = useSettings()
  const [range, setRange] = useState<RangeKey>(rememberedRange)
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<ReadonlySet<string>>(() => new Set())
  const [selectedMonth, setSelectedMonth] = useState<IsoMonth | null>(null)

  const thisMonth = currentMonth()
  // rangeMonths reads the clock itself; `thisMonth` rebuilds the list once the month turns.
  const months = useMemo(() => rangeMonths(range), [range, thisMonth])
  const before = addMonths(months[0], -1)
  // The month before the range comes along: the first month's change is measured against it.
  const { transactions, loading, fromCache, error } = useTransactions(monthRange(before).from, monthRange(months[months.length - 1]).to)
  const filtered = useMemo(
    () => (selectedCategoryIds.size ? transactions.filter((t) => selectedCategoryIds.has(t.categoryId)) : transactions),
    [transactions, selectedCategoryIds],
  )
  const rows = useMemo(() => monthlyTotals(filtered, months), [filtered, months])
  const prevRow = useMemo(() => monthlyTotals(filtered, [before])[0], [filtered, before])
  // The rows of the last range that finished loading (stored while rendering, as React documents for values from earlier
  // renders), so archived chips do not blink out while the next range loads.
  const [settledRows, setSettledRows] = useState(transactions)
  if (!loading && settledRows !== transactions) setSettledRows(transactions)
  const used = useMemo(() => new Set(settledRows.map((t) => t.categoryId)), [settledRows])
  // Archived categories only while the range holds their entries, or while chosen: a filter never applies out of sight.
  const chips = categories.filter((c) => c.kind === 'expense' && (!c.archived || used.has(c.id) || selectedCategoryIds.has(c.id)))
  // A tapped month stays selected only while the range shows it.
  const shown = rows.find((r) => r.month === selectedMonth)
  const filtering = selectedCategoryIds.size > 0

  function changeRange(next: RangeKey) {
    setRange(next)
    try {
      sessionStorage.setItem(RANGE_KEY, next)
    } catch {
      // Storage refused: the range is simply not remembered.
    }
  }

  function toggleCategory(id: string) {
    setSelectedCategoryIds((ids) => {
      const next = new Set(ids)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  // The fallback only applies to a genuinely missing settings document (first run), never while it loads.
  const currency = settings?.currency ?? 'USD'
  const locale = settings?.locale ?? null
  const money = (minor: number) => formatMoney(minor, currency, locale)
  const signed = (minor: number) => formatMoney(minor, currency, locale, { signed: true })
  const incomeOf = (r: MonthTotals) => (filtering ? NONE : money(r.income))
  const netOf = (r: MonthTotals) => (filtering ? NONE : signed(r.net))
  const loadingLine = <p className="mt-6 text-center text-sm text-muted">Loading…</p>

  // `cachedOnly`: the range's rows are on screen, but only from the local cache so far.
  const header = (cachedOnly: boolean) => (
    <>
      <div className="flex items-center justify-between gap-3 py-3">
        <h1 className="text-lg font-semibold">Trends</h1>
        <CacheHint show={cachedOnly} />
      </div>
      <SegmentedControl ariaLabel="Range" value={range} options={RANGE_OPTIONS} onChange={changeRange} />
      {chips.length > 0 ? (
        <div role="group" aria-label="Filter by category" className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
          {chips.map((c) => (
            <CategoryChip key={c.id} category={c} selected={selectedCategoryIds.has(c.id)} onClick={() => toggleCategory(c.id)} />
          ))}
        </div>
      ) : null}
    </>
  )

  if (settingsLoading || categoriesLoading) {
    // No amounts until the currency is known, and no "Uncategorized" comparison rows before the names arrive.
    return (
      <>
        {header(false)}
        {loadingLine}
      </>
    )
  }

  if (categoriesError) {
    // Without the categories every comparison row would read "Uncategorized": the error stands alone.
    return (
      <>
        {header(false)}
        <p className="mt-4 text-center text-sm text-danger">{readErrorText(categoriesError)}</p>
      </>
    )
  }

  const emptyText = filtering ? 'No data for the selected categories in this range.' : 'No data for this range.'
  let data
  if (loading) data = loadingLine
  // A failed query is not a range of empty months: its error stands alone.
  else if (error) data = <p className="mt-4 text-center text-sm text-danger">{readErrorText(error)}</p>
  else if (rows.every((r) => r.expense === 0 && r.income === 0)) data = <p className="mt-6 text-center text-sm text-muted">{emptyText}</p>
  else {
    // Newest first; each month against the one before it, the first against the month before the range.
    const tableRows = rows.map((r, i) => ({ ...r, previous: (i === 0 ? prevRow : rows[i - 1]).expense })).reverse()
    data = (
      <>
        <section className="mt-4 rounded-card border border-border bg-surface p-4">
          <BarChart
            // No income dots under a filter: they would all sit on the baseline.
            bars={rows.map((r) => ({ key: r.month, label: monthShortLabel(r.month, locale), value: r.expense, secondary: filtering ? undefined : r.income }))}
            selectedKey={shown?.month ?? null}
            onSelect={setSelectedMonth}
            formatValue={money}
            ariaLabel="Spending by month"
          />
          {shown ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border pt-4">
              <p className="tnum min-w-0 text-sm">
                {`${monthLabel(shown.month, locale)}: spent ${money(shown.expense)} · income ${incomeOf(shown)} · net ${netOf(shown)}`}
              </p>
              <Link to={`/?month=${shown.month}`} className="inline-flex min-h-11 shrink-0 items-center rounded-chip bg-surface-2 px-4 text-sm font-medium">
                Open in Home
              </Link>
            </div>
          ) : null}
        </section>
        <div className="mt-4 rounded-card bg-surface">
          <table aria-label="Monthly totals" className="tnum w-full text-sm">
            <thead>
              <tr>
                <th scope="col" className={`${HEAD} text-left`}>
                  Month
                </th>
                <th scope="col" className={`${HEAD} text-right`}>
                  Spent
                </th>
                <th scope="col" className={`${HEAD} ${WIDE} text-right`}>
                  Income
                </th>
                <th scope="col" className={`${HEAD} ${WIDE} text-right`}>
                  Net
                </th>
                <th scope="col" aria-label="Change vs previous month" className={`${HEAD} text-right`}>
                  Δ
                </th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r) => (
                <tr key={r.month} className="border-t border-border">
                  <th scope="row" className={`${CELL} text-left font-medium`}>
                    <span className="whitespace-nowrap">{monthShortLabel(r.month, locale)}</span>
                    {/* The phone's Income and Net, which have no columns below `sm`. Each pair stays on one line while it fits
                        and wraps inside itself only when squeezed, so the column never pushes the table past the screen. */}
                    <div className="text-xs font-normal text-muted sm:hidden">
                      <span className="inline-block">income {incomeOf(r)}</span> · <span className="inline-block">net {netOf(r)}</span>
                    </div>
                  </th>
                  <td className={AMOUNT}>{money(r.expense)}</td>
                  <td className={`${AMOUNT} ${WIDE}`}>{incomeOf(r)}</td>
                  <td className={`${AMOUNT} ${WIDE} ${!filtering && r.net < 0 ? 'text-expense' : ''}`}>{netOf(r)}</td>
                  <td className={`${CELL} text-right`}>
                    {/* Nothing after nothing is no change: no badge. */}
                    {r.expense === 0 && r.previous === 0 ? null : <DeltaBadge deltaPct={percentChange(r.expense, r.previous)} previous={r.previous} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    )
  }

  return (
    <>
      {header(!loading && !error && fromCache)}
      {data}
      <CompareSection byId={byId} currency={currency} locale={locale} />
    </>
  )
}
