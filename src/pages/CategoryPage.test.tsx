import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FirebaseError } from 'firebase/app'
import { Timestamp } from 'firebase/firestore'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Category, IsoDate, Transaction } from '../lib/types'
import { CategoryPage } from './CategoryPage'

const COFFEE: Category = { id: 'c1', name: 'Coffee', icon: 'Coffee', color: 'amber', kind: 'expense', order: 0, archived: false }
const GROCERIES: Category = { id: 'c2', name: 'Groceries', icon: 'ShoppingCart', color: 'emerald', kind: 'expense', order: 1, archived: false }
/** Archived after its entries were logged: its page still shows them (plan Review Focus 5). */
const GYM: Category = { id: 'c3', name: 'Gym', icon: 'Dumbbell', color: 'sky', kind: 'expense', order: 2, archived: true }
const CATEGORIES = [COFFEE, GROCERIES, GYM]

const entry = (id: string, categoryId: string, date: IsoDate, amount: number, note: string): Transaction => {
  const [y, m, d] = date.split('-').map(Number)
  return { id, kind: 'expense', amount, categoryId, note, date, at: Timestamp.fromDate(new Date(y, m - 1, d, 9)), source: 'app' }
}
// The twelve months run from Nov 2025 to Oct 2026 (the clock is set to 17 Oct 2026 below); the query returns every category.
const FLAT_WHITE = entry('t1', COFFEE.id, '2026-10-17', 350, 'flat white')
const OCT_SHOP = entry('t2', GROCERIES.id, '2026-10-17', 5000, 'weekly shop') // same day as the flat white
const OAT_LATTE = entry('t3', COFFEE.id, '2026-10-16', 420, 'oat latte')
const GYM_PASS = entry('t4', GYM.id, '2026-10-01', 4000, 'monthly pass')
const BEANS = entry('t5', COFFEE.id, '2026-09-20', 1200, 'beans')
const SEP_SHOP = entry('t6', GROCERIES.id, '2026-09-20', 6400, 'weekly shop')
const CORTADO = entry('t7', COFFEE.id, '2025-11-05', 280, 'cortado') // the oldest month of the twelve
const ROWS = [FLAT_WHITE, OCT_SHOP, OAT_LATTE, GYM_PASS, BEANS, SEP_SHOP, CORTADO]

const { useCategories, useSettings, useTransactions, openEdit } = vi.hoisted(() => ({
  useCategories: vi.fn(),
  useSettings: vi.fn(),
  useTransactions: vi.fn(),
  openEdit: vi.fn(),
}))
vi.mock('../hooks/useCategories', () => ({ useCategories }))
vi.mock('../hooks/useSettings', () => ({ useSettings }))
vi.mock('../hooks/useTransactions', () => ({ useTransactions }))
vi.mock('../context/AddSheetContext', () => ({
  useAddSheet: () => ({ state: { open: false, editing: null }, openAdd: vi.fn(), openEdit, close: vi.fn(), lastKind: 'expense', rememberKind: vi.fn() }),
}))

const withCategories = (categories: Category[], loading = false) =>
  useCategories.mockReturnValue({ categories, byId: new Map(categories.map((c) => [c.id, c])), loading, error: null })
const withSettingsLoaded = () => useSettings.mockReturnValue({ settings: { currency: 'EUR', locale: 'en' }, loading: false, fromCache: false, error: null })
const withRows = (transactions: Transaction[], state: { loading?: boolean; error?: Error } = {}) =>
  useTransactions.mockReturnValue({ transactions, loading: state.loading ?? false, pending: false, error: state.error ?? null })

/** One path is a cold deep link (the first history entry); a list is the history that led to its last path. */
const tree = (path: string | string[]) => (
  <MemoryRouter initialEntries={typeof path === 'string' ? [path] : path}>
    <Routes>
      <Route path="category/:id" element={<CategoryPage />} />
      <Route path="/" element={<p>Home stub</p>} />
      <Route path="trends" element={<p>Trends stub</p>} />
    </Routes>
  </MemoryRouter>
)
const page = (path: string | string[] = '/category/c1') => render(tree(path))

