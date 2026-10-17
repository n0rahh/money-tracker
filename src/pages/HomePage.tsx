import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BreakdownList } from '../components/BreakdownList'
import { Button } from '../components/Button'
import { DailyStrip } from '../components/DailyStrip'
import { EmptyState } from '../components/EmptyState'
import { MonthSwitcher } from '../components/MonthSwitcher'
import { PaceLine } from '../components/PaceLine'
import { SummaryCard } from '../components/SummaryCard'
import { TransactionList } from '../components/TransactionList'
import { useAddSheet } from '../context/AddSheetContext'
import { useCategories } from '../hooks/useCategories'
import { useSettings } from '../hooks/useSettings'
import { useTransactions } from '../hooks/useTransactions'
import { useVisibilityTick } from '../hooks/useVisibilityTick'
import { addMonths, currentMonth, isIsoMonth, monthLabel, monthOf, monthRange, todayIso } from '../lib/dates'
import { formatMoney } from '../lib/money'
import { readErrorText } from '../lib/readError'
import { categoryDeltas, groupByDay, paceComparison, totalsByCategory, totalsByDay, totalsByKind } from '../lib/stats'
import type { IsoDate, IsoMonth } from '../lib/types'

/** The daily strip's tap: brings that day's group in the list into view (a day without entries has none). */
function scrollToDay(date: IsoDate) {
  const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  document.getElementById(`day-${date}`)?.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
}

export function HomePage() {
  const tick = useVisibilityTick()
  // `?month=YYYY-MM` (from Trends, or Back from a category) picks the month shown; anything else means the current month.
  const [searchParams, setSearchParams] = useSearchParams()
  const linked = searchParams.get('month')
  const [month, setMonth] = useState<IsoMonth>(() => (isIsoMonth(linked) ? linked : currentMonth()))
  // True while the shown month was the current month when it was picked (or linked to): Home then follows the calendar
  // (31 Oct → 1 Nov) when the app comes back to the foreground; a month picked on purpose stays put.
  const followCurrent = useRef(month === currentMonth())
  // The month follows the URL while Home stays mounted, not only on arrival: the Home tab resets it to `/` on a linked
  // month, and a step back can return to an entry that named another month. Home's own writes come back here and change nothing.
  useEffect(() => {
    const next = isIsoMonth(linked) ? linked : currentMonth()
    const kept = next === currentMonth() ? null : next
    followCurrent.current = kept === null
    setMonth(next)
    // The URL names only a month other than the current one: a link to this month, or an invalid one, leaves it.
    if (linked !== kept) setSearchParams({}, { replace: true })
  }, [linked])
  useEffect(() => {
    if (followCurrent.current) setMonth(currentMonth()) // a no-op unless the month has turned
  }, [tick])
  const { from, to } = monthRange(month)
  const { transactions, loading, pending, error } = useTransactions(from, to)
  // The month before the shown one, for the pace line and the change per category.
  const before = monthRange(addMonths(month, -1))
  const previous = useTransactions(before.from, before.to)
  // Recomputed on each return to the foreground and with each snapshot (an entry added after midnight with the
  // app left open), so "Today" and "Yesterday" move on after midnight.
  const today = useMemo(() => todayIso(), [tick, transactions])
  const { byId } = useCategories()
  const { settings, loading: settingsLoading } = useSettings()
  const { openAdd, openEdit } = useAddSheet()
  const navigate = useNavigate()

  function changeMonth(next: IsoMonth) {
    const isCurrent = next === currentMonth()
    followCurrent.current = isCurrent
    setMonth(next)
    // A month other than the current one stays in the URL (replaced, not stacked), so a reload or a step back returns to it.
    setSearchParams(isCurrent ? {} : { month: next }, { replace: true })
  }

  // The fallback only applies to a genuinely missing settings document (first run), never while it loads.
  const currency = settings?.currency ?? 'USD'
  const locale = settings?.locale ?? null
  const totals = useMemo(() => totalsByKind(transactions), [transactions])
  const breakdown = useMemo(() => totalsByCategory(transactions, 'expense'), [transactions])
  const groups = useMemo(() => groupByDay(transactions), [transactions])
  const days = useMemo(() => totalsByDay(transactions, month, 'expense'), [transactions, month])
  // Nothing is compared until last month's rows are in: before that (or after its query failed) every category would read as "new".
  const lastMonth = previous.loading || previous.error ? null : previous.transactions
  const deltas = useMemo(
    () => (lastMonth ? new Map(categoryDeltas(transactions, lastMonth, 'expense').map((d) => [d.categoryId, d])) : undefined),
    [transactions, lastMonth],
  )
  // Pace is for the current month only (spec §9), taken as the month of the same `today` it counts up to.
  const pace = useMemo(
    () => (lastMonth && month === monthOf(today) ? paceComparison(transactions, lastMonth, today) : null),
    [transactions, lastMonth, month, today],
  )
  const money = (minor: number) => formatMoney(minor, currency, locale)
  const loadingLine = <p className="mt-6 text-center text-sm text-muted">Loading…</p>

  if (settingsLoading) {
    // No amounts until the currency is known: a fallback symbol would flash on a cold start.
    return (
      <>
        <MonthSwitcher month={month} locale={locale} onChange={changeMonth} />
        {loadingLine}
      </>
    )
  }

  return (
    <>
      <MonthSwitcher month={month} locale={locale} onChange={changeMonth} />
      <SummaryCard totals={totals} currency={currency} locale={locale} syncing={pending} />
      {/* Like the strip and the breakdown, only for a month with entries: an empty month has its own empty state. */}
      {pace && !loading && transactions.length > 0 ? <PaceLine pace={pace} currency={currency} locale={locale} /> : null}
      {error ? <p className="mt-4 text-center text-sm text-danger">{readErrorText(error)}</p> : null}
      {loading ? (
        loadingLine
      ) : transactions.length === 0 ? (
        // A failed query is not an empty month: its error above stands alone.
        error ? null : (
          <EmptyState
            title={`Nothing in ${monthLabel(month, locale)}`}
            body="Add your first expense with the + button."
            action={<Button onClick={openAdd}>Add your first entry</Button>}
          />
        )
      ) : (
        <>
          <div className="mt-4">
            <DailyStrip values={days} month={month} today={today} onSelectDay={scrollToDay} formatValue={money} locale={locale} />
          </div>
          <BreakdownList
            rows={breakdown}
            byId={byId}
            currency={currency}
            locale={locale}
            deltas={deltas}
            // The category page opens on the shown month and its Back link returns to it; the current month needs no ?month=.
            onSelect={(categoryId) => navigate(month === currentMonth() ? `/category/${categoryId}` : `/category/${categoryId}?month=${month}`)}
          />
          <TransactionList groups={groups} byId={byId} currency={currency} locale={locale} today={today} onSelect={openEdit} />
        </>
      )}
    </>
  )
}
