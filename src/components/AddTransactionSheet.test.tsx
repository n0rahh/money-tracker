import { FirebaseError } from 'firebase/app'
import { Timestamp } from 'firebase/firestore'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
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
/** Made by a recurring template and already known to the server: Undo must hand back every field, these included. */
const RENT: Transaction = {
  ...FLAT_WHITE,
  id: 'rec_r1_2026-10',
  amount: 120_000,
  note: 'rent',
  recurringId: 'r1',
  createdAt: Timestamp.fromDate(new Date(2026, 9, 1, 0, 0, 5)),
  updatedAt: Timestamp.fromDate(new Date(2026, 9, 2, 8, 30)),
}
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

const {
  createTransaction, updateTransaction, deleteTransaction, restoreTransaction, createRecurringWithFirstInstance, useCategories, useSettings, useTransactions,
} = vi.hoisted(() => ({
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  restoreTransaction: vi.fn(),
  createRecurringWithFirstInstance: vi.fn(),
  useCategories: vi.fn(),
  useSettings: vi.fn(),
  useTransactions: vi.fn(),
}))
vi.mock('../lib/firestore', () => ({ createTransaction, updateTransaction, deleteTransaction, restoreTransaction, createRecurringWithFirstInstance }))
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
  restoreTransaction.mockReturnValue(new Promise<void>(() => {}))
  createRecurringWithFirstInstance.mockReturnValue({ id: 'r-new', done: new Promise<void>(() => {}) })
})

