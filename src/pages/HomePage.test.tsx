import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FirebaseError } from 'firebase/app'
import { Timestamp } from 'firebase/firestore'
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate, useNavigationType, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AddSheetProvider } from '../context/AddSheetContext'
import { addMonths, currentMonth, monthLabel, monthRange, todayIso } from '../lib/dates'
import type { Category, IsoDate, IsoMonth, Transaction } from '../lib/types'
import { HomePage } from './HomePage'

const COFFEE: Category = { id: 'c1', name: 'Coffee', icon: 'Coffee', color: 'amber', kind: 'expense', order: 0, archived: false }
/** Archived after its transactions were logged: it still labels them (spec §11). */
const GYM: Category = { id: 'c2', name: 'Gym', icon: 'Dumbbell', color: 'sky', kind: 'expense', order: 1, archived: true }
const GROCERIES: Category = { id: 'c3', name: 'Groceries', icon: 'ShoppingCart', color: 'emerald', kind: 'expense', order: 2, archived: false }
const SALARY: Category = { id: 'c4', name: 'Salary', icon: 'Banknote', color: 'lime', kind: 'income', order: 0, archived: false }
const CATEGORIES = [COFFEE, GYM, GROCERIES, SALARY]
const FLAT_WHITE: Transaction = { id: 't1', kind: 'expense', amount: 350, categoryId: 'c1', note: 'flat white', date: todayIso(), at: Timestamp.now(), source: 'app' }

const { subscribeTransactionsInRange, useSettings, useBudgets } = vi.hoisted(() => ({
  subscribeTransactionsInRange: vi.fn(),
  useSettings: vi.fn(),
  useBudgets: vi.fn(),
}))
// The real useTransactions runs on top of this, so its reset on a month change is under test too.
vi.mock('../lib/firestore', () => ({ subscribeTransactionsInRange }))
vi.mock('../hooks/useCategories', () => ({
  useCategories: () => ({ categories: CATEGORIES, byId: new Map(CATEGORIES.map((c) => [c.id, c])), loading: false, error: null }),
}))
vi.mock('../hooks/useSettings', () => ({ useSettings }))
vi.mock('../hooks/useBudgets', () => ({ useBudgets }))

/** Stands in for the category page and shows the id it was opened with. */
function CategoryStub() {
  const { id } = useParams()
  return <h1>{`Category ${id}`}</h1>
}

/** Shows the router's URL and how it was last reached (PUSH, REPLACE or POP). */
function UrlProbe() {
  const { pathname, search } = useLocation()
  const navigation = useNavigationType()
  return <p data-testid="url" data-navigation={navigation}>{pathname + search}</p>
}

/** Stands in for the tab bar's Home tab (a push to `/`) and for the system's Back. */
function NavProbe() {
  const navigate = useNavigate()
  return (
    <>
      <Link to="/">Home tab</Link>
      <button type="button" onClick={() => navigate(-1)}>
        Step back
      </button>
    </>
  )
}

/** One path, or the history that led to the last one. */
const page = (path: string | string[] = '/') => (
  <AddSheetProvider>
    <MemoryRouter initialEntries={typeof path === 'string' ? [path] : path}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="category/:id" element={<CategoryStub />} />
      </Routes>
      <UrlProbe />
      <NavProbe />
    </MemoryRouter>
  </AddSheetProvider>
)
const url = () => screen.getByTestId('url').textContent
const lastNavigation = () => screen.getByTestId('url').dataset.navigation

/** The newest subscription to the month's range. Home listens to the shown month and to the month before it. */
function subscriptionTo(month: IsoMonth) {
  const call = subscribeTransactionsInRange.mock.calls.filter(([from]) => from === monthRange(month).from).at(-1)
  if (!call) throw new Error(`Nothing subscribed to ${month}`)
  return call
}
/** Answers the month's subscription (the current month unless named) with rows and the snapshot's hasPendingWrites. */
const deliver = (rows: Transaction[], { month = currentMonth(), pending = false }: { month?: IsoMonth; pending?: boolean } = {}) =>
  act(() => subscriptionTo(month)[2](rows, pending))
/** Fails the month's subscription (the current month unless named). */
const fail = (e: Error, month: IsoMonth = currentMonth()) => act(() => subscriptionTo(month)[3](e))
/** The ranges Home is listening to right now (subscribed and not unsubscribed since), oldest first. */
const listening = () =>
  subscribeTransactionsInRange.mock.calls
    .filter((_, i) => subscribeTransactionsInRange.mock.results[i].value.mock.calls.length === 0)
    .map(([from, to]) => ({ from, to }))
    .sort((a, b) => a.from.localeCompare(b.from))
const withSettingsLoaded = () => useSettings.mockReturnValue({ settings: { currency: 'EUR', locale: 'en' }, loading: false, fromCache: false, error: null })
/** The monthly limits by category id, as useBudgets delivers them. */
const withBudgets = (limits: [string, number][] = []) => useBudgets.mockReturnValue({ budgets: new Map(limits), loading: false, error: null })

beforeEach(() => {
  vi.clearAllMocks()
  subscribeTransactionsInRange.mockImplementation(() => vi.fn()) // each subscription gets its own unsubscribe spy
  withBudgets() // none, unless a test sets some
})

