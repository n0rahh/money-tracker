import { Timestamp } from 'firebase/firestore'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AddSheetProvider, useAddSheet } from '../context/AddSheetContext'
import { ToastProvider } from '../context/ToastContext'
import { todayIso } from '../lib/dates'
import type { Category, Transaction } from '../lib/types'
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

const { createTransaction, updateTransaction, deleteTransaction, useCategories, useSettings } = vi.hoisted(() => ({
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  useCategories: vi.fn(),
  useSettings: vi.fn(),
}))
vi.mock('../lib/firestore', () => ({ createTransaction, updateTransaction, deleteTransaction }))
vi.mock('../hooks/useCategories', () => ({ useCategories }))
vi.mock('../hooks/useSettings', () => ({ useSettings }))
vi.mock('../hooks/useTransactions', () => ({
  useTransactions: () => ({ transactions: [], loading: false, error: null }),
}))

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
const withCategories = (categories: Category[]) =>
  useCategories.mockReturnValue({ categories, byId: new Map(categories.map((c) => [c.id, c])), loading: false, error: null })
const categoryChips = () => within(screen.getByRole('group', { name: 'Category' })).getAllByRole('button')

beforeEach(() => {
  vi.clearAllMocks()
  withCategories(CATS)
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
})
