import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FirebaseError } from 'firebase/app'
import { useState } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../context/ToastContext'
import { importRowId, type ImportRow } from '../lib/csv'
import type { Category } from '../lib/types'
import { ImportSheet } from './ImportSheet'

const { useCategories, createCategory, importTransactions } = vi.hoisted(() => ({
  useCategories: vi.fn(),
  createCategory: vi.fn(),
  importTransactions: vi.fn(),
}))
vi.mock('../hooks/useCategories', () => ({ useCategories }))
vi.mock('../lib/firestore', () => ({ createCategory, importTransactions }))

const cat = (id: string, name: string, kind: Category['kind'], order: number, archived = false): Category => ({
  id, name, kind, order, archived, icon: 'Gift', color: 'red',
})
const CATEGORIES = [
  cat('groceries', 'Groceries', 'expense', 0),
  cat('eating', 'Eating out', 'expense', 1),
  cat('hobby', 'Hobby', 'expense', 18, true),
  cat('salary', 'Salary', 'income', 0),
]
const withCategories = (categories: Category[], state: { loading?: boolean; error?: Error } = {}) =>
  useCategories.mockReturnValue({ categories, byId: new Map(categories.map((c) => [c.id, c])), loading: state.loading ?? false, error: state.error ?? null })

/** A Money Manager export: kinds in their own column, decimal commas, quoted notes with commas and quotes. */
const MONEY_MANAGER = [
  'Date,Account,Category,Subcategory,Note,PLN,Income/Expense,Description,Amount,Currency',
  '14.10.2026,Cash,groceries,,"Milk, bread",12.50,Expense,,"12,50",PLN',
  '12.10.2026,Bank,Salary,,October,5000.00,Income,,"5 000,00",PLN',
  '11.10.2026,Cash,Books,,"Dune, ""deluxe""",45.00,Expense,,"45,00",PLN',
  '03.09.2026,Cash,books,,,30.00,Expense,,"30,00",PLN',
  '02.09.2026,Card,Eating out,,Lunch,25.00,Expense,,"25,00",PLN',
  '01.09.2026,Card,Eating out,,,0.00,Expense,,"0,00",PLN',
  '31.08.2026,Card,Bank,,,100.00,Transfer-Out,,"100,00",PLN',
].join('\r\n')
/** What the file's five importable rows become. */
const ROWS: ImportRow[] = [
  { kind: 'expense', amount: 1250, categoryName: 'groceries', date: '2026-10-14', note: 'Milk, bread' },
  { kind: 'income', amount: 500_000, categoryName: 'Salary', date: '2026-10-12', note: 'October' },
  { kind: 'expense', amount: 4500, categoryName: 'Books', date: '2026-10-11', note: 'Dune, "deluxe"' },
  { kind: 'expense', amount: 3000, categoryName: 'books', date: '2026-09-03', note: '' },
  { kind: 'expense', amount: 2500, categoryName: 'Eating out', date: '2026-09-02', note: 'Lunch' },
]

const onClose = vi.fn()
function HomeStub() {
  return <p>Home{useLocation().search}</p>
}
/** Settings with the sheet mounted while open, as SettingsPage does; Home to land on after an import. */
function Harness() {
  const [open, setOpen] = useState(true)
  const close = () => {
    onClose()
    setOpen(false)
  }
  return open ? <ImportSheet currency="PLN" locale="en" onClose={close} /> : <p>Settings without the sheet</p>
}
const renderSheet = () =>
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="settings" element={<Harness />} />
          <Route index element={<HomeStub />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  )
