import { ChevronLeft } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BarChart } from '../components/BarChart'
import { CacheHint } from '../components/CacheHint'
import { CategoryIcon } from '../components/CategoryChip'
import { TransactionList } from '../components/TransactionList'
import { useAddSheet } from '../context/AddSheetContext'
import { useCategories } from '../hooks/useCategories'
import { useSettings } from '../hooks/useSettings'
import { useTransactions } from '../hooks/useTransactions'
import { currentMonth, isIsoMonth, lastMonths, monthLabel, monthOf, monthRange, monthShortLabel, todayIso } from '../lib/dates'
import { formatMoney } from '../lib/money'
import { readErrorText } from '../lib/readError'
import { categoryMonthlyTotals, groupByDay } from '../lib/stats'
import type { IsoMonth } from '../lib/types'

export function CategoryPage() {
  const { id = '' } = useParams()
  const { byId, loading: categoriesLoading, error: categoriesError } = useCategories()
  const { settings, loading: settingsLoading } = useSettings()
  const { openEdit } = useAddSheet()
  const thisMonth = currentMonth()
  const months = useMemo(() => lastMonths(thisMonth, 12), [thisMonth])
  // Every category's rows for the twelve months, filtered here: a category filter in the query would need a second composite index.
  const { transactions, loading, fromCache, error } = useTransactions(monthRange(months[0]).from, monthRange(thisMonth).to)
  // Home's month when the category was opened from there (`?month=`): selected first when it is one of the twelve, and where
  // the Back link of a cold deep link returns.
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const linked = searchParams.get('month')
  const homeMonth = isIsoMonth(linked) ? linked : null
  const [selectedMonth, setSelectedMonth] = useState<IsoMonth>(() => (homeMonth !== null && months.includes(homeMonth) ? homeMonth : thisMonth))
  const totals = useMemo(() => categoryMonthlyTotals(transactions, id, months), [transactions, id, months])
  const monthRows = useMemo(
    () => transactions.filter((t) => t.categoryId === id && monthOf(t.date) === selectedMonth),
    [transactions, id, selectedMonth],
  )
  const groups = useMemo(() => groupByDay(monthRows), [monthRows])

  const category = byId.get(id)
  // The fallback only applies to a genuinely missing settings document (first run), never while it loads.
  const currency = settings?.currency ?? 'USD'
  const locale = settings?.locale ?? null
  const money = (minor: number) => formatMoney(minor, currency, locale)
  const loadingLine = <p className="mt-6 text-center text-sm text-muted">Loading…</p>
  const backClass = 'flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text'
  // Back returns to where the page was opened from (Home, Compare, the categories list), so it never stacks a new entry
  // to loop through. Opened cold from a link, there is nothing in the app to return to: Home on the linked month instead.
  const back =
    location.key !== 'default' ? (
      <button type="button" aria-label="Back" onClick={() => navigate(-1)} className={backClass}>
        <ChevronLeft size={20} />
      </button>
    ) : (
      <Link to={homeMonth === null ? '/' : `/?month=${homeMonth}`} aria-label="Back to Home" className={backClass}>
        <ChevronLeft size={20} />
      </Link>
    )

  if (categoriesLoading) {
    // Not "Category not found" yet: an id is only unknown once the categories have arrived.
    return (
      <>
        <header className="flex items-center py-3">{back}</header>
        {loadingLine}
      </>
    )
  }

  if (categoriesError) {
    // Checked before the id: without the categories every id would read "Category not found".
    return (
      <>
        <header className="flex items-center py-3">{back}</header>
        <p className="mt-4 text-center text-sm text-danger">{readErrorText(categoriesError)}</p>
      </>
    )
  }

  if (!category) {
    return (
      <header className="flex items-center gap-3 py-3">
        {back}
        <h1 className="text-lg font-semibold">Category not found</h1>
      </header>
    )
  }

  const average = Math.round(totals.reduce((a, b) => a + b, 0) / months.length)
  const monthTotal = monthRows.reduce((sum, t) => sum + t.amount, 0)
  const statLabel = 'text-xs font-semibold uppercase tracking-wider text-muted'

  return (
    <>
      <header className="flex items-center gap-3 py-3">
        {back}
        <CategoryIcon category={category} />
        <h1 className="min-w-0 truncate text-lg font-semibold">
          {category.name}
          {category.archived ? <span className="font-normal text-muted"> (archived)</span> : null}
        </h1>
        <CacheHint show={!settingsLoading && !loading && !error && fromCache} className="ml-auto max-w-[45%] shrink-0" />
      </header>
      {settingsLoading || loading ? (
        // No amounts until the currency is known, and no empty months before the rows arrive.
        loadingLine
      ) : error ? (
        // A failed query is not twelve empty months: its error stands alone.
        <p className="mt-4 text-center text-sm text-danger">{readErrorText(error)}</p>
      ) : (
        <>
          <section className="rounded-card border border-border bg-surface p-4">
            <BarChart
              bars={months.map((m, i) => ({ key: m, label: monthShortLabel(m, locale), value: totals[i] }))}
              selectedKey={selectedMonth}
              onSelect={setSelectedMonth}
              formatValue={money}
              ariaLabel="Last 12 months"
            />
            {/* The bars carry no figures, so the tapped month's total sits next to the average it is compared with. */}
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4">
              <div>
                <dt className={statLabel}>{monthLabel(selectedMonth, locale)}</dt>
                <dd className="tnum mt-0.5 text-lg font-medium">{money(monthTotal)}</dd>
              </div>
              <div>
                <dt className={statLabel}>Average per month</dt>
                <dd className="tnum mt-0.5 text-lg font-medium">{money(average)}</dd>
              </div>
            </dl>
          </section>
          {groups.length === 0 ? (
            <p className="mt-6 text-center text-sm text-muted">{`Nothing in ${monthLabel(selectedMonth, locale)}`}</p>
          ) : (
            <TransactionList groups={groups} byId={byId} currency={currency} locale={locale} today={todayIso()} onSelect={openEdit} />
          )}
        </>
      )}
    </>
  )
}
