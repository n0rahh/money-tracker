import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FirebaseError } from 'firebase/app'
import { Timestamp } from 'firebase/firestore'
import { MemoryRouter, Route, Routes, useParams, useSearchParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Category, IsoDate, Kind, Transaction } from '../lib/types'
import { TrendsPage } from './TrendsPage'

const MINUS = '−' // DeltaBadge's true minus; formatMoney signs a negative amount with the ASCII hyphen-minus
const COFFEE: Category = { id: 'c1', name: 'Coffee', icon: 'Coffee', color: 'amber', kind: 'expense', order: 0, archived: false }
/** Archived after its September entry was logged: it keeps its name, and its chip while that entry is in range. */
const GYM: Category = { id: 'c2', name: 'Gym', icon: 'Dumbbell', color: 'sky', kind: 'expense', order: 1, archived: true }
const GROCERIES: Category = { id: 'c3', name: 'Groceries', icon: 'ShoppingCart', color: 'emerald', kind: 'expense', order: 2, archived: false }
/** Archived, with its only entry in January: inside 12M and YTD, outside 6M and 3M. */
const HOLIDAY: Category = { id: 'c4', name: 'Holiday', icon: 'Plane', color: 'cyan', kind: 'expense', order: 3, archived: true }
const SALARY: Category = { id: 'c5', name: 'Salary', icon: 'Banknote', color: 'lime', kind: 'income', order: 0, archived: false }
const CATEGORIES = [COFFEE, GYM, GROCERIES, HOLIDAY, SALARY]

const entry = (id: string, categoryId: string, date: IsoDate, amount: number, kind: Kind = 'expense'): Transaction => {
  const [y, m, d] = date.split('-').map(Number)
  return { id, kind, amount, categoryId, note: '', date, at: Timestamp.fromDate(new Date(y, m - 1, d, 9)), source: 'app' }
}
// The clock is set to Saturday 17 Oct 2026 below: 6M is May–Oct 2026, 3M Aug–Oct, 12M Nov 2025–Oct 2026, YTD Jan–Oct 2026.
const ROWS = [
  // October: €69.70 spent (coffee €7.70, groceries €50.00, €12.00 under a category removed by hand in the console), €3,000.00 earned.
  entry('o1', COFFEE.id, '2026-10-17', 350),
  entry('o2', COFFEE.id, '2026-10-10', 420),
  entry('o3', GROCERIES.id, '2026-10-10', 5000),
  entry('o4', 'removed-in-console', '2026-10-05', 1200),
  entry('o5', SALARY.id, '2026-10-01', 300000, 'income'),
  // September: €119.00 spent (gym €40.00, coffee €15.00, groceries €64.00), €3,000.00 earned.
  entry('s1', GYM.id, '2026-09-01', 4000),
  entry('s2', COFFEE.id, '2026-09-05', 500),
  entry('s3', COFFEE.id, '2026-09-20', 1000),
  entry('s4', GROCERIES.id, '2026-09-20', 6400),
  entry('s5', SALARY.id, '2026-09-01', 300000, 'income'),
  entry('a1', GROCERIES.id, '2026-08-14', 3000), // August: €30.00
  entry('j1', COFFEE.id, '2026-07-03', 800), // July: €8.00, after an empty June and an empty May
  entry('p1', GROCERIES.id, '2026-04-30', 2500), // April: €25.00, the month before the 6M range
  entry('h1', HOLIDAY.id, '2026-01-15', 90000), // January: €900.00, reached by 12M and YTD only
]

// Subscriptions as "from..to".
const SIX_MONTHS = '2026-04-01..2026-10-31' // May–Oct, plus April for May's change
const THREE_MONTHS = '2026-07-01..2026-10-31' // Aug–Oct, plus July for August's change
// The comparison reads each of its months on its own: by default September (A) against October (B).
const SEP = '2026-09-01..2026-09-30'
const OCT = '2026-10-01..2026-10-31'
const JUL = '2026-07-01..2026-07-31'

