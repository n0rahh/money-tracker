import { Timestamp } from 'firebase/firestore'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AddSheetProvider, useAddSheet } from '../context/AddSheetContext'
import { ToastProvider } from '../context/ToastContext'
import { parseIsoDate, todayIso } from '../lib/dates'
import type { Category, IsoDate, Transaction } from '../lib/types'
import { AddTransactionSheet } from './AddTransactionSheet'

const CATS: Category[] = [
  { id: 'c1', name: 'Coffee', icon: 'Coffee', color: 'amber', kind: 'expense', order: 0, archived: false },
  { id: 'c2', name: 'Salary', icon: 'Banknote', color: 'emerald', kind: 'income', order: 0, archived: false },
]
const FLAT_WHITE: Transaction = { id: 't9', kind: 'expense', amount: 350, categoryId: 'c1', note: 'flat white', date: '2026-10-01', at: Timestamp.fromDate(new Date(2026, 9, 1, 12)), source: 'app' }
const YEN_COFFEE: Transaction = { ...FLAT_WHITE, id: 't10', amount: 1200, note: '' }
const LUNCH: Category = { id: 'c3', name: 'Lunch', icon: 'Utensils', color: 'orange', kind: 'expense', order: 1, archived: false }
/** Coffee was archived after the flat white was logged; Lunch is still active. */
const COFFEE_ARCHIVED: Category[] = [{ ...CATS[0], archived: true }, LUNCH, CATS[1]]
const WITH_LUNCH: Category[] = [CATS[0], LUNCH, CATS[1]]

type Combo = Pick<Transaction, 'kind' | 'categoryId' | 'amount' | 'note'>
/** One row of the combo per date, each logged at local noon. */
const logged = (combo: Combo, dates: IsoDate[]): Transaction[] =>
  dates.map((date, i) => ({ ...combo, id: `${combo.categoryId}-${combo.amount}-${i}`, date, at: Timestamp.fromDate(parseIsoDate(date)), source: 'app' }))
const PLAIN_COFFEE: Combo = { kind: 'expense', categoryId: 'c1', amount: 350, note: '' }
const OAT_LATTE: Combo = { kind: 'expense', categoryId: 'c1', amount: 420, note: 'oat latte' }
const PAYDAY: Combo = { kind: 'income', categoryId: 'c2', amount: 500_000, note: '' }
const CANTEEN: Combo = { kind: 'expense', categoryId: 'c3', amount: 1200, note: 'canteen' }
const SANDWICH: Combo = { kind: 'expense', categoryId: 'c3', amount: 990, note: '' }
/** The last 60 days as seen on Sat 17 Oct 2026: five combos used 4, 3, 2, 1 and 1 times; the most recent row is yesterday's canteen lunch. */
const RECENT = [
  ...logged(PLAIN_COFFEE, ['2026-10-12', '2026-10-08', '2026-10-05', '2026-10-01']),
  ...logged(OAT_LATTE, ['2026-10-15', '2026-10-13', '2026-10-02']),
  ...logged(PAYDAY, ['2026-10-01', '2026-09-01']),
  ...logged(CANTEEN, ['2026-10-16']),
  ...logged(SANDWICH, ['2026-09-20']), // as frequent as the canteen lunch but older: fifth, so left out
]

const { createTransaction, updateTransaction, deleteTransaction, useCategories, useSettings, useTransactions } = vi.hoisted(() => ({
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  useCategories: vi.fn(),
  useSettings: vi.fn(),
  useTransactions: vi.fn(),
}))
vi.mock('../lib/firestore', () => ({ createTransaction, updateTransaction, deleteTransaction }))
vi.mock('../hooks/useCategories', () => ({ useCategories }))
vi.mock('../hooks/useSettings', () => ({ useSettings }))
vi.mock('../hooks/useTransactions', () => ({ useTransactions }))

function Harness({ edit = FLAT_WHITE }: { edit?: Transaction }) {
  const { state, openAdd, openEdit } = useAddSheet()
  return (
    <>
      {!state.open ? <button onClick={openAdd}>open-add</button> : null}
      {!state.open ? <button onClick={() => openEdit(edit)}>open-edit</button> : null}
      <AddTransactionSheet />
    </>
  )
}