const csvFile = (text: string, name = 'export.csv') => new File([text], name, { type: 'text/csv' })
async function chooseFile(text: string, user = userEvent.setup()) {
  renderSheet()
  await user.upload(screen.getByLabelText('CSV file'), csvFile(text))
  // The mapping appears once the file has been read.
  await screen.findByRole('group', { name: 'Columns' })
  return user
}
const importButton = () => screen.getByRole('button', { name: /^Import/ })
/** Text as read on screen: Intl's no-break spaces ("PLN 12.50") as plain ones. */
const text = (el: Element) => (el.textContent ?? '').replace(/\s/g, ' ')

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 5, 9, 0)) // 5 Nov 2026: October is a past month
  withCategories(CATEGORIES)
  createCategory.mockImplementation((input: { name: string }) => ({ id: `new-${input.name.toLowerCase()}`, done: Promise.resolve() }))
  importTransactions.mockImplementation(async (rows: unknown[]) => rows.length)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ImportSheet', () => {
  it('starts with the file input only: CSV or plain text files', () => {
    renderSheet()
    expect(screen.getByRole('dialog', { name: 'Import CSV' })).toBeInTheDocument()
    expect(screen.getByLabelText('CSV file')).toHaveAttribute('accept', '.csv,text/csv,text/plain')
    expect(screen.queryByRole('group', { name: 'Columns' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Import/ })).not.toBeInTheDocument()
  })

  it('maps a Money Manager export by itself and previews the first rows as they will be imported', async () => {
    await chooseFile(MONEY_MANAGER)
    expect(screen.getByLabelText('Date')).toHaveDisplayValue('Date')
    expect(screen.getByLabelText('Amount')).toHaveDisplayValue('Amount')
    expect(screen.getByLabelText('Kind')).toHaveDisplayValue('Income/Expense')
    expect(screen.getByLabelText('Category')).toHaveDisplayValue('Category')
    expect(screen.getByLabelText('Note')).toHaveDisplayValue('Note')
    // With a kind column, the sign of the amount means nothing.
    expect(screen.queryByLabelText('Negative amounts are expenses')).not.toBeInTheDocument()

    const values = screen.getByRole('group', { name: 'Kind values' })
    expect(within(values).getByLabelText('Rows with "Expense"')).toHaveDisplayValue('Expense')
    expect(within(values).getByLabelText('Rows with "Income"')).toHaveDisplayValue('Income')
    expect(within(values).getByLabelText('Rows with "Transfer-Out"')).toHaveDisplayValue('Skip')
    expect(values).toHaveTextContent('Expense · 5')

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(rows.map((r) => within(r).getAllByRole('cell').map(text))).toEqual([
      ['Oct 14, 2026', 'groceriesExpense · Milk, bread', 'PLN 12.50'],
      ['Oct 12, 2026', 'SalaryIncome · October', '+PLN 5,000.00'],
      ['Oct 11, 2026', 'BooksExpense · Dune, "deluxe"', 'PLN 45.00'],
      ['Sep 3, 2026', 'booksExpense', 'PLN 30.00'],
      ['Sep 2, 2026', 'Eating outExpense · Lunch', 'PLN 25.00'],
    ])
    expect(screen.getByText('5 of 7 rows ready to import.')).toBeInTheDocument()
    expect(screen.getByText("2 rows can't be imported:")).toBeInTheDocument()
    expect(screen.getByText('Line 7: Amount is zero')).toBeInTheDocument()
    expect(screen.getByText('Line 8: Skipped: kind "Transfer-Out"')).toBeInTheDocument()
    expect(importButton()).toHaveTextContent('Import 5 entries')
    expect(importButton()).toBeEnabled()
  })

  it('creates the missing categories, writes the rows under their deterministic ids, toasts and shows the latest month on Home', async () => {
    const user = await chooseFile(MONEY_MANAGER)
    await user.click(importButton())

    expect(await screen.findByRole('status')).toHaveTextContent('Imported 5 entries · 1 new category')
    // "groceries", "Salary" and "Eating out" exist (case aside); "Books" and "books" are one new expense category, after
    // the highest order of the kind (the archived Hobby's 18).
    expect(createCategory).toHaveBeenCalledTimes(1)
    expect(createCategory).toHaveBeenCalledWith({ name: 'Books', icon: 'CircleEllipsis', color: 'slate', kind: 'expense', order: 19, archived: false })
    const categoryIds = ['groceries', 'salary', 'new-books', 'new-books', 'eating']
    const ids = await Promise.all(ROWS.map((r) => importRowId(r)))
    expect(importTransactions).toHaveBeenCalledTimes(1)
    expect(importTransactions).toHaveBeenCalledWith(
      ROWS.map((r, i) => ({ id: ids[i], input: { kind: r.kind, amount: r.amount, categoryId: categoryIds[i], note: r.note, date: r.date, source: 'import' } })),
      expect.any(Function),
    )
    expect(createCategory.mock.invocationCallOrder[0]).toBeLessThan(importTransactions.mock.invocationCallOrder[0])
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Home?month=2026-10')).toBeInTheDocument()
  })

  it('lands on Home without a month in the link when the latest imported month is the current one', async () => {
    vi.setSystemTime(new Date(2026, 9, 19, 9, 0))
    const user = await chooseFile(MONEY_MANAGER)
    await user.click(importButton())
    expect(await screen.findByText('Home')).toBeInTheDocument()
  })

  it('lands on the latest month imported even when the file lists the oldest first', async () => {
    const user = await chooseFile('Date,Category,Amount\n2026-07-01,Food,-1\n2026-09-30,Food,-2\n2026-08-15,Food,-3\n')
    await user.click(importButton())
    expect(await screen.findByText('Home?month=2026-09')).toBeInTheDocument()
  })

  it('shows the progress while the entries are written, with Import off', async () => {
    let progress: (done: number) => void = () => {}
    let finish: (count: number) => void = () => {}
    importTransactions.mockImplementation((_rows: unknown[], onProgress: (done: number) => void) => {
      progress = onProgress
      return new Promise<number>((resolve) => {
        finish = resolve
      })
    })
    const user = await chooseFile(MONEY_MANAGER)
    await user.click(importButton())
    await waitFor(() => expect(importTransactions).toHaveBeenCalled())
    expect(importButton()).toHaveTextContent('Importing…')
    expect(importButton()).toBeDisabled()
    expect(screen.getByText('0 of 5 written')).toBeInTheDocument()
    act(() => progress(3))
    expect(screen.getByText('3 of 5 written')).toBeInTheDocument()
    await act(async () => finish(5))
    expect(await screen.findByRole('status')).toHaveTextContent('Imported 5 entries · 1 new category')
  })

  it('keeps writing when the sheet is closed meanwhile, then toasts without leaving the page', async () => {
    let finish: (count: number) => void = () => {}
    importTransactions.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve
        }),
    )
    const user = await chooseFile(MONEY_MANAGER)
    await user.click(importButton())
    await waitFor(() => expect(importTransactions).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByText('Settings without the sheet')).toBeInTheDocument()
    await act(async () => finish(5))
    expect(await screen.findByRole('status')).toHaveTextContent('Imported 5 entries · 1 new category')
    expect(screen.getByText('Settings without the sheet')).toBeInTheDocument()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows every reason and offers no import when no row can be imported', async () => {
    await chooseFile('Date,Category,Amount\r\nyesterday,Food,12\r\n2026-10-01,Food,abc\r\n2026-10-02,Food,0\r\n')
    expect(screen.getByText('0 of 3 rows ready to import.')).toBeInTheDocument()
    expect(screen.getByText("3 rows can't be imported:")).toBeInTheDocument()
    expect(screen.getByText('Line 2: Unreadable date "yesterday"')).toBeInTheDocument()
    expect(screen.getByText('Line 3: Unreadable amount "abc"')).toBeInTheDocument()
    expect(screen.getByText('Line 4: Amount is zero')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(importButton()).toHaveTextContent('Import 0 entries')
    expect(importButton()).toBeDisabled()
  })

  it('lists the first five reasons and counts the rest', async () => {
    const lines = Array.from({ length: 8 }, (_, i) => `2026-10-0${i + 1},Food,0`)
    await chooseFile(['Date,Category,Amount', ...lines].join('\n'))
    expect(screen.getAllByText(/^Line \d: Amount is zero$/)).toHaveLength(5)
    expect(screen.getByText('…and 3 more')).toBeInTheDocument()
  })

  it('reads the sign of the amount when there is no kind column, and every row as an expense when told it means nothing', async () => {
    const user = await chooseFile('Date,Category,Amount\n2026-10-01,Food,-12.50\n2026-10-02,Refund,3\n')
    const box = screen.getByLabelText('Negative amounts are expenses')
    expect(box).toBeChecked()
    expect(screen.getByText('Positive amounts are imported as income.')).toBeInTheDocument()
    const amounts = () => within(screen.getByRole('table')).getAllByRole('row').slice(1).map((r) => text(within(r).getAllByRole('cell')[2]))
    expect(amounts()).toEqual(['PLN 12.50', '+PLN 3.00'])

    await user.click(box)
    expect(box).not.toBeChecked()
    expect(screen.getByText('Every row is imported as an expense.')).toBeInTheDocument()
    expect(amounts()).toEqual(['PLN 12.50', 'PLN 3.00'])
  })

  it('lets each value of the kind column be read as income, an expense or skipped', async () => {
    const user = await chooseFile(MONEY_MANAGER)
    await user.selectOptions(screen.getByLabelText('Rows with "Transfer-Out"'), 'Expense')
    expect(screen.getByLabelText('Rows with "Transfer-Out"')).toHaveDisplayValue('Expense')
    expect(screen.getByText('6 of 7 rows ready to import.')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Rows with "Income"'), 'Skip')
    expect(screen.getByText('5 of 7 rows ready to import.')).toBeInTheDocument()
    expect(screen.getByText('Line 3: Skipped: kind "Income"')).toBeInTheDocument()
    expect(importButton()).toHaveTextContent('Import 5 entries')
  })

  it('asks for the columns it could not guess, then previews', async () => {
    const user = await chooseFile('When,What,How much\n2026-10-01,Food,-4\n')
    expect(screen.getByLabelText('Date')).toHaveDisplayValue('Choose a column')
    expect(screen.getByLabelText('Note')).toHaveDisplayValue('None')
    expect(screen.getByText('Choose the date, amount and category columns.')).toBeInTheDocument()
    expect(importButton()).toBeDisabled()

    await user.selectOptions(screen.getByLabelText('Date'), 'When')
    await user.selectOptions(screen.getByLabelText('Amount'), 'How much')
    await user.selectOptions(screen.getByLabelText('Category'), 'What')
    expect(screen.queryByText('Choose the date, amount and category columns.')).not.toBeInTheDocument()
    expect(screen.getByText('1 of 1 rows ready to import.')).toBeInTheDocument()
    expect(importButton()).toHaveTextContent('Import 1 entry')
    expect(importButton()).toBeEnabled()
  })

  it('names unnamed and repeated header columns by their position', async () => {
    await chooseFile('Date,,Amount,Amount,Category\n2026-10-01,x,1,2,Food\n')
    const options = within(screen.getByLabelText('Note')).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['None', 'Date', 'Column 2', 'Amount (column 3)', 'Amount (column 4)', 'Category'])
  })

  it.each([
    { name: 'an empty file', text: '', message: 'The file is empty.' },
    { name: 'a header without rows', text: 'Date,Amount,Category\r\n', message: 'The file has a header row only.' },
  ])('says so for $name', async ({ text, message }) => {
    const user = userEvent.setup()
    renderSheet()
    await user.upload(screen.getByLabelText('CSV file'), csvFile(text))
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Columns' })).not.toBeInTheDocument()
  })

  it('warns when the file is not UTF-8', async () => {
    await chooseFile('Date,Category,Amount\n2026-10-01,Jedzenie \uFFFD,1\n')
    expect(screen.getByText('Some characters could not be read. Save the file as UTF-8 and choose it again.')).toBeInTheDocument()
  })

  it('waits for the categories before it imports', async () => {
    withCategories([], { loading: true })
    await chooseFile(MONEY_MANAGER)
    expect(importButton()).toBeDisabled()
    expect(screen.getByText('Loading categories…')).toBeInTheDocument()
  })

  it('shows a categories error and offers no import', async () => {
    withCategories([], { error: new FirebaseError('permission-denied', 'Missing or insufficient permissions.') })
    await chooseFile(MONEY_MANAGER)
    expect(screen.getByText("You don't have access to this data (signed in with the wrong account?)")).toBeInTheDocument()
    expect(importButton()).toBeDisabled()
  })

  it('toasts a failed import and stays open, ready to try again', async () => {
    importTransactions.mockRejectedValue(new FirebaseError('resource-exhausted', 'Quota exceeded.'))
    const user = await chooseFile(MONEY_MANAGER)
    await user.click(importButton())
    expect(await screen.findByRole('status')).toHaveTextContent('Could not import: Firebase quota reached, data will refresh after midnight PT')
    expect(onClose).not.toHaveBeenCalled()
    expect(importButton()).toHaveTextContent('Import 5 entries')
    expect(importButton()).toBeEnabled()
  })

  it('toasts a category that could not be written', async () => {
    createCategory.mockImplementation(() => ({ id: 'new', done: Promise.reject(new FirebaseError('permission-denied', 'Missing or insufficient permissions.')) }))
    const user = await chooseFile(MONEY_MANAGER)
    await user.click(importButton())
    expect(await screen.findByRole('status')).toHaveTextContent("Could not import: You don't have access to this data (signed in with the wrong account?)")
    expect(onClose).not.toHaveBeenCalled()
  })
})