const { subscribeTransactionsInRange, useCategories, useSettings } = vi.hoisted(() => ({
  subscribeTransactionsInRange: vi.fn(),
  useCategories: vi.fn(),
  useSettings: vi.fn(),
}))
// The real useTransactions runs on top of this (as in HomePage.test), so its reset on a range change is under test too.
vi.mock('../lib/firestore', () => ({ subscribeTransactionsInRange }))
vi.mock('../hooks/useCategories', () => ({ useCategories }))
vi.mock('../hooks/useSettings', () => ({ useSettings }))

type OnData = (rows: Transaction[], hasPendingWrites: boolean) => void
/** What the range query returns: the fixture's rows dated within it. */
const rowsIn = (from: IsoDate, to: IsoDate) => ROWS.filter((t) => t.date >= from && t.date <= to)
/** Answers every subscription at once, except the `held` ranges, which load until the test delivers or fails them. */
function answerRanges(...held: string[]) {
  subscribeTransactionsInRange.mockImplementation((from: IsoDate, to: IsoDate, onData: OnData) => {
    if (!held.includes(`${from}..${to}`)) onData(rowsIn(from, to), false)
    return vi.fn() // each subscription gets its own unsubscribe spy
  })
}
function subscriptionTo(range: string) {
  const call = subscribeTransactionsInRange.mock.calls.filter(([from, to]) => `${from}..${to}` === range).at(-1)
  if (!call) throw new Error(`Nothing subscribed to ${range}`)
  return call
}
const deliver = (range: string, rows: Transaction[]) => act(() => subscriptionTo(range)[2](rows, false))
const fail = (range: string, e: Error) => act(() => subscriptionTo(range)[3](e))
/** The ranges listened to right now (subscribed and not unsubscribed since), oldest first. */
const listening = () =>
  subscribeTransactionsInRange.mock.calls
    .filter((_, i) => subscribeTransactionsInRange.mock.results[i].value.mock.calls.length === 0)
    .map(([from, to]) => `${from}..${to}`)
    .sort()
/** Every range subscribed to so far, in the order of subscription. */
const queried = () => subscribeTransactionsInRange.mock.calls.map(([from, to]) => `${from}..${to}`)

const withCategories = (categories: Category[], loading = false) =>
  useCategories.mockReturnValue({ categories, byId: new Map(categories.map((c) => [c.id, c])), loading, error: null })
const withSettingsLoaded = () => useSettings.mockReturnValue({ settings: { currency: 'EUR', locale: 'en' }, loading: false, fromCache: false, error: null })

/** Stand in for Home and the category page, showing what they were opened with. */
function HomeStub() {
  const [params] = useSearchParams()
  return <h1>{`Home ${params.get('month')}`}</h1>
}
function CategoryStub() {
  const { id } = useParams()
  const [params] = useSearchParams()
  return <h1>{`Category ${id} month ${params.get('month')}`}</h1>
}
const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/trends']}>
      <Routes>
        <Route path="trends" element={<TrendsPage />} />
        <Route path="/" element={<HomeStub />} />
        <Route path="category/:id" element={<CategoryStub />} />
      </Routes>
    </MemoryRouter>,
  )

const radio = (name: string) => screen.getByRole('radio', { name })
const chart = () => within(screen.getByRole('group', { name: 'Spending by month' }))
const barLabels = () => chart().getAllByRole('button').map((b) => b.getAttribute('aria-label'))
const bar = (month: string) => chart().getByRole('button', { name: new RegExp(`^${month}:`) })
const chips = () => within(screen.getByRole('group', { name: 'Filter by category' }))
const chip = (name: string) => chips().getByRole('button', { name })
const chipNames = () => chips().getAllByRole('button').map((b) => b.textContent)
const textOf = (cells: NodeListOf<Element>) => Array.from(cells, (c) => c.textContent)
const headOf = (table: HTMLElement) => textOf(table.querySelectorAll('thead th'))
/** A cell's text; one holding several elements (a month and, under it, its phone line) reads them joined by " | ". */
const cellText = (cell: Element) => (cell.children.length > 1 ? Array.from(cell.children, (c) => c.textContent).join(' | ') : cell.textContent)
/** Each body row's cells as text, in screen order. Every column is in the DOM; below `sm` CSS hides Income and Net. */
const bodyOf = (table: HTMLElement) => Array.from(table.querySelectorAll('tbody tr'), (tr) => Array.from(tr.querySelectorAll('th, td'), cellText))
const monthTable = () => screen.getByRole('table', { name: 'Monthly totals' })
const spentColumn = () => bodyOf(monthTable()).map((cells) => cells[1])
const compare = () => within(screen.getByRole('region', { name: 'Compare two months' }))
const monthA = () => compare().getByRole('combobox', { name: 'Month A' })
const monthB = () => compare().getByRole('combobox', { name: 'Month B' })
const compareTable = () => compare().getByRole('table', { name: 'Change by category' })

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  // Only the clock (see HomePage.test.tsx): Saturday 17 Oct 2026, midday.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 17, 12, 0))
  withCategories(CATEGORIES)
  withSettingsLoaded()
  answerRanges()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks() // the storage and visibilityState spies
})