const app = (edit?: Transaction) => <ToastProvider><AddSheetProvider><Harness edit={edit} /></AddSheetProvider></ToastProvider>
const setup = () => render(app())
const withCategories = (categories: Category[], loading = false) =>
  useCategories.mockReturnValue({ categories, byId: new Map(categories.map((c) => [c.id, c])), loading, error: null })
const withRows = (transactions: Transaction[]) => useTransactions.mockReturnValue({ transactions, loading: false, pending: false, error: null })
const categoryChips = () => within(screen.getByRole('group', { name: 'Category' })).getAllByRole('button')
const quickAdd = () => screen.queryByRole('group', { name: 'Quick add' })
/** The text of each quick-add chip, in screen order. */
const quickAddChips = () => within(screen.getByRole('group', { name: 'Quick add' })).getAllByRole('button').map((chip) => chip.textContent)

beforeEach(() => {
  vi.clearAllMocks()
  withCategories(CATS)
  withRows([])
  useSettings.mockReturnValue({ settings: { currency: 'EUR', locale: 'en' }, loading: false, fromCache: false, error: null })
  createTransaction.mockReturnValue({ id: 'new', done: new Promise<void>(() => {}) }) // never resolves: offline
  updateTransaction.mockReturnValue(new Promise<void>(() => {}))
  deleteTransaction.mockReturnValue(new Promise<void>(() => {}))
})

afterEach(() => {
  vi.restoreAllMocks() // the window.confirm spies
})