describe('HomePage', () => {
  it('shows no amounts before the currency is known and nothing from one month under another', async () => {
    const user = userEvent.setup()
    useSettings.mockReturnValue({ settings: null, loading: true, fromCache: true, error: null })
    const { rerender } = render(page())
    deliver([FLAT_WHITE]) // rows may arrive before the settings snapshot
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByText('Spent')).not.toBeInTheDocument()
    expect(screen.queryByText(/[$€]/)).not.toBeInTheDocument()

    withSettingsLoaded()
    rerender(page())
    expect(screen.getByRole('button', { name: /coffee.*flat white.*€3\.50/i })).toBeInTheDocument()
    fail(new Error('boom'))
    expect(screen.getByText('boom')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    const shown = addMonths(currentMonth(), -1)
    expect(listening()).toEqual([monthRange(addMonths(shown, -1)), monthRange(shown)])
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /coffee/i })).not.toBeInTheDocument()
    expect(screen.queryByText('€3.50')).not.toBeInTheDocument() // no stale totals in the summary either
    expect(screen.queryByText('boom')).not.toBeInTheDocument()

    deliver([], { month: shown })
    expect(screen.getByText(`Nothing in ${monthLabel(shown, 'en')}`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add your first entry' })).toBeInTheDocument()
  })

  it('shows "Syncing…" while the month holds unacknowledged writes and hides it once they are synced', () => {
    withSettingsLoaded()
    render(page())
    deliver([FLAT_WHITE], { pending: true }) // added offline: on screen at once, not yet on the server
    expect(screen.getByRole('button', { name: /coffee.*flat white.*€3\.50/i })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Syncing…')
    expect(screen.getByText('Spent').closest('section')).toContainElement(screen.getByRole('status')) // a badge on the summary card

    deliver([FLAT_WHITE]) // the server acknowledged it
    expect(screen.queryByText('Syncing…')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /coffee.*flat white.*€3\.50/i })).toBeInTheDocument()
  })

  it('drops "Syncing…" when the month changes or its query fails', async () => {
    const user = userEvent.setup()
    withSettingsLoaded()
    render(page())
    deliver([FLAT_WHITE], { pending: true })
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.queryByText('Syncing…')).not.toBeInTheDocument() // before the new month's first snapshot

    const shown = addMonths(currentMonth(), -1)
    deliver([], { month: shown, pending: true })
    expect(screen.getByText('Syncing…')).toBeInTheDocument()
    fail(new Error('Missing or insufficient permissions.'), shown)
    expect(screen.queryByText('Syncing…')).not.toBeInTheDocument() // the listener is gone; nothing would clear it later
  })

  it('shows a failed month query as its error alone under the summary, not as an empty month', () => {
    withSettingsLoaded()
    render(page())
    fail(new FirebaseError('permission-denied', 'Missing or insufficient permissions.'))
    const message = screen.getByText("You don't have access to this data (signed in with the wrong account?)")
    expect(screen.getByText('Spent').compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText(/^Nothing in/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add your first entry' })).not.toBeInTheDocument()
  })

  it('labels an archived category by its name and a removed one as "Uncategorized", in the breakdown and the list', () => {
    withSettingsLoaded()
    render(page())
    deliver([
      { ...FLAT_WHITE, id: 't2', categoryId: GYM.id, amount: 4000, note: 'monthly pass' },
      { ...FLAT_WHITE, id: 't3', categoryId: 'removed-in-console', amount: 1200, note: '' },
    ])
    const breakdown = within(screen.getByRole('heading', { name: 'By category' }).closest('section') as HTMLElement)
    expect(breakdown.getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^Gym€40\.00/),
      expect.stringMatching(/^Uncategorized€12\.00/),
    ])
    expect(screen.getByRole('button', { name: /^Gym.*monthly pass.*€40\.00$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Uncategorized.*€12\.00$/ })).toBeInTheDocument()
  })

  it('opens an archived category from the breakdown, but leaves a removed one plain', async () => {
    const user = userEvent.setup()
    withSettingsLoaded()
    render(page())
    deliver([
      { ...FLAT_WHITE, id: 't2', categoryId: GYM.id, amount: 4000, note: 'monthly pass' },
      { ...FLAT_WHITE, id: 't3', categoryId: 'removed-in-console', amount: 1200, note: '' },
    ])
    const breakdown = within(screen.getByRole('heading', { name: 'By category' }).closest('section') as HTMLElement)
    expect(breakdown.getAllByRole('button').map((b) => b.textContent)).toEqual([expect.stringMatching(/^Gym/)])
    await user.click(breakdown.getByText('Uncategorized'))
    expect(url()).toBe('/') // still Home: a category removed by hand has no page
    await user.click(breakdown.getByRole('button', { name: /^Gym/ }))
    expect(url()).toBe('/category/c2')
  })

  it('reaches future months, so an entry saved with a wrong date can be found', async () => {
    const user = userEvent.setup()
    withSettingsLoaded()
    render(page())
    const next = screen.getByRole('button', { name: 'Next month' })
    expect(next).toBeEnabled()
    await user.click(next)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(monthLabel(addMonths(currentMonth(), 1), 'en'))
    expect(listening()).toEqual([monthRange(currentMonth()), monthRange(addMonths(currentMonth(), 1))])
  })

  describe('as the clock moves on', () => {
    const heading = () => screen.getByRole('heading', { level: 1 })
    /** The phone sat locked: the clock moves on, then the page turns visible again. */
    const resumeAt = (now: Date) => {
      vi.setSystemTime(now)
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
    }

    beforeEach(() => {
      // Only the clock: Testing Library's async wrapper (behind userEvent) waits on a real setTimeout that faked timers would freeze.
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(2026, 9, 31, 23, 0))
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
      withSettingsLoaded()
    })

    afterEach(() => {
      vi.useRealTimers()
      vi.restoreAllMocks() // the visibilityState spy
    })

    it('follows the calendar into the new month while the current month is shown', () => {
      render(page())
      expect(heading()).toHaveTextContent('October 2026')
      resumeAt(new Date(2026, 10, 1, 9, 0))
      expect(heading()).toHaveTextContent('November 2026')
      expect(listening()).toEqual([
        { from: '2026-10-01', to: '2026-10-31' },
        { from: '2026-11-01', to: '2026-11-30' },
      ])
    })

    it('stays on a month picked on purpose', async () => {
      const user = userEvent.setup()
      render(page())
      await user.click(screen.getByRole('button', { name: 'Previous month' }))
      resumeAt(new Date(2026, 10, 1, 9, 0))
      expect(heading()).toHaveTextContent('September 2026')
    })

    it('follows again once the current month is picked again', async () => {
      const user = userEvent.setup()
      render(page())
      await user.click(screen.getByRole('button', { name: 'Previous month' }))
      await user.click(screen.getByRole('button', { name: 'Next month' }))
      resumeAt(new Date(2026, 10, 1, 9, 0))
      expect(heading()).toHaveTextContent('November 2026')
    })

    it('follows the calendar again once the current month is picked in the month picker', async () => {
      const user = userEvent.setup()
      render(page('/?month=2026-07'))
      await user.click(within(heading()).getByRole('button'))
      await user.click(within(screen.getByRole('dialog', { name: 'Choose month' })).getByRole('button', { name: 'October' }))
      expect(url()).toBe('/')
      resumeAt(new Date(2026, 10, 1, 9, 0))
      expect(heading()).toHaveTextContent('November 2026')
    })

    it('follows the calendar after a link to the current month', () => {
      render(page('/?month=2026-10'))
      expect(url()).toBe('/') // the URL only ever names a month other than the current one
      resumeAt(new Date(2026, 10, 1, 9, 0))
      expect(heading()).toHaveTextContent('November 2026')
    })

    it('stays on a linked month that is not the current one', () => {
      render(page('/?month=2026-07'))
      resumeAt(new Date(2026, 10, 1, 9, 0))
      expect(heading()).toHaveTextContent('July 2026')
    })

    it('goes to the current month when the Home tab is tapped on a linked month, and follows the calendar again', async () => {
      const user = userEvent.setup()
      render(page('/?month=2026-07'))
      expect(heading()).toHaveTextContent('July 2026')
      await user.click(screen.getByRole('link', { name: 'Home tab' }))
      expect(url()).toBe('/')
      expect(heading()).toHaveTextContent('October 2026')
      expect(listening()).toEqual([
        { from: '2026-09-01', to: '2026-09-30' },
        { from: '2026-10-01', to: '2026-10-31' },
      ])
      resumeAt(new Date(2026, 10, 1, 9, 0))
      expect(heading()).toHaveTextContent('November 2026')
    })

    it('shows a linked month again on a step back to it, and stays on it', async () => {
      const user = userEvent.setup()
      render(page('/?month=2026-07'))
      await user.click(screen.getByRole('link', { name: 'Home tab' }))
      await user.click(screen.getByRole('button', { name: 'Step back' }))
      expect(url()).toBe('/?month=2026-07')
      expect(heading()).toHaveTextContent('July 2026')
      resumeAt(new Date(2026, 10, 1, 9, 0))
      expect(heading()).toHaveTextContent('July 2026')
    })

    it.each(['2026-10', 'garbage'])('treats a step back to ?month=%s like a link to it: the current month, dropped from the URL', async (value) => {
      const user = userEvent.setup()
      render(page([`/?month=${value}`, '/?month=2026-07']))
      expect(heading()).toHaveTextContent('July 2026')
      await user.click(screen.getByRole('button', { name: 'Step back' }))
      expect(heading()).toHaveTextContent('October 2026')
      expect(url()).toBe('/')
      expect(lastNavigation()).toBe('REPLACE')
      resumeAt(new Date(2026, 10, 1, 9, 0))
      expect(heading()).toHaveTextContent('November 2026')
    })

    it('keeps its own month changes through the URL, and follows the calendar again once back on the current month', async () => {
      const user = userEvent.setup()
      render(page('/?month=2026-07'))
      await user.click(screen.getByRole('button', { name: 'Next month' }))
      await user.click(screen.getByRole('button', { name: 'Next month' }))
      expect(heading()).toHaveTextContent('September 2026')
      expect(url()).toBe('/?month=2026-09')
      await user.click(screen.getByRole('button', { name: 'Next month' }))
      expect(heading()).toHaveTextContent('October 2026')
      expect(url()).toBe('/')
      resumeAt(new Date(2026, 10, 1, 9, 0))
      expect(heading()).toHaveTextContent('November 2026')
    })

    it('moves "Today" and "Yesterday" on after midnight', () => {
      vi.setSystemTime(new Date(2026, 9, 15, 23, 0))
      render(page())
      deliver([{ ...FLAT_WHITE, date: '2026-10-15' }])
      expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument()
      resumeAt(new Date(2026, 9, 16, 9, 0))
      expect(screen.getByRole('heading', { name: 'Yesterday' })).toBeInTheDocument()
    })

    it('also moves the day labels on with a snapshot that arrives after midnight in the foreground', () => {
      vi.setSystemTime(new Date(2026, 9, 15, 23, 50))
      render(page())
      deliver([{ ...FLAT_WHITE, date: '2026-10-15' }])
      vi.setSystemTime(new Date(2026, 9, 16, 0, 10)) // still open on screen: no visibility or focus event
      deliver([{ ...FLAT_WHITE, id: 't2', date: '2026-10-16' }, { ...FLAT_WHITE, date: '2026-10-15' }]) // an entry added after midnight
      expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Today', 'Yesterday'])
    })
  })

  describe('insights', () => {
    const entry = (id: string, category: Category, date: IsoDate, amount: number, note: string): Transaction => {
      const [y, m, d] = date.split('-').map(Number)
      return { id, kind: category.kind, amount, categoryId: category.id, note, date, at: Timestamp.fromDate(new Date(y, m - 1, d, 9)), source: 'app' }
    }
    // The clock is set to Saturday 17 Oct 2026 below. October's spending so far: €3.50 + €4.20 + €50.00 = €57.70.
    const OCTOBER = [
      entry('o1', COFFEE, '2026-10-17', 350, 'flat white'),
      entry('o2', COFFEE, '2026-10-10', 420, 'oat latte'),
      entry('o3', GROCERIES, '2026-10-10', 5000, 'weekly shop'),
      entry('o4', SALARY, '2026-10-01', 300000, ''),
    ]
    // By the 17th €40.00 + €5.00 = €45.00; the beans on the 20th only count in the full month (coffee €15.00).
    const SEPTEMBER = [
      entry('s1', GYM, '2026-09-01', 4000, 'monthly pass'),
      entry('s2', COFFEE, '2026-09-05', 500, 'cortado'),
      entry('s3', COFFEE, '2026-09-20', 1000, 'beans'),
      entry('s4', SALARY, '2026-09-01', 300000, ''),
    ]
    const showBothMonths = () => {
      deliver(OCTOBER)
      deliver(SEPTEMBER, { month: '2026-09' })
    }
    const paceLine = () => screen.queryByText(/ by day /)
    const breakdown = () => screen.getByRole('heading', { name: 'By category' }).closest('section') as HTMLElement
    /** Each breakdown row's text: name, amount, share and, when there is one, the badge. */
    const breakdownRows = () => within(breakdown()).getAllByRole('listitem').map((row) => row.textContent)

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] }) // only the clock, as above
      vi.setSystemTime(new Date(2026, 9, 17, 12, 0))
      withSettingsLoaded()
    })

    afterEach(() => {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    })

    it('compares the spending so far with the same days of last month', () => {
      render(page())
      expect(listening()).toEqual([
        { from: '2026-09-01', to: '2026-09-30' },
        { from: '2026-10-01', to: '2026-10-31' },
      ])
      showBothMonths()
      // (5770 − 4500) / 4500 = +28.2 %; the income is not spending.
      expect(paceLine()?.textContent).toBe('€57.70 by day 17 · last month by day 17: €45.00 +28 %')
    })

    it('badges each category with its change since last month to the same day, "new" when it had nothing then', () => {
      render(page())
      showBothMonths()
      // Coffee: €7.70 against the €5.00 of September up to the 17th (+54 %); the beans of the 20th are still to come.
      // The gym pass that stopped has no row this month.
      expect(breakdownRows()).toEqual(['Groceries€50.0087%new', 'Coffee€7.7013%+54 %'])
      expect(within(breakdown()).getByText('vs last month to date')).toBeInTheDocument()
    })

    it('badges a past month against the whole month before it', () => {
      render(page('/?month=2026-09'))
      deliver(SEPTEMBER, { month: '2026-09' })
      // August's coffee came on the 25th: it counts, although today is only the 17th.
      deliver([entry('a1', COFFEE, '2026-08-25', 1000, 'beans')], { month: '2026-08' })
      // Coffee: €15.00 against €10.00 (+50 %); the gym pass is new.
      expect(breakdownRows()).toEqual(['Gym€40.0073%new', 'Coffee€15.0027%+50 %'])
      expect(within(breakdown()).getByText('vs previous month')).toBeInTheDocument()
      expect(within(breakdown()).queryByText('vs last month to date')).not.toBeInTheDocument()
    })

    it('still compares when last month had no entries', () => {
      render(page())
      deliver(OCTOBER)
      deliver([], { month: '2026-09' })
      expect(paceLine()?.textContent).toBe('€57.70 by day 17 · no data for last month')
      expect(breakdownRows()).toEqual(['Groceries€50.0087%new', 'Coffee€7.7013%new'])
    })

    it('lays out the summary, the pace line, the daily strip, the breakdown and the days in that order', () => {
      render(page())
      showBothMonths()
      const order = [
        screen.getByText('Spent'),
        screen.getByText(/ by day /),
        screen.getByRole('img', { name: /^Daily spending/ }),
        screen.getByRole('heading', { name: 'By category' }),
        screen.getAllByRole('heading', { level: 3 })[0],
      ]
      expect(order.slice(1).map((el, i) => Boolean(order[i].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING))).toEqual([true, true, true, true])
    })

    it('names the month in the daily strip in the language of the settings', () => {
      useSettings.mockReturnValue({ settings: { currency: 'EUR', locale: 'de' }, loading: false, fromCache: false, error: null })
      render(page())
      showBothMonths()
      expect(screen.getByRole('img', { name: /^Daily spending in Oktober 2026: / })).toBeInTheDocument()
    })

    it('compares nothing until last month has arrived, so no category reads as "new" meanwhile', () => {
      render(page())
      deliver(OCTOBER)
      expect(paceLine()).not.toBeInTheDocument()
      expect(breakdownRows()).toEqual(['Groceries€50.0087%', 'Coffee€7.7013%'])

      deliver(SEPTEMBER, { month: '2026-09' })
      expect(paceLine()).toBeInTheDocument()
      expect(breakdownRows()).toEqual(['Groceries€50.0087%new', 'Coffee€7.7013%+54 %'])
    })

    it('shows no pace line while the month loads or when it has no entries', () => {
      render(page())
      deliver(SEPTEMBER, { month: '2026-09' }) // last month arrives first
      expect(screen.getByText('Loading…')).toBeInTheDocument()
      expect(paceLine()).not.toBeInTheDocument()

      deliver([])
      expect(screen.getByText('Nothing in October 2026')).toBeInTheDocument()
      expect(paceLine()).not.toBeInTheDocument()
    })

    it('compares nothing when last month cannot be read', () => {
      render(page())
      deliver(OCTOBER)
      fail(new Error('Missing or insufficient permissions.'), '2026-09')
      expect(paceLine()).not.toBeInTheDocument()
      expect(breakdownRows()).toEqual(['Groceries€50.0087%', 'Coffee€7.7013%'])
    })

    it('opens the category page from a breakdown row', async () => {
      const user = userEvent.setup()
      render(page())
      showBothMonths()
      await user.click(within(breakdown()).getByRole('button', { name: /^Groceries/ }))
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Category c3')
      expect(url()).toBe('/category/c3') // the current month needs no ?month=
      expect(lastNavigation()).toBe('PUSH') // a step back in history returns to Home
    })

    it('opens a category on the month Home shows', async () => {
      const user = userEvent.setup()
      render(page('/?month=2026-09'))
      deliver([entry('s2', COFFEE, '2026-09-05', 500, 'cortado')], { month: '2026-09' })
      await user.click(within(breakdown()).getByRole('button', { name: /^Coffee/ }))
      expect(url()).toBe('/category/c1?month=2026-09')
    })

    it('keeps a month other than the current one in the URL, without adding history entries', async () => {
      const user = userEvent.setup()
      render(page())
      await user.click(screen.getByRole('button', { name: 'Previous month' }))
      expect(url()).toBe('/?month=2026-09')
      expect(lastNavigation()).toBe('REPLACE')
      await user.click(screen.getByRole('button', { name: 'Next month' }))
      expect(url()).toBe('/')
      expect(lastNavigation()).toBe('REPLACE')
    })

    it("draws the month's spending per day in the daily strip", () => {
      render(page())
      showBothMonths()
      expect(screen.getByRole('img', { name: /^Daily spending in .+: €57\.70 over 31 days$/ })).toBeInTheDocument()
    })

    it('opens the month named in ?month= against the month before it, without a pace line', () => {
      render(page('/?month=2026-07'))
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('July 2026')
      expect(listening()).toEqual([
        { from: '2026-06-01', to: '2026-06-30' },
        { from: '2026-07-01', to: '2026-07-31' },
      ])
      deliver([entry('j1', COFFEE, '2026-07-14', 600, 'espresso')], { month: '2026-07' })
      deliver([entry('u1', COFFEE, '2026-06-14', 300, 'espresso')], { month: '2026-06' })
      expect(breakdownRows()).toEqual(['Coffee€6.00100%+100 %'])
      expect(paceLine()).not.toBeInTheDocument() // pace is for the current month only
      expect(url()).toBe('/?month=2026-07')
    })

    it.each(['garbage', '2026-13', '2026-7', '2026-07-15', 'x2026-07', '2026-071'])('ignores ?month=%s and opens the current month', (value) => {
      render(page(`/?month=${value}`))
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('October 2026')
      expect(url()).toBe('/') // and drops it from the URL
    })

    describe('tapping the daily strip', () => {
      const scrollIntoView = vi.fn()
      /** Taps the strip `clientX` px from its left edge; the strip is faked 310 px wide, 10 px per day of October. */
      async function tapStrip(clientX: number) {
        const strip = screen.getByRole('img', { name: /^Daily spending/ })
        vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 310 } as DOMRect)
        await userEvent.pointer({ keys: '[MouseLeft]', target: strip, coords: { clientX } })
      }

      beforeEach(() => {
        Element.prototype.scrollIntoView = scrollIntoView // jsdom does no layout, so it has no scrolling either
      })

      afterEach(() => {
        Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
      })

      it("brings the tapped day's entries into view", async () => {
        render(page())
        showBothMonths()
        await tapStrip(95) // 95 / 310 × 31 = 9.5 → the 10th
        expect(scrollIntoView.mock.calls).toEqual([[{ behavior: 'smooth', block: 'start' }]])
        const scrolled = within(scrollIntoView.mock.contexts[0] as HTMLElement)
        expect(scrolled.getByRole('heading', { level: 3 })).toHaveTextContent('Sat, Oct 10')
        expect(scrolled.getAllByRole('listitem')).toHaveLength(2) // the whole day: its heading and both of its entries
      })

      it('leaves the list where it is for a day without entries', async () => {
        render(page())
        showBothMonths()
        await tapStrip(45) // the 5th
        expect(scrollIntoView).not.toHaveBeenCalled()
      })

      it('jumps without the smooth scroll when the device asks for reduced motion', async () => {
        vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }))
        render(page())
        showBothMonths()
        await tapStrip(95)
        expect(scrollIntoView.mock.calls).toEqual([[{ behavior: 'auto', block: 'start' }]])
      })
    })

    describe('budgets', () => {
      const summary = () => screen.getByText('Spent').closest('section') as HTMLElement
      const budgetLine = () => within(summary()).queryByText(/^Budgets: /)

      it('adds up the budgeted categories of the month in a muted line under the hero', () => {
        // Coffee's limit counts; those of an income category and of an archived one do not.
        withBudgets([[COFFEE.id, 1000], [SALARY.id, 500000], [GYM.id, 2000]])
        render(page())
        showBothMonths()
        const line = budgetLine() as HTMLElement
        expect(line).toHaveTextContent(/^Budgets: €7\.70 of €10\.00$/) // not the €50.00 of unbudgeted groceries
        expect(line).toHaveClass('tnum', 'text-muted')
        expect(within(summary()).getByText('€57.70').compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      })

      it('counts the spending of the shown month only', () => {
        withBudgets([[COFFEE.id, 1000]])
        render(page('/?month=2026-09'))
        deliver(SEPTEMBER, { month: '2026-09' })
        deliver([entry('a1', COFFEE, '2026-08-25', 1000, 'beans')], { month: '2026-08' })
        expect(budgetLine()).toHaveTextContent(/^Budgets: €15\.00 of €10\.00$/) // September's coffee, not August's
      })

      it('shows the budgets of a month without entries too', () => {
        withBudgets([[COFFEE.id, 1000]])
        render(page())
        deliver([])
        expect(screen.getByText('Nothing in October 2026')).toBeInTheDocument()
        expect(budgetLine()).toHaveTextContent(/^Budgets: €0\.00 of €10\.00$/)
      })

      it('draws each budgeted category against its limit, and one without spending as an empty row', () => {
        withBudgets([[COFFEE.id, 500], [GROCERIES.id, 10000], [GYM.id, 2000], [SALARY.id, 500000]])
        render(page())
        deliver(OCTOBER.filter((t) => t.categoryId !== GROCERIES.id))
        // Coffee is past its €5.00; nothing went on groceries yet. The archived gym and the income category get no row.
        expect(breakdownRows()).toEqual(['Coffee€7.70€7.70 of €5.00', 'Groceries€0.00€0.00 of €100.00'])
        const bars = within(breakdown()).getAllByTestId('bar')
        expect(bars.map((bar) => bar.style.width)).toEqual(['100%', '0%'])
        expect(bars[0]).toHaveClass('bg-expense')
        expect(budgetLine()).toHaveTextContent(/^Budgets: €7\.70 of €105\.00$/)
      })

      it('changes nothing without a budget of an active expense category', () => {
        withBudgets([[GYM.id, 2000], [SALARY.id, 500000]])
        render(page())
        deliver([...OCTOBER, entry('o5', GYM, '2026-10-05', 4000, 'monthly pass')])
        expect(budgetLine()).not.toBeInTheDocument()
        // The archived gym keeps its share although its old limit is still stored.
        expect(breakdownRows()).toEqual(['Groceries€50.0051%', 'Gym€40.0041%', 'Coffee€7.708%'])
      })
    })

    describe('month picker', () => {
      const heading = () => screen.getByRole('heading', { level: 1 })
      /** The month label in the header: the button that opens the picker. */
      const monthButton = () => within(heading()).getByRole('button')
      const picker = () => within(screen.getByRole('dialog', { name: 'Choose month' }))

      it('opens from the month label and shows the picked month, kept in the URL', async () => {
        const user = userEvent.setup()
        render(page())
        expect(monthButton()).toHaveAccessibleName('October 2026')
        expect(monthButton()).toHaveAttribute('aria-haspopup', 'dialog')
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

        await user.click(monthButton())
        expect(picker().getByRole('button', { name: 'October' })).toHaveAttribute('aria-pressed', 'true')
        await user.click(picker().getByRole('button', { name: 'July' }))
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(heading()).toHaveTextContent('July 2026')
        expect(url()).toBe('/?month=2026-07')
        expect(lastNavigation()).toBe('REPLACE')
        expect(listening()).toEqual([
          { from: '2026-06-01', to: '2026-06-30' },
          { from: '2026-07-01', to: '2026-07-31' },
        ])
        expect(monthButton()).toHaveFocus() // back where the picker was opened from
      })

      it('reaches the months of other years, the years ahead included', async () => {
        const user = userEvent.setup()
        render(page('/?month=2026-07'))
        await user.click(monthButton())
        expect(picker().getByRole('button', { name: 'July' })).toHaveAttribute('aria-pressed', 'true')
        await user.click(picker().getByRole('button', { name: 'Previous year' }))
        await user.click(picker().getByRole('button', { name: 'December' }))
        expect(heading()).toHaveTextContent('December 2025')
        expect(url()).toBe('/?month=2025-12')

        await user.click(monthButton())
        expect(picker().getByRole('button', { name: 'December' })).toHaveAttribute('aria-pressed', 'true') // it opens on 2025 now
        await user.click(picker().getByRole('button', { name: 'Next year' }))
        await user.click(picker().getByRole('button', { name: 'Next year' }))
        await user.click(picker().getByRole('button', { name: 'January' }))
        expect(heading()).toHaveTextContent('January 2027')
        expect(url()).toBe('/?month=2027-01')
      })
    })

    describe('search', () => {
      const scrollIntoView = vi.fn()
      const searchButton = () => screen.getByRole('button', { name: 'Search' })
      const field = () => screen.getByRole('searchbox', { name: 'Search notes and categories' })
      const kind = (name: 'All' | 'Expenses' | 'Income') => screen.getByRole('radio', { name })
      /** The rows of the day list, newest day first, each as its text: category, note and amount. */
      const entries = () =>
        screen
          .queryAllByRole('heading', { level: 3 })
          .flatMap((day) => within(day.closest('[id^="day-"]') as HTMLElement).getAllByRole('listitem').map((row) => row.textContent))
      const OCTOBER_ENTRIES = ['Coffeeflat white€3.50', 'Coffeeoat latte€4.20', 'Groceriesweekly shop€50.00', 'Salary+€3,000.00']

      beforeEach(() => {
        Element.prototype.scrollIntoView = scrollIntoView // jsdom does no layout, so it has no scrolling either
      })

      afterEach(() => {
        Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
      })

      it('keeps the field collapsed behind the Search button in the header until it is asked for', async () => {
        const user = userEvent.setup()
        render(page())
        showBothMonths()
        const button = searchButton()
        expect(button).toHaveClass('size-11')
        expect(button.compareDocumentPosition(screen.getByText('Spent')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy() // in the header
        expect(button).toHaveAttribute('aria-expanded', 'false')
        expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()

        await user.click(button)
        expect(button).toHaveAttribute('aria-expanded', 'true')
        expect(field()).toHaveFocus()
        expect(document.getElementById(button.getAttribute('aria-controls') ?? '')).toContainElement(field())
        expect(entries()).toEqual(OCTOBER_ENTRIES) // nothing typed yet: the whole month
        expect(screen.getByRole('status')).toBeEmptyDOMElement()
      })

      it('sits between the breakdown and the days, and goes to the top of the screen with the days under it', async () => {
        const user = userEvent.setup()
        render(page())
        showBothMonths()
        await user.click(searchButton())
        const order = [screen.getByRole('heading', { name: 'By category' }), field(), screen.getAllByRole('heading', { level: 3 })[0]]
        expect(order.slice(1).map((el, i) => Boolean(order[i].compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING))).toEqual([true, true])
        // At once, not smoothly: on iOS the keyboard coming up scrolls the focused field too, which would cut a smooth scroll short.
        expect(scrollIntoView.mock.calls).toEqual([[{ block: 'start' }]])
        const scrolled = scrollIntoView.mock.contexts[0] as HTMLElement
        expect(scrolled).toContainElement(field())
        expect(scrolled).toContainElement(screen.getAllByRole('heading', { level: 3 })[0])
        expect(scrolled).not.toContainElement(breakdown())
        // At least a screen tall: a list narrowed to nothing must not shorten the page and pull the field down behind the keyboard.
        expect(scrolled).toHaveClass('min-h-dvh')
      })

      it('finds entries by note, whatever the case and the spaces around the query, and counts them', async () => {
        const user = userEvent.setup()
        render(page())
        showBothMonths()
        await user.click(searchButton())
        await user.type(field(), '  LATTE ')
        expect(entries()).toEqual(['Coffeeoat latte€4.20'])
        expect(screen.getByRole('status')).toHaveTextContent(/^1 matching entry$/)
        // A day totals its matching entries only: the groceries of the 10th are not on show.
        const day = screen.getByRole('heading', { level: 3, name: 'Sat, Oct 10' }).closest('[id^="day-"]') as HTMLElement
        expect(within(day).getByText('−€4.20')).toBeInTheDocument()

        deliver([...OCTOBER, entry('o5', COFFEE, '2026-10-17', 450, 'Iced LATTE')]) // logged meanwhile on another device
        expect(entries()).toEqual(['CoffeeIced LATTE€4.50', 'Coffeeoat latte€4.20'])
        expect(screen.getByRole('status')).toHaveTextContent(/^2 matching entries$/)
      })

      it('finds entries by the name of their category as the list shows it, archived or removed', async () => {
        const user = userEvent.setup()
        render(page())
        deliver([
          ...OCTOBER,
          entry('o5', GYM, '2026-10-05', 4000, 'monthly pass'),
          { ...entry('o6', COFFEE, '2026-10-03', 1200, 'gift'), categoryId: 'removed-in-console' },
        ])
        await user.click(searchButton())
        await user.type(field(), 'coffee')
        expect(entries()).toEqual(['Coffeeflat white€3.50', 'Coffeeoat latte€4.20'])
        expect(screen.getByRole('status')).toHaveTextContent(/^2 matching entries$/)
        await user.clear(field())
        await user.type(field(), 'gym')
        expect(entries()).toEqual(['Gymmonthly pass€40.00'])
        await user.clear(field())
        await user.type(field(), 'uncategorized')
        expect(entries()).toEqual(['Uncategorizedgift€12.00'])
      })

      it('narrows by kind, alone or together with the query', async () => {
        const user = userEvent.setup()
        render(page())
        showBothMonths()
        await user.click(searchButton())
        await user.click(kind('Income'))
        expect(entries()).toEqual(['Salary+€3,000.00'])
        expect(screen.getByRole('status')).toHaveTextContent(/^1 matching entry$/)
        await user.click(kind('Expenses'))
        expect(entries()).toEqual(['Coffeeflat white€3.50', 'Coffeeoat latte€4.20', 'Groceriesweekly shop€50.00'])
        expect(screen.getByRole('status')).toHaveTextContent(/^3 matching entries$/)
        await user.type(field(), 'shop')
        expect(entries()).toEqual(['Groceriesweekly shop€50.00'])
        await user.click(kind('Income'))
        expect(entries()).toEqual([])
        await user.click(kind('All'))
        expect(entries()).toEqual(['Groceriesweekly shop€50.00'])
      })

      it('says "No matches" when nothing matches', async () => {
        const user = userEvent.setup()
        render(page())
        showBothMonths()
        await user.click(searchButton())
        await user.type(field(), 'zzz')
        expect(entries()).toEqual([])
        expect(screen.getByRole('status')).toHaveTextContent(/^No matches$/)
      })

      it('keeps the summary, the pace line, the daily strip and the breakdown on the whole month', async () => {
        const user = userEvent.setup()
        render(page())
        showBothMonths()
        await user.click(searchButton())
        await user.type(field(), 'latte')
        await user.click(kind('Expenses'))
        expect(entries()).toEqual(['Coffeeoat latte€4.20'])
        const summary = within(screen.getByText('Spent').closest('section') as HTMLElement)
        expect(summary.getByText('€57.70')).toBeInTheDocument()
        expect(summary.getByText('€3,000.00')).toBeInTheDocument()
        expect(paceLine()?.textContent).toBe('€57.70 by day 17 · last month by day 17: €45.00 +28 %')
        expect(screen.getByRole('img', { name: /^Daily spending in .+: €57\.70 over 31 days$/ })).toBeInTheDocument()
        expect(breakdownRows()).toEqual(['Groceries€50.0087%new', 'Coffee€7.7013%+54 %'])
      })

      it('shows the whole month again once closed, and opens empty the next time', async () => {
        const user = userEvent.setup()
        render(page())
        showBothMonths()
        await user.click(searchButton())
        await user.type(field(), 'latte')
        await user.click(kind('Expenses'))
        await user.click(searchButton())
        expect(searchButton()).toHaveAttribute('aria-expanded', 'false')
        expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
        expect(entries()).toEqual(OCTOBER_ENTRIES)

        await user.click(searchButton())
        expect(field()).toHaveValue('')
        expect(kind('All')).toHaveAttribute('aria-checked', 'true')
      })

      it('starts over when the month changes, also on coming back to the month searched', async () => {
        const user = userEvent.setup()
        render(page())
        showBothMonths()
        await user.click(searchButton())
        await user.type(field(), 'latte')
        await user.click(kind('Expenses'))
        await user.click(screen.getByRole('button', { name: 'Previous month' }))
        expect(searchButton()).toHaveAttribute('aria-expanded', 'false')
        expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
        deliver(SEPTEMBER, { month: '2026-09' })
        expect(entries()).toEqual(['Coffeebeans€10.00', 'Coffeecortado€5.00', 'Gymmonthly pass€40.00', 'Salary+€3,000.00'])

        await user.click(screen.getByRole('button', { name: 'Next month' }))
        deliver(OCTOBER)
        expect(entries()).toEqual(OCTOBER_ENTRIES)
        await user.click(searchButton())
        expect(field()).toHaveValue('')
        expect(kind('All')).toHaveAttribute('aria-checked', 'true')
      })

      it('starts over when the URL changes the month too (the Home tab)', async () => {
        const user = userEvent.setup()
        render(page('/?month=2026-09'))
        deliver(SEPTEMBER, { month: '2026-09' })
        await user.click(searchButton())
        await user.type(field(), 'beans')
        expect(entries()).toEqual(['Coffeebeans€10.00'])
        await user.click(screen.getByRole('link', { name: 'Home tab' }))
        deliver(OCTOBER)
        expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
        expect(entries()).toEqual(OCTOBER_ENTRIES)
      })

      it('has nothing to search before the currency is known, while the month loads or when it has no entries', async () => {
        const user = userEvent.setup()
        useSettings.mockReturnValue({ settings: null, loading: true, fromCache: true, error: null })
        const { rerender } = render(page())
        deliver(OCTOBER)
        expect(searchButton()).toBeDisabled() // no list yet: Home waits for the currency
        withSettingsLoaded()
        rerender(page())
        expect(searchButton()).toBeEnabled()

        await user.click(screen.getByRole('button', { name: 'Next month' }))
        expect(searchButton()).toBeDisabled()
        deliver([], { month: '2026-11' })
        expect(screen.getByText('Nothing in November 2026')).toBeInTheDocument()
        expect(searchButton()).toBeDisabled()
      })
    })
  })
})
