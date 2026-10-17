import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart } from '../components/BarChart'
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
import { monthlyTotals, rangeMonths } from '../lib/stats'
import type { RangeKey } from '../lib/stats'
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

/** Whole-percent change, rounded as `lib/stats` rounds its deltas (one division, no -0); null when the previous amount is 0. */
const changePct = (current: number, previous: number): number | null =>
  previous === 0 ? null : Math.round(((current - previous) * 100) / previous) || 0

const CELL = 'whitespace-nowrap px-2 py-2'
const HEAD = `${CELL} text-xs font-semibold uppercase tracking-wider text-muted`
/** The first column stays put while a wide table scrolls sideways, so every row keeps its label. */
const STICKY = 'sticky left-0 bg-surface'

export function TrendsPage() {
  useVisibilityTick() // re-renders on each return to the foreground, so the range moves on with the calendar
  const { categories, byId, loading: categoriesLoading } = useCategories()
  const { settings, loading: settingsLoading } = useSettings()
  const [range, setRange] = useState<RangeKey>(rememberedRange)
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<ReadonlySet<string>>(() => new Set())
  const [selectedMonth, setSelectedMonth] = useState<IsoMonth | null>(null)

  const thisMonth = currentMonth()
  // rangeMonths reads the clock itself; `thisMonth` rebuilds the list once the month turns.
  const months = useMemo(() => rangeMonths(range), [range, thisMonth])
  const before = addMonths(months[0], -1)
  // The month before the range comes along: the first month's change is measured against it.
  const { transactions, loading, error } = useTransactions(monthRange(before).from, monthRange(months[months.length - 1]).to)
  const filtered = useMemo(
    () => (selectedCategoryIds.size ? transactions.filter((t) => selectedCategoryIds.has(t.categoryId)) : transactions),
    [transactions, selectedCategoryIds],
  )
  const rows = useMemo(() => monthlyTotals(filtered, months), [filtered, months])
  const prevRow = useMemo(() => monthlyTotals(filtered, [before])[0], [filtered, before])
  const used = useMemo(() => new Set(transactions.map((t) => t.categoryId)), [transactions])
  // Archived categories only while the range holds their entries, or while chosen: a filter never applies out of sight.
  const chips = categories.filter((c) => c.kind === 'expense' && (!c.archived || used.has(c.id) || selectedCategoryIds.has(c.id)))
  // A tapped month stays selected only while the range shows it.
  const shown = rows.find((r) => r.month === selectedMonth)

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
  const loadingLine = <p className="mt-6 text-center text-sm text-muted">Loading…</p>

  const header = (
    <>
      <h1 className="py-3 text-lg font-semibold">Trends</h1>
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
        {header}
        {loadingLine}
      </>
    )
  }

  let data
  if (loading) data = loadingLine
  // A failed query is not a range of empty months: its error stands alone.
  else if (error) data = <p className="mt-4 text-center text-sm text-danger">{error.message}</p>
  else if (rows.every((r) => r.expense === 0 && r.income === 0)) data = <p className="mt-6 text-center text-sm text-muted">No data for this range.</p>
  else {
    // Newest first; each month against the one before it, the first against the month before the range.
    const tableRows = rows.map((r, i) => ({ ...r, previous: (i === 0 ? prevRow : rows[i - 1]).expense })).reverse()
    data = (
      <>
        <section className="mt-4 rounded-card border border-border bg-surface p-4">
          <BarChart
            bars={rows.map((r) => ({ key: r.month, label: monthShortLabel(r.month, locale), value: r.expense, secondary: r.income }))}
            selectedKey={shown?.month ?? null}
            onSelect={setSelectedMonth}
            formatValue={money}
            ariaLabel="Spending by month"
          />
          {shown ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border pt-4">
              <p className="tnum min-w-0 text-sm">
                {`${monthLabel(shown.month, locale)}: spent ${money(shown.expense)} · income ${money(shown.income)} · net ${signed(shown.net)}`}
              </p>
              <Link to={`/?month=${shown.month}`} className="inline-flex min-h-11 shrink-0 items-center rounded-chip bg-surface-2 px-4 text-sm font-medium">
                Open in Home
              </Link>
            </div>
          ) : null}
        </section>
        {/* Five columns of amounts outgrow a phone once they reach thousands: the table then scrolls sideways inside its card. */}
        <div className="mt-4 overflow-x-auto rounded-card bg-surface">
          <table aria-label="Monthly totals" className="tnum w-full text-sm">
            <thead>
              <tr>
                <th scope="col" className={`${HEAD} ${STICKY} text-left`}>
                  Month
                </th>
                <th scope="col" className={`${HEAD} text-right`}>
                  Spent
                </th>
                <th scope="col" className={`${HEAD} text-right`}>
                  Income
                </th>
                <th scope="col" className={`${HEAD} text-right`}>
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
                  <th scope="row" className={`${CELL} ${STICKY} text-left font-medium`}>
                    {monthShortLabel(r.month, locale)}
                  </th>
                  <td className={`${CELL} text-right`}>{money(r.expense)}</td>
                  <td className={`${CELL} text-right`}>{money(r.income)}</td>
                  <td className={`${CELL} text-right ${r.net < 0 ? 'text-expense' : ''}`}>{signed(r.net)}</td>
                  <td className={`${CELL} text-right`}>
                    {/* Nothing after nothing is no change: no badge. */}
                    {r.expense === 0 && r.previous === 0 ? null : <DeltaBadge deltaPct={changePct(r.expense, r.previous)} previous={r.previous} />}
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
      {header}
      {data}
      <CompareSection byId={byId} currency={currency} locale={locale} />
    </>
  )
}
