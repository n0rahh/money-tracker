import { Search } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BreakdownList } from '../components/BreakdownList'
import { Button } from '../components/Button'
import { DailyStrip } from '../components/DailyStrip'
import { EmptyState } from '../components/EmptyState'
import { MonthPickerSheet } from '../components/MonthPickerSheet'
import { MonthSwitcher } from '../components/MonthSwitcher'
import { PaceLine } from '../components/PaceLine'
import { SearchBar, type KindFilter } from '../components/SearchBar'
import { SummaryCard } from '../components/SummaryCard'
import { TransactionList } from '../components/TransactionList'
import { useAddSheet } from '../context/AddSheetContext'
import { useBudgets } from '../hooks/useBudgets'
import { useCategories } from '../hooks/useCategories'
import { useSettings } from '../hooks/useSettings'
import { useTransactions } from '../hooks/useTransactions'
import { useVisibilityTick } from '../hooks/useVisibilityTick'
import { addMonths, currentMonth, isIsoMonth, monthLabel, monthOf, monthRange, todayIso } from '../lib/dates'
import { formatMoney } from '../lib/money'
import { readErrorText } from '../lib/readError'
import { categoryDeltas, groupByDay, paceComparison, previousMonthToDate, totalsByCategory, totalsByDay, totalsByKind } from '../lib/stats'
import type { IsoDate, IsoMonth } from '../lib/types'

