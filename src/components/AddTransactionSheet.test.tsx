import { Timestamp } from 'firebase/firestore'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AddSheetProvider, useAddSheet } from '../context/AddSheetContext'
import { ToastProvider } from '../context/ToastContext'
import { todayIso } from '../lib/dates'
import type { Category } from '../lib/types'
import { AddTransactionSheet } from './AddTransactionSheet'

const CATS: Category[] = [
  { id: 'c1', name: 'Coffee', icon: 'Coffee', color: 'amber', kind: 'expense', order: 0, archived: false },
  { id: 'c2', name: 'Salary', icon: 'Banknote', color: 'emerald', kind: 'income', order: 0, archived: false },
]

const { createTransaction, updateTransaction, deleteTransaction } = vi.hoisted(() => ({
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
}))
vi.mock('../lib/firestore', () => ({ createTransaction, updateTransaction, deleteTransaction }))
vi.mock('../hooks/useCategories', () => ({
  useCategories: () => ({ categories: CATS, byId: new Map(CATS.map((c) => [c.id, c])), loading: false, error: null }),
}))
vi.mock('../hooks/useSettings', () => ({
  useSettings: () => ({ settings: { currency: 'EUR', locale: 'en' }, loading: false, fromCache: false, error: null }),
}))
vi.mock('../hooks/useTransactions', () => ({
  useTransactions: () => ({ transactions: [], loading: false, error: null }),
}))

function Harness() {
  const { state, openAdd, openEdit } = useAddSheet()
  return (
    <>
      {!state.open ? <button onClick={openAdd}>open-add</button> : null}
      {!state.open ? (
        <button
          onClick={() =>
            openEdit({ id: 't9', kind: 'expense', amount: 350, categoryId: 'c1', note: 'flat white', date: '2026-10-01', at: Timestamp.fromDate(new Date(2026, 9, 1, 12)), source: 'app' })
          }
        >
          open-edit
        </button>
      ) : null}
      <AddTransactionSheet />
    </>
  )
}

const setup = () => render(<ToastProvider><AddSheetProvider><Harness /></AddSheetProvider></ToastProvider>)

beforeEach(() => {
  vi.clearAllMocks()
  createTransaction.mockReturnValue({ id: 'new', done: new Promise<void>(() => {}) }) // never resolves: offline
  updateTransaction.mockReturnValue(new Promise<void>(() => {}))
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
})
