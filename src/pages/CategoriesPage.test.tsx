import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FirebaseError } from 'firebase/app'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../context/ToastContext'
import type { Category } from '../lib/types'
import { CategoriesPage } from './CategoriesPage'

const GROCERIES: Category = { id: 'c1', name: 'Groceries', icon: 'ShoppingCart', color: 'emerald', kind: 'expense', order: 0, archived: false }
const COFFEE: Category = { id: 'c2', name: 'Coffee', icon: 'Coffee', color: 'amber', kind: 'expense', order: 1, archived: false }
/** Archived with the highest expense order: new and unarchived categories must still go after it. */
const OTHER: Category = { id: 'c3', name: 'Other', icon: 'CircleEllipsis', color: 'slate', kind: 'expense', order: 5, archived: true }
/** A higher order of the other kind, which must not count. */
const SALARY: Category = { id: 'c4', name: 'Salary', icon: 'Banknote', color: 'emerald', kind: 'income', order: 9, archived: false }

const { createCategory, updateCategory, swapCategoryOrder, setBudget, useCategories, useBudgets, useSettings } = vi.hoisted(() => ({
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  swapCategoryOrder: vi.fn(),
  setBudget: vi.fn(),
  useCategories: vi.fn(),
  useBudgets: vi.fn(),
  useSettings: vi.fn(),
}))
vi.mock('../lib/firestore', () => ({ createCategory, updateCategory, swapCategoryOrder, setBudget }))
vi.mock('../hooks/useCategories', () => ({ useCategories }))
vi.mock('../hooks/useBudgets', () => ({ useBudgets }))
vi.mock('../hooks/useSettings', () => ({ useSettings }))

const withCategories = (categories: Category[]) =>
  useCategories.mockReturnValue({ categories, byId: new Map(categories.map((c) => [c.id, c])), loading: false, error: null })
/** Stands in for the category page and shows the id it was opened with. */
function CategoryStub() {
  const { id } = useParams()
  return <h1>{`Category ${id}`}</h1>
}
const tree = () => (
  <ToastProvider>
    <MemoryRouter initialEntries={['/categories']}>
      <Routes>
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="category/:id" element={<CategoryStub />} />
      </Routes>
    </MemoryRouter>
  </ToastProvider>
)
const page = () => render(tree())

beforeEach(() => {
  vi.clearAllMocks()
  createCategory.mockReturnValue({ id: 'new', done: new Promise<void>(() => {}) })
  updateCategory.mockReturnValue(new Promise<void>(() => {}))
  setBudget.mockReturnValue(new Promise<void>(() => {}))
  withCategories([GROCERIES, COFFEE, OTHER, SALARY])
  // Coffee may spend PLN 120.00 a month.
  useBudgets.mockReturnValue({ budgets: new Map([[COFFEE.id, 12000]]), loading: false, error: null })
  useSettings.mockReturnValue({ settings: { currency: 'PLN', locale: 'en' }, loading: false, fromCache: false, error: null })
})

describe('CategoriesPage', () => {
  it('puts new and unarchived categories after every category of the kind, archived included', async () => {
    const user = userEvent.setup()
    page()
    await user.click(screen.getByRole('button', { name: 'New' }))
    await user.type(screen.getByLabelText('Name'), 'Books')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(createCategory).toHaveBeenCalledWith(expect.objectContaining({ name: 'Books', kind: 'expense', order: 6 }))

    await user.click(screen.getByText('Archived (1)'))
    await user.click(screen.getByRole('button', { name: 'Other' }))
    await user.click(screen.getByRole('button', { name: 'Unarchive' }))
    expect(updateCategory).toHaveBeenCalledWith('c3', { archived: false, order: 6 })
  })

  it('offers New only once the categories have loaded', () => {
    useCategories.mockReturnValue({ categories: [], byId: new Map(), loading: true, error: null })
    const { rerender } = page()
    expect(screen.getByRole('button', { name: 'New' })).toBeDisabled() // an empty list would hand out order 0 again

    withCategories([GROCERIES, COFFEE, OTHER, SALARY])
    rerender(tree())
    expect(screen.getByRole('button', { name: 'New' })).toBeEnabled()
  })

  it('starts a kind without categories at order 0', async () => {
    const user = userEvent.setup()
    withCategories([GROCERIES, COFFEE, OTHER])
    page()
    await user.click(screen.getByRole('radio', { name: 'Income' }))
    await user.click(screen.getByRole('button', { name: 'New' }))
    await user.type(screen.getByLabelText('Name'), 'Salary')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(createCategory).toHaveBeenCalledWith(expect.objectContaining({ name: 'Salary', kind: 'income', order: 0 }))
  })

  it("opens a category's page from its edit sheet", async () => {
    const user = userEvent.setup()
    page()
    await user.click(screen.getByRole('button', { name: 'Coffee' }))
    await user.click(screen.getByRole('link', { name: 'History' }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Category c2$/)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it("edits a category's own budget in the currency of the settings", async () => {
    const user = userEvent.setup()
    page()
    await user.click(screen.getByRole('button', { name: 'Groceries' }))
    expect(screen.getByRole('textbox', { name: 'Monthly budget' })).toHaveValue('') // Groceries has none
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: 'Coffee' }))
    const field = screen.getByRole('textbox', { name: 'Monthly budget' })
    expect(field).toHaveValue('120')
    await user.clear(field)
    await user.type(field, '150')
    expect(field).toHaveAccessibleDescription('PLN\u00a0150.00 a month') // Intl's no-break space after the code
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(setBudget.mock.calls).toEqual([['c2', 15000]])
  })

  it('reads a typed budget back in the locale of the settings', async () => {
    useSettings.mockReturnValue({ settings: { currency: 'PLN', locale: 'de' }, loading: false, fromCache: false, error: null })
    const user = userEvent.setup()
    page()
    await user.click(screen.getByRole('button', { name: 'Coffee' }))
    const field = screen.getByRole('textbox', { name: 'Monthly budget' })
    await user.clear(field)
    await user.type(field, '1500')
    expect(field).toHaveAccessibleDescription('1.500,00\u00a0PLN a month')
  })

  describe('when the budgets cannot be read', () => {
    const DENIED = "Could not load budgets: You don't have access to this data (signed in with the wrong account?)"
    const failWith = (error: Error) => useBudgets.mockReturnValue({ budgets: new Map(), loading: false, error })

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) // the toast's 3 s
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('says so in a toast, once per failure', () => {
      const denied = new FirebaseError('permission-denied', 'Missing or insufficient permissions.')
      failWith(denied)
      const { rerender } = page()
      expect(screen.getByRole('status')).toHaveTextContent(DENIED)

      act(() => vi.advanceTimersByTime(3000))
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      rerender(tree()) // the same failure, rendered again: no second toast
      expect(screen.queryByRole('status')).not.toBeInTheDocument()

      failWith(new FirebaseError('unavailable', 'Failed to get documents from cache.'))
      rerender(tree())
      expect(screen.getByRole('status')).toHaveTextContent("Could not load budgets: You're offline and this data isn't cached yet")
    })
  })
})