/** A search of the month's day list: whether its field is open, what is typed in it and the kinds it keeps. */
type MonthSearch = { open: boolean; query: string; kind: KindFilter }
const NO_SEARCH: MonthSearch = { open: false, query: '', kind: 'all' }

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
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState(NO_SEARCH)
  // A search belongs to its month: a month change by any route (arrows, picker, link, the calendar) starts without one. Reset
  // during the render, so that not one frame shows the new month narrowed by the old query.
  const [searchedMonth, setSearchedMonth] = useState(month)
  if (searchedMonth !== month) {
    setSearchedMonth(month)
    setSearch(NO_SEARCH)
  }
  const searchId = useId()
  const searchRef = useRef<HTMLDivElement>(null)
  const { from, to } = monthRange(month)
  const { transactions, loading, pending, error } = useTransactions(from, to)
  // The month before the shown one, for the pace line and the change per category.
  const before = monthRange(addMonths(month, -1))
  const previous = useTransactions(before.from, before.to)
  // Recomputed on each return to the foreground and with each snapshot (an entry added after midnight with the
  // app left open), so "Today" and "Yesterday" move on after midnight.
  const today = useMemo(() => todayIso(), [tick, transactions])
  const { byId } = useCategories()
  const { budgets } = useBudgets()
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
  // The budgets that count (spec §9): those of active expense categories, in category order. An archived category's limit
  // rests until it is unarchived, so it adds no empty row every month and nothing to the total.
  const expenseBudgets = useMemo(() => {
    const limits = new Map<string, number>()
    for (const c of byId.values()) {
      const limit = budgets.get(c.id)
      if (limit !== undefined && c.kind === 'expense' && !c.archived) limits.set(c.id, limit)
    }
    return limits
  }, [byId, budgets])
  // A budgeted category with nothing spent yet still gets its (empty) row, after the others.
  const breakdown = useMemo(() => {
    const rows = totalsByCategory(transactions, 'expense')
    const listed = new Set(rows.map((r) => r.categoryId))
    for (const id of expenseBudgets.keys()) if (!listed.has(id)) rows.push({ categoryId: id, total: 0, count: 0, share: 0 })
    return rows
  }, [transactions, expenseBudgets])
  // The summary's budget line: the shown month's spending in the budgeted categories against the sum of their limits.
  const budgetTotals = useMemo(() => {
    if (expenseBudgets.size === 0) return null
    let spent = 0
    let limit = 0
    for (const r of breakdown) if (expenseBudgets.has(r.categoryId)) spent += r.total
    for (const monthly of expenseBudgets.values()) limit += monthly
    return { spent, limit }
  }, [breakdown, expenseBudgets])
  const needle = search.query.trim().toLowerCase()
  const filtering = needle !== '' || search.kind !== 'all'
  // The search narrows the day list only: the summary, the strip and the breakdown keep describing the whole month.
  const listed = useMemo(() => {
    if (!filtering) return transactions
    return transactions.filter(
      (t) =>
        (search.kind === 'all' || t.kind === search.kind) &&
        // The category by the name the list shows: "Uncategorized" for one removed by hand.
        (t.note.toLowerCase().includes(needle) || (byId.get(t.categoryId)?.name ?? 'Uncategorized').toLowerCase().includes(needle)),
    )
  }, [transactions, byId, filtering, needle, search.kind])
  const groups = useMemo(() => groupByDay(listed), [listed])
  const days = useMemo(() => totalsByDay(transactions, month, 'expense'), [transactions, month])
  // Nothing is compared until last month's rows are in: before that (or after its query failed) every category would read as "new".
  const lastMonth = previous.loading || previous.error ? null : previous.transactions
  // The current month, taken as the month of the same `today` it counts up to, is still running: its pace line and its
  // badges compare with last month up to the same day (spec §9). A past month is compared with the whole month before it.
  const isCurrentMonth = month === monthOf(today)
  const deltas = useMemo(() => {
    if (!lastMonth) return undefined
    const comparedWith = isCurrentMonth ? previousMonthToDate(lastMonth, today) : lastMonth
    return new Map(categoryDeltas(transactions, comparedWith, 'expense').map((d) => [d.categoryId, d]))
  }, [transactions, lastMonth, isCurrentMonth, today])
  const pace = useMemo(
    () => (lastMonth && isCurrentMonth ? paceComparison(transactions, lastMonth, today) : null),
    [transactions, lastMonth, isCurrentMonth, today],
  )
  const money = (minor: number) => formatMoney(minor, currency, locale)
  const loadingLine = <p className="mt-6 text-center text-sm text-muted">Loading…</p>
  // Only a month with entries on show has anything to search.
  const searchable = !settingsLoading && !loading && transactions.length > 0
  const searchShown = search.open && searchable

  function toggleSearch() {
    if (searchShown) {
      setSearch(NO_SEARCH) // closing drops the filter too: no list stays narrowed by a field out of sight
      return
    }
    // Rendered within the tap, so the field takes the focus inside it (iOS raises the keyboard only then). Then the field goes
    // to the top of the screen with the days under it; at once, not smoothly: on iOS the keyboard coming up scrolls the focused
    // field too, which would cut a smooth scroll short.
    flushSync(() => setSearch({ ...NO_SEARCH, open: true }))
    searchRef.current?.scrollIntoView?.({ block: 'start' })
  }

  const list = <TransactionList groups={groups} byId={byId} currency={currency} locale={locale} today={today} onSelect={openEdit} />

  return (
    <>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <MonthSwitcher month={month} locale={locale} onChange={changeMonth} onOpenPicker={() => setPickerOpen(true)} />
        </div>
        {/* Dimmed while there is no list to search (Home is loading, or the month has no entries); the fade hides the frame or
            two of loading that a switch to a cached month takes. */}
        <button
          type="button"
          aria-label="Search"
          aria-expanded={searchShown}
          aria-controls={searchShown ? searchId : undefined}
          disabled={!searchable}
          onClick={toggleSearch}
          className={`flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-2 transition disabled:opacity-40 ${searchShown ? 'text-accent' : 'text-text'}`}
        >
          <Search size={20} />
        </button>
      </div>
      {settingsLoading ? (
        // No amounts until the currency is known: a fallback symbol would flash on a cold start.
        loadingLine
      ) : (
        <>
          <SummaryCard
            totals={totals}
            currency={currency}
            locale={locale}
            syncing={pending}
            budgetLine={budgetTotals ? `Budgets: ${money(budgetTotals.spent)} of ${money(budgetTotals.limit)}` : undefined}
          />
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
                legend={isCurrentMonth ? 'vs last month to date' : 'vs previous month'}
                budgets={expenseBudgets}
                // The category page opens on the shown month and its Back link returns to it; the current month needs no ?month=.
                onSelect={(categoryId) => navigate(month === currentMonth() ? `/category/${categoryId}` : `/category/${categoryId}?month=${month}`)}
              />
              {searchShown ? (
                // Under the breakdown, which it does not filter, with the days it narrows right under it. At least a screen tall,
                // so that a list narrowed to nothing does not shorten the page and pull the field down behind the keyboard.
                <div ref={searchRef} id={searchId} className="mt-4 min-h-dvh scroll-mt-[max(0.5rem,env(safe-area-inset-top))]">
                  <SearchBar
                    value={search.query}
                    onChange={(query) => setSearch((s) => ({ ...s, query }))}
                    kind={search.kind}
                    onKindChange={(kind) => setSearch((s) => ({ ...s, kind }))}
                  />
                  {/* Read out as it changes, while the focus stays in the field. */}
                  <div role="status">
                    {!filtering ? null : listed.length === 0 ? (
                      <p className="mt-6 text-center text-sm text-muted">No matches</p>
                    ) : (
                      <p className="mt-3 px-1 text-[13px] text-muted">{`${listed.length} matching ${listed.length === 1 ? 'entry' : 'entries'}`}</p>
                    )}
                  </div>
                  {list}
                </div>
              ) : (
                list
              )}
            </>
          )}
        </>
      )}
      <MonthPickerSheet open={pickerOpen} month={month} locale={locale} onSelect={changeMonth} onClose={() => setPickerOpen(false)} />
    </>
  )
}