describe('AddTransactionSheet', () => {
  it('adds an expense without waiting for the server', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByText('open-add'))
    expect(screen.getByRole('button', { name: /enter amount/i })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '1' }))
    await user.click(screen.getByRole('button', { name: '2' }))
    await user.click(screen.getByRole('button', { name: 'Coffee' }))
    const save = screen.getByRole('button', { name: /add €12\.00 · coffee/i })
    expect(save).toBeEnabled()
    await user.click(save)
    expect(createTransaction).toHaveBeenCalledWith({ kind: 'expense', amount: 1200, categoryId: 'c1', note: '', date: todayIso() })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps Save disabled when the expression evaluates to zero', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByText('open-add'))
    await user.click(screen.getByRole('button', { name: 'Coffee' }))
    for (const key of ['5', 'Minus', '9']) await user.click(screen.getByRole('button', { name: key }))
    expect(screen.getByRole('button', { name: /enter amount/i })).toBeDisabled()
    expect(createTransaction).not.toHaveBeenCalled()
  })

  it('hides expense categories when switching to income', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByText('open-add'))
    await user.click(screen.getByRole('radio', { name: 'Income' }))
    expect(screen.queryByRole('button', { name: 'Coffee' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salary' })).toBeInTheDocument()
  })

  it('prefills and updates an existing transaction', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByText('open-edit'))
    expect(screen.getByTestId('amount-expr')).toHaveTextContent('3.5')
    expect(screen.getByLabelText('Note')).toHaveValue('flat white')
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    for (const key of ['3', '5']) await user.click(screen.getByRole('button', { name: key }))
    await user.click(screen.getByRole('button', { name: /save €35\.00 · coffee/i }))
    expect(updateTransaction).toHaveBeenCalledWith('t9', expect.objectContaining({ amount: 3500, categoryId: 'c1', note: 'flat white', date: '2026-10-01' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('remembers the last kind within the session', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByText('open-add'))
    await user.click(screen.getByRole('radio', { name: 'Income' }))
    await user.click(screen.getByRole('button', { name: '5' }))
    await user.click(screen.getByRole('button', { name: 'Salary' }))
    await user.click(screen.getByRole('button', { name: /add €5\.00 · salary/i }))
    await user.click(screen.getByText('open-add'))
    expect(screen.getByRole('radio', { name: 'Income' })).toBeChecked()
  })

  it("a session's first Add opens on Expense", async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByText('open-add'))
    expect(screen.getByRole('radio', { name: 'Expense' })).toBeChecked()
  })

  it('clears a category of the other kind when switching', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByText('open-add'))
    await user.click(screen.getByRole('button', { name: 'Coffee' }))
    await user.click(screen.getByRole('button', { name: '1' }))
    await user.click(screen.getByRole('radio', { name: 'Income' }))
    expect(screen.getByRole('button', { name: /enter amount/i })).toBeDisabled()
    // Back on Expense, Coffee stays cleared: the selection was dropped, not just hidden.
    await user.click(screen.getByRole('radio', { name: 'Expense' }))
    expect(screen.getByRole('button', { name: /enter amount/i })).toBeDisabled()
  })

  it('keeps the stored `at` when the date is unchanged and drops it when it changes', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByText('open-edit'))
    await user.click(screen.getByRole('button', { name: /save €3\.50 · coffee/i }))
    expect(updateTransaction).toHaveBeenNthCalledWith(1, 't9', expect.objectContaining({ date: '2026-10-01', at: new Date(2026, 9, 1, 12) }))
    await user.click(screen.getByText('open-edit'))
    await user.click(screen.getByRole('button', { name: 'Today' }))
    await user.click(screen.getByRole('button', { name: /save €3\.50 · coffee/i }))
    expect(updateTransaction).toHaveBeenNthCalledWith(2, 't9', expect.objectContaining({ date: todayIso(), at: undefined }))
  })

  it('trims the note', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByText('open-add'))
    await user.click(screen.getByRole('button', { name: '5' }))
    await user.click(screen.getByRole('button', { name: 'Coffee' }))
    await user.type(screen.getByLabelText('Note'), '  latte  ')
    await user.click(screen.getByRole('button', { name: /add €5\.00 · coffee/i }))
    expect(createTransaction).toHaveBeenCalledWith(expect.objectContaining({ note: 'latte' }))
  })

  it('waits for settings before seeding an edit', async () => {
    useSettings.mockReturnValue({ settings: null, loading: true, fromCache: true, error: null })
    const user = userEvent.setup()
    const { rerender } = render(app(YEN_COFFEE))
    await user.click(screen.getByText('open-edit'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    useSettings.mockReturnValue({ settings: { currency: 'JPY', locale: 'en' }, loading: false, fromCache: false, error: null })
    rerender(app(YEN_COFFEE))
    expect(screen.getByTestId('amount-expr')).toHaveTextContent('1200')
    expect(screen.getByRole('button', { name: /save ¥1,200 · coffee/i })).toBeInTheDocument()
  })

  it('keeps the transaction when the delete is not confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByText('open-edit'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(window.confirm).toHaveBeenCalledWith('Delete this transaction?')
    expect(deleteTransaction).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('deletes after confirmation without waiting for the server', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByText('open-edit'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(deleteTransaction).toHaveBeenCalledWith('t9')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('reports a failed save in a toast after the sheet has closed', async () => {
    // Built on call, so the rejection gets its handler in the tick it is created.
    createTransaction.mockImplementation(() => ({ id: 'new', done: Promise.reject(new Error('denied')) }))
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByText('open-add'))
    await user.click(screen.getByRole('button', { name: '5' }))
    await user.click(screen.getByRole('button', { name: 'Coffee' }))
    await user.click(screen.getByRole('button', { name: /add €5\.00 · coffee/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByText(/could not save: denied/i)).toBeInTheDocument()
  })

  it("keeps an edit's archived category: offered first, marked and selected", async () => {
    withCategories(COFFEE_ARCHIVED)
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByText('open-edit'))
    const chip = screen.getByRole('button', { name: 'Coffee (archived)' })
    expect(categoryChips()[0]).toBe(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    const save = screen.getByRole('button', { name: /save €3\.50 · coffee/i })
    expect(save).toBeEnabled()
    await user.click(save)
    expect(updateTransaction).toHaveBeenCalledWith('t9', expect.objectContaining({ categoryId: 'c1' }))
  })

  it('never offers an archived category to a new entry', async () => {
    withCategories(COFFEE_ARCHIVED)
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByText('open-add'))
    expect(categoryChips().map((chip) => chip.textContent)).toEqual(['Lunch'])
  })

  it('asks for a category again when the edited one no longer exists', async () => {
    const user = userEvent.setup()
    render(app({ ...FLAT_WHITE, categoryId: 'removed-in-console' }))
    await user.click(screen.getByText('open-edit'))
    expect(categoryChips().filter((chip) => chip.getAttribute('aria-pressed') === 'true')).toEqual([])
    expect(screen.getByRole('button', { name: /enter amount/i })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Coffee' }))
    await user.click(screen.getByRole('button', { name: /save €3\.50 · coffee/i }))
    expect(updateTransaction).toHaveBeenCalledWith('t9', expect.objectContaining({ categoryId: 'c1' }))
  })

  describe('Quick add', () => {
    beforeEach(() => {
      // Only the clock (as in HomePage.test.tsx): Saturday 17 Oct 2026, midday.
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(2026, 9, 17, 12, 0))
      withCategories(WITH_LUNCH)
      withRows(RECENT)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('offers the four most frequent combos, most frequent first', async () => {
      const user = userEvent.setup()
      setup()
      await user.click(screen.getByText('open-add'))
      expect(quickAddChips()).toEqual(['Coffee · €3.50', 'Coffee · €4.20 · oat latte', 'Salary · €5,000.00', 'Lunch · €12.00 · canteen'])
    })

    it('fills the amount and the category from a tapped chip, ready to save, and steps aside', async () => {
      const user = userEvent.setup()
      setup()
      await user.click(screen.getByText('open-add'))
      await user.click(screen.getByRole('button', { name: 'Coffee · €3.50' }))
      expect(screen.getByTestId('amount-expr')).toHaveTextContent(/^3\.5$/)
      expect(within(screen.getByRole('group', { name: 'Category' })).getByRole('button', { name: 'Coffee' })).toHaveAttribute('aria-pressed', 'true')
      expect(quickAdd()).not.toBeInTheDocument()
      const save = screen.getByRole('button', { name: 'Add €3.50 · Coffee' })
      expect(save).toBeEnabled()
      await user.click(save)
      expect(createTransaction).toHaveBeenCalledWith({ kind: 'expense', amount: 350, categoryId: 'c1', note: '', date: '2026-10-17' })
    })

    it('shows on open and goes from the first digit, so both rows of categories stay in view', async () => {
      const user = userEvent.setup()
      setup()
      await user.click(screen.getByText('open-add'))
      expect(quickAdd()).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: '1' }))
      expect(quickAdd()).not.toBeInTheDocument()
      // Back with nothing typed and no category picked.
      await user.click(screen.getByRole('button', { name: 'Clear' }))
      expect(quickAdd()).toBeInTheDocument()
    })

    it('goes once a category is picked', async () => {
      const user = userEvent.setup()
      setup()
      await user.click(screen.getByText('open-add'))
      await user.click(within(screen.getByRole('group', { name: 'Category' })).getByRole('button', { name: 'Lunch' }))
      expect(quickAdd()).not.toBeInTheDocument()
      expect(screen.getByTestId('amount-expr')).toHaveTextContent(/^0$/) // the amount is still to be typed
    })

    it("takes the chip's kind and replaces a note typed before it", async () => {
      const user = userEvent.setup()
      setup()
      await user.click(screen.getByText('open-add'))
      await user.click(screen.getByRole('radio', { name: 'Income' }))
      await user.type(screen.getByLabelText('Note'), 'draft') // a note leaves the row in place
      await user.click(screen.getByRole('button', { name: 'Coffee · €4.20 · oat latte' }))
      expect(screen.getByRole('radio', { name: 'Expense' })).toBeChecked()
      expect(screen.getByTestId('amount-expr')).toHaveTextContent(/^4\.2$/)
      expect(screen.getByLabelText('Note')).toHaveValue('oat latte')
      expect(screen.getByRole('button', { name: 'Add €4.20 · Coffee' })).toBeEnabled()
    })

    it('clears a typed note for a chip without one, and an income chip switches to Income', async () => {
      const user = userEvent.setup()
      setup()
      await user.click(screen.getByText('open-add'))
      await user.type(screen.getByLabelText('Note'), 'draft')
      await user.click(screen.getByRole('button', { name: 'Salary · €5,000.00' }))
      expect(screen.getByRole('radio', { name: 'Income' })).toBeChecked()
      expect(screen.getByTestId('amount-expr')).toHaveTextContent(/^5000$/)
      expect(screen.getByLabelText('Note')).toHaveValue('')
      expect(screen.getByRole('button', { name: 'Add €5,000.00 · Salary' })).toBeEnabled()
    })

    it('is not offered when editing', async () => {
      const user = userEvent.setup()
      setup()
      await user.click(screen.getByText('open-add'))
      expect(quickAdd()).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Close' }))
      await user.click(screen.getByText('open-edit'))
      expect(screen.getByRole('heading', { name: 'Edit' })).toBeInTheDocument()
      expect(quickAdd()).not.toBeInTheDocument()
    })

    it('does not offer a combo already used today', async () => {
      const espresso: Combo = { kind: 'expense', categoryId: 'c1', amount: 250, note: 'espresso' }
      withRows([...logged(espresso, ['2026-10-17', '2026-10-11']), ...logged(PLAIN_COFFEE, ['2026-10-12'])])
      const user = userEvent.setup()
      setup()
      await user.click(screen.getByText('open-add'))
      // The espresso is the more frequent combo, but one was logged today.
      expect(quickAddChips()).toEqual(['Coffee · €3.50'])
    })

    it('offers combos of active categories only, once the categories are known', async () => {
      withCategories([], true)
      const user = userEvent.setup()
      const { rerender } = setup()
      await user.click(screen.getByText('open-add'))
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(quickAdd()).not.toBeInTheDocument()
      // Coffee turns out to be archived: its two combos give way to the next ones.
      withCategories(COFFEE_ARCHIVED)
      rerender(app())
      expect(quickAddChips()).toEqual(['Salary · €5,000.00', 'Lunch · €12.00 · canteen', 'Lunch · €9.90'])
    })

    it('never offers a combo whose category was removed, nor lets it take a slot', async () => {
      // Used five times, more than any other combo, but its category was deleted by hand in the console.
      const gone: Combo = { kind: 'expense', categoryId: 'removed-in-console', amount: 700, note: 'gym' }
      withRows([...RECENT, ...logged(gone, ['2026-10-14', '2026-10-11', '2026-10-09', '2026-10-07', '2026-10-03'])])
      const user = userEvent.setup()
      setup()
      await user.click(screen.getByText('open-add'))
      expect(quickAddChips()).toEqual(['Coffee · €3.50', 'Coffee · €4.20 · oat latte', 'Salary · €5,000.00', 'Lunch · €12.00 · canteen'])
    })

    it('reads the 60 days up to the day it opened, which also order the categories', async () => {
      vi.setSystemTime(new Date(2026, 9, 17, 23, 59))
      const user = userEvent.setup()
      setup()
      await user.click(screen.getByText('open-add'))
      expect(useTransactions).toHaveBeenLastCalledWith('2026-08-18', '2026-10-17')
      // Yesterday's canteen lunch is the latest expense, so Lunch leads although Coffee comes first by `order`.
      expect(categoryChips().map((chip) => chip.textContent)).toEqual(['Lunch', 'Coffee'])
      // Still open after midnight: the window stays put, so nothing resubscribes.
      vi.setSystemTime(new Date(2026, 9, 18, 0, 1))
      await user.click(screen.getByRole('button', { name: '5' }))
      expect(new Set(useTransactions.mock.calls.map(([from, to]) => `${from} to ${to}`))).toEqual(new Set(['2026-08-18 to 2026-10-17']))
    })
  })
})
