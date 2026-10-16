import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../context/ToastContext'
import type { Category } from '../lib/types'
import { CategoriesPage } from './CategoriesPage'

const GROCERIES: Category = { id: 'c1', name: 'Groceries', icon: 'ShoppingCart', color: 'emerald', kind: 'expense', order: 0, archived: false }
const COFFEE: Category = { id: 'c2', name: 'Coffee', icon: 'Coffee', color: 'amber', kind: 'expense', order: 1, archived: false }
/** Archived with the highest expense order: new and unarchived categories must still go after it. */
const OTHER: Category = { id: 'c3', name: 'Other', icon: 'CircleEllipsis', color: 'slate', kind: 'expense', order: 5, archived: true }
/** A higher order of the other kind, which must not count. */
const SALARY: Category = { id: 'c4', name: 'Salary', icon: 'Banknote', color: 'emerald', kind: 'income', order: 9, archived: false }

const { createCategory, updateCategory, swapCategoryOrder, useCategories } = vi.hoisted(() => ({
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  swapCategoryOrder: vi.fn(),
  useCategories: vi.fn(),
}))
vi.mock('../lib/firestore', () => ({ createCategory, updateCategory, swapCategoryOrder }))
vi.mock('../hooks/useCategories', () => ({ useCategories }))

const withCategories = (categories: Category[]) =>
  useCategories.mockReturnValue({ categories, byId: new Map(categories.map((c) => [c.id, c])), loading: false, error: null })
const page = () => render(<ToastProvider><CategoriesPage /></ToastProvider>)

beforeEach(() => {
  vi.clearAllMocks()
  createCategory.mockReturnValue({ id: 'new', done: new Promise<void>(() => {}) })
  updateCategory.mockReturnValue(new Promise<void>(() => {}))
  withCategories([GROCERIES, COFFEE, OTHER, SALARY])
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
})
