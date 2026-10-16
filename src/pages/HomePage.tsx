import { useMemo, useState } from 'react'
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
import { currentMonth, monthLabel, monthRange, todayIso } from '../lib/dates'
import { groupByDay, totalsByCategory, totalsByKind } from '../lib/stats'
import type { IsoMonth } from '../lib/types'

export function HomePage() {
  const [month, setMonth] = useState<IsoMonth>(() => currentMonth())
  const { from, to } = monthRange(month)
  const { transactions, loading, error } = useTransactions(from, to)
  const { byId } = useCategories()
  const { settings, loading: settingsLoading } = useSettings()
  const { openAdd, openEdit } = useAddSheet()

  // The fallback only applies to a genuinely missing settings document (first run), never while it loads.
  const currency = settings?.currency ?? 'USD'
  const locale = settings?.locale ?? null
  const totals = useMemo(() => totalsByKind(transactions), [transactions])
  const breakdown = useMemo(() => totalsByCategory(transactions, 'expense'), [transactions])
  const groups = useMemo(() => groupByDay(transactions), [transactions])
  const loadingLine = <p className="mt-6 text-center text-sm text-muted">Loading…</p>

  if (settingsLoading) {
    // No amounts until the currency is known: a fallback symbol would flash on a cold start.
    return (
      <>
        <MonthSwitcher month={month} locale={locale} onChange={setMonth} />
        {loadingLine}
      </>
    )
  }

  return (
    <>
      <MonthSwitcher month={month} locale={locale} onChange={setMonth} />
      <SummaryCard totals={totals} currency={currency} locale={locale} />
      {error ? <p className="mt-4 text-center text-sm text-danger">{error.message}</p> : null}
      {loading ? (
        loadingLine
      ) : transactions.length === 0 ? (
        <EmptyState
          title={`Nothing in ${monthLabel(month, locale)}`}
          body="Add your first expense with the + button."
          action={<Button onClick={openAdd}>Add your first entry</Button>}
        />
      ) : (
        <>
          <BreakdownList rows={breakdown} byId={byId} currency={currency} locale={locale} />
          <TransactionList groups={groups} byId={byId} currency={currency} locale={locale} today={todayIso()} onSelect={openEdit} />
        </>
      )}
    </>
  )
}