afterEach(() => {
  vi.restoreAllMocks() // the window.confirm spy
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

  it('deletes at once, without asking and without waiting for the server, and offers Undo', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByText('open-edit'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(confirm).not.toHaveBeenCalled()
    expect(deleteTransaction).toHaveBeenCalledWith('t9')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const toast = screen.getByRole('status')
    expect(toast).toHaveTextContent('Deleted')
    expect(within(toast).getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    expect(restoreTransaction).not.toHaveBeenCalled()
  })

  it('Undo writes the deleted entry back as it was, once, without waiting for the server', async () => {
    const user = userEvent.setup()
    render(app(RENT))
    await user.click(screen.getByText('open-edit'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(restoreTransaction).toHaveBeenCalledTimes(1)
    expect(restoreTransaction).toHaveBeenCalledWith(RENT)
    // The toast goes with the tap, so there is no second Undo, and the sheet stays closed.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(deleteTransaction).toHaveBeenCalledTimes(1)
  })

  it('explains a failed Undo', async () => {
    restoreTransaction.mockImplementation(() => Promise.reject(new FirebaseError('permission-denied', 'Missing or insufficient permissions.')))
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByText('open-edit'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText("Could not undo: You don't have access to this data (signed in with the wrong account?)")).toBeInTheDocument()
  })

  it('Undo brings back the entry as it was stored, not the edits made before Delete', async () => {
    const user = userEvent.setup()
    render(app(RENT))
    await user.click(screen.getByText('open-edit'))
    await user.type(screen.getByLabelText('Note'), ' and bills')
    await user.click(screen.getByRole('button', { name: '5' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(restoreTransaction).toHaveBeenCalledTimes(1)
    expect(restoreTransaction).toHaveBeenCalledWith(RENT)
  })

  it('opening the form takes a pending Undo toast away, so it cannot cover the keypad', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByText('open-edit'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    await user.click(screen.getByText('open-add'))
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(restoreTransaction).not.toHaveBeenCalled()
  })

  it('still reports a failure that arrives while the form is open, and keeps it up as the form is used', async () => {
    let failDelete: (e: Error) => void = () => {}
    deleteTransaction.mockImplementation(() => new Promise<void>((_, reject) => { failDelete = reject }))
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByText('open-edit'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByText('open-add'))
    await act(async () => failDelete(new FirebaseError('permission-denied', 'Missing or insufficient permissions.')))
    const denied = "Could not delete: You don't have access to this data (signed in with the wrong account?)"
    expect(screen.getByRole('status')).toHaveTextContent(denied)
    await user.click(screen.getByRole('button', { name: '5' }))
    expect(screen.getByRole('status')).toHaveTextContent(denied)
  })

  describe('a failed Undo', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('stays on screen as long as the Undo did, 6 s', async () => {
      restoreTransaction.mockImplementation(() => Promise.reject(new Error('offline')))
      setup()
      fireEvent.click(screen.getByText('open-edit'))
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      await act(async () => {}) // the rejected restore reports from a microtask
      expect(screen.getByRole('status')).toHaveTextContent('Could not undo: offline')
      act(() => vi.advanceTimersByTime(5999))
      expect(screen.getByRole('status')).toHaveTextContent('Could not undo: offline')
      act(() => vi.advanceTimersByTime(1))
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
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

  it('explains a failed delete the user can act on, such as a wrong account', async () => {
    deleteTransaction.mockImplementation(() => Promise.reject(new FirebaseError('permission-denied', 'Missing or insufficient permissions.')))
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByText('open-edit'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText("Could not delete: You don't have access to this data (signed in with the wrong account?)")).toBeInTheDocument()
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

  describe('Repeat every month', () => {
    beforeEach(() => {
      // Only the clock: Saturday 17 Oct 2026, midday.
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(2026, 9, 17, 12, 0))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    const repeat = () => screen.queryByRole('switch')

    it('is offered to a new entry, off, on the day of the chosen date', async () => {
      const user = userEvent.setup()
      setup()
      await user.click(screen.getByText('open-add'))
      const toggle = screen.getByRole('switch', { name: 'Repeat every month on day 17' })
      expect(toggle).toHaveAttribute('aria-checked', 'false')
      expect(toggle).toHaveClass('min-h-11') // the whole 44 px row is the target
      await user.click(screen.getByRole('button', { name: 'Yesterday' }))
      expect(screen.getByRole('switch', { name: 'Repeat every month on day 16' })).toHaveAttribute('aria-checked', 'false')
      await user.click(screen.getByRole('switch'))
      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    })

    it("saves a template from the entry with its first entry, the template's own for that month, in one write, without waiting", async () => {
      const user = userEvent.setup()
      setup()
      await user.click(screen.getByText('open-add'))
      await user.click(screen.getByRole('radio', { name: 'Income' }))
      for (const key of ['5', '0', '0', '0']) await user.click(screen.getByRole('button', { name: key }))
      await user.click(screen.getByRole('button', { name: 'Salary' }))
      await user.type(screen.getByLabelText('Note'), '  pay  ')
      await user.click(screen.getByRole('switch', { name: 'Repeat every month on day 17' }))
      await user.click(screen.getByRole('button', { name: 'Add €5,000.00 · Salary' }))

      expect(createRecurringWithFirstInstance).toHaveBeenCalledTimes(1)
      expect(createRecurringWithFirstInstance).toHaveBeenCalledWith({
        kind: 'income', amount: 500_000, categoryId: 'c2', note: 'pay', dayOfMonth: 17, startMonth: '2026-10', endMonth: null,
      })
      expect(createTransaction).not.toHaveBeenCalled() // the first entry is the template's own, under its fixed id
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument() // closed although `done` never settles
    })

    it('starts in the month of a back-dated entry, on its day', async () => {
      const user = userEvent.setup()
      setup()
      await user.click(screen.getByText('open-add'))
      await user.click(screen.getByRole('button', { name: '9' }))
      await user.click(screen.getByRole('button', { name: 'Coffee' }))
      fireEvent.change(screen.getByLabelText('Pick a date'), { target: { value: '2026-09-30' } })
      await user.click(screen.getByRole('switch', { name: 'Repeat every month on day 30' }))
      await user.click(screen.getByRole('button', { name: 'Add €9.00 · Coffee' }))
      expect(createRecurringWithFirstInstance).toHaveBeenCalledExactlyOnceWith({
        kind: 'expense', amount: 900, categoryId: 'c1', note: '', dayOfMonth: 30, startMonth: '2026-09', endMonth: null,
      })
    })

    it('adds an ordinary entry when left off, or turned off again', async () => {
      const user = userEvent.setup()
      setup()
      await user.click(screen.getByText('open-add'))
      await user.click(screen.getByRole('button', { name: '5' }))
      await user.click(screen.getByRole('button', { name: 'Coffee' }))
      await user.click(screen.getByRole('switch'))
      await user.click(screen.getByRole('switch'))
      await user.click(screen.getByRole('button', { name: 'Add €5.00 · Coffee' }))
      expect(createTransaction).toHaveBeenCalledWith({ kind: 'expense', amount: 500, categoryId: 'c1', note: '', date: '2026-10-17' })
      expect(createRecurringWithFirstInstance).not.toHaveBeenCalled()
    })

    it('starts off again on the next open, and the kind is remembered as for any entry', async () => {
      const user = userEvent.setup()
      setup()
      await user.click(screen.getByText('open-add'))
      await user.click(screen.getByRole('radio', { name: 'Income' }))
      await user.click(screen.getByRole('button', { name: '5' }))
      await user.click(screen.getByRole('button', { name: 'Salary' }))
      await user.click(screen.getByRole('switch'))
      await user.click(screen.getByRole('button', { name: 'Add €5.00 · Salary' }))
      await user.click(screen.getByText('open-add'))
      expect(screen.getByRole('radio', { name: 'Income' })).toBeChecked()
      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    })

    it('is not offered when editing: an entry made from a template is edited like any other', async () => {
      const user = userEvent.setup()
      render(app(RENT))
      await user.click(screen.getByText('open-edit'))
      expect(screen.getByRole('heading', { name: 'Edit' })).toBeInTheDocument()
      expect(repeat()).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /save €1,200\.00 · coffee/i }))
      expect(updateTransaction).toHaveBeenCalledWith('rec_r1_2026-10', expect.objectContaining({ amount: 120_000, note: 'rent' }))
      expect(createRecurringWithFirstInstance).not.toHaveBeenCalled()
    })

    it('reports a refused template (and so its first entry) in a toast after the sheet has closed', async () => {
      // Built on call, so the rejection gets its handler in the tick it is created.
      createRecurringWithFirstInstance.mockImplementation(() => ({
        id: 'r-new',
        done: Promise.reject(new FirebaseError('permission-denied', 'Missing or insufficient permissions.')),
      }))
      const user = userEvent.setup()
      setup()
      await user.click(screen.getByText('open-add'))
      await user.click(screen.getByRole('button', { name: '5' }))
      await user.click(screen.getByRole('button', { name: 'Coffee' }))
      await user.click(screen.getByRole('switch'))
      await user.click(screen.getByRole('button', { name: 'Add €5.00 · Coffee' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(await screen.findByRole('status')).toHaveTextContent("Could not save: You don't have access to this data (signed in with the wrong account?)")
    })
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