const chart = () => within(screen.getByRole('group', { name: 'Last 12 months' }))
/** The amount shown under a summary label. */
const valueOf = (label: string) => screen.getByText(label).nextElementSibling?.textContent
/** The month list in screen order: each day heading with the text of its rows (name, note and amount run together). */
const dayGroups = () => {
  const lists = screen.queryAllByRole('list')
  return screen.queryAllByRole('heading', { level: 3 }).map((h, i) => ({
    day: h.textContent,
    rows: within(lists[i]).getAllByRole('listitem').map((li) => li.textContent),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  // Only the clock (see HomePage.test.tsx): Saturday 17 Oct 2026, midday.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 17, 12, 0))
  withCategories(CATEGORIES)
  withSettingsLoaded()
  withRows(ROWS)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CategoryPage', () => {
  it('shows the category with its icon badge and one bar per month of the last twelve, with its own totals', () => {
    page()
    const header = screen.getByRole('heading', { level: 1, name: 'Coffee' }).closest('header')
    expect(header?.querySelector('svg.lucide-coffee')).not.toBeNull() // its own icon, not the fallback for a missing category
    expect(screen.getByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', '/')
    expect(useTransactions).toHaveBeenLastCalledWith('2025-11-01', '2026-10-31')
    expect(chart().getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Nov 25: €2.80',
      'Dec 25: €0.00',
      'Jan: €0.00',
      'Feb: €0.00',
      'Mar: €0.00',
      'Apr: €0.00',
      'May: €0.00',
      'Jun: €0.00',
      'Jul: €0.00',
      'Aug: €0.00',
      'Sep: €12.00',
      'Oct: €7.70',
    ])
  })

  it('averages the twelve monthly totals, empty months included, in whole minor units', () => {
    page()
    expect(valueOf('Average per month')).toBe('€1.88') // (280 + 1200 + 350 + 420) / 12 = 187.5 → 188
  })

  it("lists only this category's entries of the current month, grouped by day", () => {
    page()
    expect(chart().getByRole('button', { pressed: true })).toHaveAccessibleName('Oct: €7.70')
    expect(valueOf('October 2026')).toBe('€7.70')
    expect(dayGroups()).toEqual([
      { day: 'Today', rows: ['Coffeeflat white€3.50'] },
      { day: 'Yesterday', rows: ['Coffeeoat latte€4.20'] },
    ])
  })

  it('switches the list to the month of the tapped bar', async () => {
    const user = userEvent.setup()
    page()
    await user.click(chart().getByRole('button', { name: /^Sep:/ }))
    expect(chart().getByRole('button', { pressed: true })).toHaveAccessibleName('Sep: €12.00')
    expect(valueOf('September 2026')).toBe('€12.00')
    expect(dayGroups()).toEqual([{ day: 'Sun, Sep 20', rows: ['Coffeebeans€12.00'] }])

    await user.click(chart().getByRole('button', { name: /^Dec 25:/ }))
    expect(screen.getByText('Nothing in December 2025')).toBeInTheDocument()
    expect(dayGroups()).toEqual([])
    expect(valueOf('Average per month')).toBe('€1.88') // the average does not depend on the tapped month
  })

  it('starts on the month Home was showing; opened cold from a link, its Back link goes to Home on that month', () => {
    page('/category/c1?month=2026-09')
    expect(chart().getByRole('button', { pressed: true })).toHaveAccessibleName('Sep: €12.00')
    expect(valueOf('September 2026')).toBe('€12.00')
    expect(dayGroups()).toEqual([{ day: 'Sun, Sep 20', rows: ['Coffeebeans€12.00'] }])
    expect(screen.getByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', '/?month=2026-09')
  })

  it.each([
    { value: 'garbage', back: '/' },
    { value: '2026-13', back: '/' }, // not a month
    { value: '2025-10', back: '/?month=2025-10' }, // just before the twelve months: Home can still show it
    { value: '2026-11', back: '/?month=2026-11' }, // after them
  ])('starts on the current month for ?month=$value and goes back to $back', ({ value, back }) => {
    page(`/category/c1?month=${value}`)
    expect(chart().getByRole('button', { pressed: true })).toHaveAccessibleName('Oct: €7.70')
    expect(screen.getByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', back)
  })

  it('goes back through history to where it was opened from, such as Compare on Trends', async () => {
    const user = userEvent.setup()
    page(['/trends', '/category/c1?month=2026-09'])
    expect(screen.queryByRole('link', { name: 'Back to Home' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Trends stub')).toBeInTheDocument()
  })

  it('opens a tapped entry in the edit sheet', async () => {
    const user = userEvent.setup()
    page()
    await user.click(screen.getByRole('button', { name: /oat latte/ }))
    expect(openEdit.mock.calls).toEqual([[OAT_LATTE]])
  })

  it('shows "Category not found" and a link back to Home for an unknown id', async () => {
    const user = userEvent.setup()
    page('/category/removed-in-console')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Category not found$/)
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    const back = screen.getByRole('link', { name: 'Back to Home' })
    expect(back).toHaveAttribute('href', '/')
    await user.click(back)
    expect(screen.getByText('Home stub')).toBeInTheDocument()
  })

  it('still shows an archived category and its entries, with "(archived)" after its name', () => {
    page('/category/c3')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Gym \(archived\)$/)
    expect(chart().getByRole('button', { pressed: true })).toHaveAccessibleName('Oct: €40.00')
    expect(dayGroups()).toEqual([{ day: 'Thu, Oct 1', rows: ['Gymmonthly pass€40.00'] }])
  })

  it('shows a failed categories query as its error, not as "Category not found", with the way back', () => {
    useCategories.mockReturnValue({ categories: [], byId: new Map(), loading: false, error: new FirebaseError('unavailable', 'Failed to get documents from server.') })
    page('/category/c1?month=2026-09')
    expect(screen.getByText("You're offline and this data isn't cached yet")).toBeInTheDocument()
    expect(screen.queryByText('Category not found')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', '/?month=2026-09')
  })

  it('waits for the categories before deciding that the id is unknown', () => {
    withCategories([], true)
    page()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByText('Category not found')).not.toBeInTheDocument()
  })

  it('shows no amounts before the currency is known and no empty month before the rows arrive', () => {
    useSettings.mockReturnValue({ settings: null, loading: true, fromCache: true, error: null })
    const { rerender } = page()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Coffee')
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByRole('group')).not.toBeInTheDocument() // the bar labels carry amounts too
    expect(screen.queryByText(/[$€]/)).not.toBeInTheDocument()

    withSettingsLoaded()
    withRows([], { loading: true })
    rerender(tree('/category/c1'))
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByText(/^Nothing in/)).not.toBeInTheDocument()
    expect(screen.queryByText('Average per month')).not.toBeInTheDocument()
  })

  it('shows a failed query as its error, not as twelve empty months', () => {
    withRows([], { error: new FirebaseError('permission-denied', 'Missing or insufficient permissions.') })
    page()
    expect(screen.getByText("You don't have access to this data (signed in with the wrong account?)")).toBeInTheDocument()
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Nothing in/)).not.toBeInTheDocument()
  })
})