describe('TrendsPage', () => {
  it('charts the last six months by default, spending as bars with the income of each month', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Trends$/)
    expect(radio('6M')).toBeChecked()
    expect(listening()).toEqual([SIX_MONTHS, SEP, OCT])
    expect(barLabels()).toEqual([
      'May: €0.00, income €0.00',
      'Jun: €0.00, income €0.00',
      'Jul: €8.00, income €0.00',
      'Aug: €30.00, income €0.00',
      'Sep: €119.00, income €3,000.00',
      'Oct: €69.70, income €3,000.00',
    ])
  })

  it('lists the months newest first, each compared with the month before it', () => {
    renderPage()
    expect(headOf(monthTable())).toEqual(['Month', 'Spent', 'Income', 'Net', 'Δ'])
    expect(bodyOf(monthTable())).toEqual([
      ['Oct | income €3,000.00 · net +€2,930.30', '€69.70', '€3,000.00', '+€2,930.30', `${MINUS}41 %`], // 6970 against 11900
      ['Sep | income €3,000.00 · net +€2,881.00', '€119.00', '€3,000.00', '+€2,881.00', '+297 %'], // 11900 against 3000
      ['Aug | income €0.00 · net -€30.00', '€30.00', '€0.00', '-€30.00', '+275 %'],
      ['Jul | income €0.00 · net -€8.00', '€8.00', '€0.00', '-€8.00', 'new'], // June had nothing
      ['Jun | income €0.00 · net €0.00', '€0.00', '€0.00', '€0.00', ''], // nothing after nothing: no badge
      ['May | income €0.00 · net €0.00', '€0.00', '€0.00', '€0.00', `${MINUS}100 %`], // against April, the month before the range
    ])
  })

  it('re-subscribes for a shorter range, the month before it included, and compares its first month with that month', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(radio('3M'))
    expect(radio('3M')).toBeChecked()
    expect(listening()).toEqual([THREE_MONTHS, SEP, OCT])
    expect(barLabels()).toEqual(['Aug: €30.00, income €0.00', 'Sep: €119.00, income €3,000.00', 'Oct: €69.70, income €3,000.00'])
    expect(bodyOf(monthTable())).toEqual([
      ['Oct | income €3,000.00 · net +€2,930.30', '€69.70', '€3,000.00', '+€2,930.30', `${MINUS}41 %`],
      ['Sep | income €3,000.00 · net +€2,881.00', '€119.00', '€3,000.00', '+€2,881.00', '+297 %'],
      ['Aug | income €0.00 · net -€30.00', '€30.00', '€0.00', '-€30.00', '+275 %'], // against July's €8.00
    ])
  })

  it.each([
    { range: '12M', from: '2025-10-01', labels: ['Nov 25', 'Dec 25', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'] },
    { range: 'YTD', from: '2025-12-01', labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'] },
  ])('charts $range, subscribing from the month before its first one', async ({ range, from, labels }) => {
    const user = userEvent.setup()
    renderPage()
    await user.click(radio(range))
    expect(listening()).toEqual([`${from}..2026-10-31`, SEP, OCT].sort())
    expect(barLabels().map((label) => label?.split(':')[0])).toEqual(labels)
    expect(bodyOf(monthTable())).toHaveLength(labels.length)
  })

  it("never shows the previous range's months while the new range loads", async () => {
    const user = userEvent.setup()
    renderPage()
    expect(barLabels()).toHaveLength(6)
    answerRanges(THREE_MONTHS) // the 3M subscription stays loading until delivered
    await user.click(radio('3M'))
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Spending by month' })).not.toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Monthly totals' })).not.toBeInTheDocument()

    deliver(THREE_MONTHS, rowsIn('2026-07-01', '2026-10-31'))
    expect(barLabels()).toHaveLength(3)
  })

  it('remembers the range for the rest of the session', async () => {
    const user = userEvent.setup()
    const { unmount } = renderPage()
    await user.click(radio('3M'))
    unmount()
    renderPage()
    expect(radio('3M')).toBeChecked()
    expect(listening()).toEqual([THREE_MONTHS, SEP, OCT])
  })

  it('opens on the range stored for the session and stores the next one', async () => {
    const user = userEvent.setup()
    sessionStorage.setItem('trends.range', '12M')
    renderPage()
    expect(radio('12M')).toBeChecked()
    expect(barLabels()).toHaveLength(12)
    await user.click(radio('3M'))
    expect(sessionStorage.getItem('trends.range')).toBe('3M')
  })

  it('opens on 6M when the remembered range is not one it knows', () => {
    sessionStorage.setItem('trends.range', '2Y')
    renderPage()
    expect(radio('6M')).toBeChecked()
    expect(listening()).toEqual([SIX_MONTHS, SEP, OCT])
  })

  it('still switches ranges when the browser refuses storage', async () => {
    const user = userEvent.setup()
    const refuse = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse)
    // An exception in a click handler does not fail the test by itself: jsdom reports it to the window.
    const uncaught = vi.fn()
    window.addEventListener('error', uncaught)
    try {
      renderPage()
      expect(radio('6M')).toBeChecked()
      await user.click(radio('3M'))
      expect(radio('3M')).toBeChecked()
      expect(barLabels()).toHaveLength(3)
      expect(uncaught).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('error', uncaught)
    }
  })

  it('offers a chip per expense category, an archived one only while the range holds its entries', () => {
    renderPage()
    // Not Holiday (its only entry is in January) and not Salary (income).
    expect(chipNames()).toEqual(['Coffee', 'Gym', 'Groceries'])
    expect(chips().getAllByRole('button').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false'])
  })

  it('narrows the bars and the table to the chosen categories', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(chip('Coffee'))
    expect(chip('Coffee')).toHaveAttribute('aria-pressed', 'true')
    expect(bar('Oct')).toHaveAccessibleName('Oct: €7.70')
    expect(bodyOf(monthTable())).toEqual([
      ['Oct | income — · net —', '€7.70', '—', '—', `${MINUS}49 %`],
      ['Sep | income — · net —', '€15.00', '—', '—', 'new'],
      ['Aug | income — · net —', '€0.00', '—', '—', `${MINUS}100 %`],
      ['Jul | income — · net —', '€8.00', '—', '—', 'new'],
      ['Jun | income — · net —', '€0.00', '—', '—', ''],
      ['May | income — · net —', '€0.00', '—', '—', ''], // April had no coffee either
    ])

    await user.click(chip('Groceries'))
    expect(spentColumn()).toEqual(['€57.70', '€79.00', '€30.00', '€8.00', '€0.00', '€0.00'])

    await user.click(chip('Coffee'))
    await user.click(chip('Groceries'))
    expect(chips().queryAllByRole('button', { pressed: true })).toEqual([])
    expect(spentColumn()).toEqual(['€69.70', '€119.00', '€30.00', '€8.00', '€0.00', '€0.00'])
    expect(bar('Oct')).toHaveAccessibleName('Oct: €69.70, income €3,000.00')
  })

  it('leaves income out of the chart and reads "—" for income and net while a filter is on', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(chart().getAllByTestId('dot')).toHaveLength(6)
    await user.click(chip('Groceries'))
    // The chosen categories hold no income, so the dots and the income and net figures would only repeat their spending.
    expect(chart().queryAllByTestId('dot')).toEqual([])
    expect(barLabels()).toEqual(['May: €0.00', 'Jun: €0.00', 'Jul: €0.00', 'Aug: €30.00', 'Sep: €64.00', 'Oct: €50.00'])
    expect(bodyOf(monthTable()).map((cells) => [cells[0], cells[2], cells[3]])).toEqual(
      ['Oct', 'Sep', 'Aug', 'Jul', 'Jun', 'May'].map((month) => [`${month} | income — · net —`, '—', '—']),
    )
    // The change still compares spending: 5000 against 6400, 6400 against 3000, then 3000 after an empty July.
    expect(bodyOf(monthTable()).map((cells) => cells[4])).toEqual([`${MINUS}22 %`, '+113 %', 'new', '', '', `${MINUS}100 %`])
    await user.click(bar('Sep'))
    expect(screen.getByText('September 2026: spent €64.00 · income — · net —')).toBeInTheDocument()
  })

  it('keeps a chosen archived chip, and its filter, when the new range has none of its entries', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(radio('12M'))
    expect(chipNames()).toEqual(['Coffee', 'Gym', 'Groceries', 'Holiday'])
    await user.click(chip('Holiday'))
    expect(bar('Jan')).toHaveAccessibleName('Jan: €900.00')
    // The chips follow the range's entries, not the filter: Gym, archived too, stays.
    expect(chipNames()).toEqual(['Coffee', 'Gym', 'Groceries', 'Holiday'])

    await user.click(radio('6M'))
    expect(chip('Holiday')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('No data for the selected categories in this range.')).toBeInTheDocument()
    expect(screen.queryByText('No data for this range.')).not.toBeInTheDocument()

    await user.click(chip('Holiday'))
    expect(chipNames()).toEqual(['Coffee', 'Gym', 'Groceries'])
    expect(barLabels()).toHaveLength(6)
  })

  it('keeps the archived chips of the settled range while the next range loads', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(radio('12M'))
    expect(chipNames()).toEqual(['Coffee', 'Gym', 'Groceries', 'Holiday'])
    answerRanges(SIX_MONTHS) // 6M stays loading until delivered
    await user.click(radio('6M'))
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(chipNames()).toEqual(['Coffee', 'Gym', 'Groceries', 'Holiday']) // nothing blinks out meanwhile

    deliver(SIX_MONTHS, rowsIn('2026-04-01', '2026-10-31'))
    expect(chipNames()).toEqual(['Coffee', 'Gym', 'Groceries']) // Holiday's only entry is in January
  })

  it("shows a tapped month's totals with a link that opens that month on Home", async () => {
    const user = userEvent.setup()
    renderPage()
    expect(screen.queryByRole('link', { name: 'Open in Home' })).not.toBeInTheDocument()
    await user.click(bar('Sep'))
    expect(bar('Sep')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('September 2026: spent €119.00 · income €3,000.00 · net +€2,881.00')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Open in Home' })
    expect(link).toHaveAttribute('href', '/?month=2026-09')

    await user.click(link)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Home 2026-09$/)
  })

  it('drops the tapped month once the range no longer shows it', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(bar('May'))
    expect(screen.getByRole('link', { name: 'Open in Home' })).toHaveAttribute('href', '/?month=2026-05')
    await user.click(radio('3M'))
    expect(screen.queryByRole('link', { name: 'Open in Home' })).not.toBeInTheDocument()
    expect(screen.queryByText(/^May 2026:/)).not.toBeInTheDocument()
    expect(chart().queryAllByRole('button', { pressed: true })).toEqual([])
  })

  it('moves the range on with the calendar when the app comes back in a new month', () => {
    vi.setSystemTime(new Date(2026, 9, 31, 23, 0))
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    renderPage()
    expect(listening()).toEqual([SIX_MONTHS, SEP, OCT])

    vi.setSystemTime(new Date(2026, 10, 1, 9, 0)) // the phone sat locked overnight
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(listening()).toEqual(['2026-05-01..2026-11-30', SEP, OCT])
    expect(barLabels().at(-1)).toBe('Nov: €0.00, income €0.00')
  })

  it('shows no amounts before the currency is known', () => {
    useSettings.mockReturnValue({ settings: null, loading: true, fromCache: true, error: null })
    renderPage()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Spending by month' })).not.toBeInTheDocument() // the bar labels carry amounts too
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText(/[$€]/)).not.toBeInTheDocument()
  })

  it('waits for the categories, so no comparison row reads "Uncategorized" meanwhile', () => {
    withCategories([], true)
    renderPage()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByText('Uncategorized')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows a failed categories query as its error, with no tables of "Uncategorized" rows', () => {
    useCategories.mockReturnValue({ categories: [], byId: new Map(), loading: false, error: new FirebaseError('permission-denied', 'Missing or insufficient permissions.') })
    renderPage()
    expect(screen.getByText("You don't have access to this data (signed in with the wrong account?)")).toBeInTheDocument()
    expect(screen.queryByText('Uncategorized')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Spending by month' })).not.toBeInTheDocument()
  })

  it('shows a failed range query as its error, not as empty months', () => {
    answerRanges(SIX_MONTHS)
    renderPage()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    fail(SIX_MONTHS, new FirebaseError('resource-exhausted', 'Quota exceeded.'))
    expect(screen.getByText('Firebase quota reached, data will refresh after midnight PT')).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Spending by month' })).not.toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Monthly totals' })).not.toBeInTheDocument()
    expect(screen.queryByText('No data for this range.')).not.toBeInTheDocument()
  })

  it('says so when the range has no entries, but charts a range with income alone', () => {
    answerRanges(SIX_MONTHS)
    renderPage()
    deliver(SIX_MONTHS, [])
    expect(screen.getByText('No data for this range.')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Spending by month' })).not.toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Monthly totals' })).not.toBeInTheDocument()

    deliver(SIX_MONTHS, [entry('o5', SALARY.id, '2026-10-01', 300000, 'income')])
    expect(screen.queryByText('No data for this range.')).not.toBeInTheDocument()
    expect(bar('Oct')).toHaveAccessibleName('Oct: €0.00, income €3,000.00')
  })

  describe('comparing two months', () => {
    it('compares last month (A) with this month (B) by default, the biggest change first', () => {
      renderPage()
      expect(monthA()).toHaveDisplayValue('September 2026')
      expect(monthB()).toHaveDisplayValue('October 2026')
      expect(listening()).toEqual([SIX_MONTHS, SEP, OCT])
      expect(headOf(compareTable())).toEqual(['Category', 'Sep', 'Oct', 'Δ'])
      expect(bodyOf(compareTable())).toEqual([
        ['Gym', '€40.00', '€0.00', `-€40.00${MINUS}100 %`], // archived: still its own name, without "(archived)"
        ['Groceries', '€64.00', '€50.00', `-€14.00${MINUS}22 %`],
        ['Uncategorized', '€0.00', '€12.00', '+€12.00new'],
        ['Coffee', '€15.00', '€7.70', `-€7.30${MINUS}49 %`],
      ])
    })

    it('offers the last 24 months, newest first, for both months', () => {
      renderPage()
      const months = within(monthA()).getAllByRole('option').map((o) => o.textContent)
      expect(months).toHaveLength(24)
      expect(months.slice(0, 3)).toEqual(['October 2026', 'September 2026', 'August 2026'])
      expect(months.at(-1)).toBe('November 2024')
      expect(within(monthB()).getAllByRole('option').map((o) => o.textContent)).toEqual(months)
    })

    it('compares B against A whichever comes first', async () => {
      const user = userEvent.setup()
      renderPage()
      await user.selectOptions(monthA(), '2026-10')
      await user.selectOptions(monthB(), '2026-08')
      expect(listening()).toEqual([SIX_MONTHS, '2026-08-01..2026-08-31', OCT])
      expect(headOf(compareTable())).toEqual(['Category', 'Oct', 'Aug', 'Δ'])
      expect(bodyOf(compareTable())).toEqual([
        ['Groceries', '€50.00', '€30.00', `-€20.00${MINUS}40 %`],
        ['Uncategorized', '€12.00', '€0.00', `-€12.00${MINUS}100 %`],
        ['Coffee', '€7.70', '€0.00', `-€7.70${MINUS}100 %`],
      ])
      // The links open month B, the one being compared, even when it is the earlier of the two.
      expect(compare().getByRole('link', { name: 'Groceries' })).toHaveAttribute('href', '/category/c3?month=2026-08')
    })

    it('reads A and B with one month-shaped query each, the same Home makes, never the months between them', async () => {
      const user = userEvent.setup()
      renderPage()
      await user.selectOptions(monthA(), '2026-03')
      expect(listening()).toEqual(['2026-03-01..2026-03-31', SIX_MONTHS, OCT])
      await user.selectOptions(monthB(), '2025-11')
      expect(listening()).toEqual(['2025-11-01..2025-11-30', '2026-03-01..2026-03-31', SIX_MONTHS])
      // Five queries in all: the chart's range and one per month picked. October was read once although A changed after it.
      expect(queried().sort()).toEqual(['2025-11-01..2025-11-30', '2026-03-01..2026-03-31', SIX_MONTHS, SEP, OCT])
    })

    it('links each category to its page on month B, but not one that no longer exists', async () => {
      const user = userEvent.setup()
      renderPage()
      expect(compare().getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
        '/category/c2?month=2026-10',
        '/category/c3?month=2026-10',
        '/category/c1?month=2026-10',
      ])
      await user.click(compare().getByRole('link', { name: 'Gym' }))
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Category c2 month 2026-10$/)
    })

    it("leaves the month off the links when B is older than the category page's twelve months", async () => {
      const user = userEvent.setup()
      renderPage()
      await user.selectOptions(monthB(), '2025-11') // the oldest of the twelve (Nov 2025 to Oct 2026): still linked
      expect(compare().getByRole('link', { name: 'Gym' })).toHaveAttribute('href', '/category/c2?month=2025-11')
      await user.selectOptions(monthB(), '2025-10') // one month older: the category page could not show it
      expect(compare().getByRole('link', { name: 'Gym' })).toHaveAttribute('href', '/category/c2')
    })

    it('keeps its settled height while a new pair of months loads, so the page below does not jump', async () => {
      const user = userEvent.setup()
      renderPage()
      const body = screen.getByRole('region', { name: 'Compare two months' }).lastElementChild as HTMLElement
      // jsdom lays nothing out: from here on the settled table measures 420 px.
      Object.defineProperty(body, 'offsetHeight', { configurable: true, get: () => 420 })
      await user.selectOptions(monthA(), '2026-08') // answered at once, so that height is recorded once it settles
      expect(body.style.minHeight).toBe('')

      answerRanges(JUL)
      await user.selectOptions(monthA(), '2026-07')
      expect(compare().getByText('Loading…')).toBeInTheDocument()
      expect(body.style.minHeight).toBe('420px')

      deliver(JUL, rowsIn('2026-07-01', '2026-07-31'))
      expect(body.style.minHeight).toBe('')
    })

    it('says "Nothing to compare yet." when neither month has spending', async () => {
      const user = userEvent.setup()
      renderPage()
      await user.selectOptions(monthA(), '2026-06')
      await user.selectOptions(monthB(), '2026-05')
      expect(listening()).toEqual([SIX_MONTHS, '2026-05-01..2026-05-31', '2026-06-01..2026-06-30'])
      expect(compare().getByText('Nothing to compare yet.')).toBeInTheDocument()
      expect(compare().queryByRole('table')).not.toBeInTheDocument()
    })

    it.each([
      { month: 'A', held: SEP },
      { month: 'B', held: OCT },
    ])('shows its own loading line and error while month $month loads or fails, leaving the chart above alone', ({ held }) => {
      answerRanges(held) // the other month is in at once
      renderPage()
      expect(compare().getByText('Loading…')).toBeInTheDocument()
      expect(compare().queryByText('Nothing to compare yet.')).not.toBeInTheDocument()

      fail(held, new FirebaseError('unavailable', 'Failed to get documents from server.'))
      expect(compare().getByText("You're offline and this data isn't cached yet")).toBeInTheDocument()
      expect(compare().queryByText('Nothing to compare yet.')).not.toBeInTheDocument()
      expect(compare().queryByRole('table')).not.toBeInTheDocument()
      expect(barLabels()).toHaveLength(6)
    })
  })
})
