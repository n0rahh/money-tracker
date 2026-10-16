import { useEffect, useMemo, useRef, useState } from 'react'
import { BreakdownList } from '../components/BreakdownList'
import { Button } from '../components/Button'
import { EmptyState } from '../components/EmptyState'
import { MonthSwitcher } from '../components/MonthSwitcher'
import { SummaryCard } from '../components/SummaryCard'
import { TransactionList } from '../components/TransactionList'
import { useAddSheet } from '../context/AddSheetContext'
import { useCategories } from '../hooks/useCategories'
import { useSettings } from '../hooks/useSettings'
import { useTransactions } from '../hooks/useTransactions'
import { useVisibilityTick } from '../hooks/useVisibilityTick'
import { currentMonth, monthLabel, monthRange, todayIso } from '../lib/dates'
import { groupByDay, totalsByCategory, totalsByKind } from '../lib/stats'
import type { IsoMonth } from '../lib/types'

export function HomePage() {
  const tick = useVisibilityTick()
  const [month, setMonth] = useState<IsoMonth>(() => currentMonth())
  // True while the shown month was the current month when it was picked: Home then follows the calendar
  // (31 Oct → 1 Nov) when the app comes back to the foreground; a month picked on purpose stays put.
  const followCurrent = useRef(true)
  useEffect(() => {
    if (followCurrent.current) setMonth(currentMonth()) // a no-op unless the month has turned
  }, [tick])
  const { from, to } = monthRange(month)
  const { transactions, loading, pending, error } = useTransactions(from, to)
  // Recomputed on each return to the foreground and with each snapshot (an entry added after midnight with the
  // app left open), so "Today" and "Yesterday" move on after midnight.
  const today = useMemo(() => todayIso(), [tick, transactions])
  const { byId } = useCategories()
  const { settings, loading: settingsLoading } = useSettings()
  const { openAdd, openEdit } = useAddSheet()

  function changeMonth(next: IsoMonth) {
    followCurrent.current = next === currentMonth()
    setMonth(next)
  }

  // The fallback only applies to a genuinely missing settings document (first run), never while it loads.
  const currency = settings?.currency ?? 'USD'
  const locale = settings?.locale ?? null
  const totals = useMemo(() => totalsByKind(transactions), [transactions])
  const breakdown = useMemo(() => totalsByCategory(transactions, 'expense'), [transactions])
  const groups = useMemo(() => groupByDay(transactions), [transactions])
  const loadingLine = <p className="mt-6 text-center text-sm text-muted">Loading…</p>
  const header = (
    <>
      <MonthSwitcher month={month} locale={locale} onChange={changeMonth} />
      {/* Always rendered at a fixed height, so the pill coming and going never moves the content below. Spec §11: the pill
          shows while the visible month holds writes the server has not acknowledged (offline, or still in flight). */}
      <div className="flex h-7 items-center">
        {pending ? <span role="status" className="inline-flex min-h-7 items-center rounded-full bg-surface-2 px-3 text-xs text-muted">Syncing…</span> : null}
      </div>
    </>
  )

  if (settingsLoading) {
    // No amounts until the currency is known: a fallback symbol would flash on a cold start.
    return (
      <>
        {header}
        {loadingLine}
      </>
    )
  }

  return (
    <>
      {header}
      <SummaryCard totals={totals} currency={currency} locale={locale} />
      {error ? <p className="mt-4 text-center text-sm text-danger">{error.message}</p> : null}
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
          <BreakdownList rows={breakdown} byId={byId} currency={currency} locale={locale} />
          <TransactionList groups={groups} byId={byId} currency={currency} locale={locale} today={today} onSelect={openEdit} />
        </>
      )}
    </>
  )
}
