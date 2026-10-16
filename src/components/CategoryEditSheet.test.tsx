import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../context/ToastContext'
import { ICON_KEYS } from '../lib/categoryIcons'
import type { Category } from '../lib/types'
import { CategoryEditSheet } from './CategoryEditSheet'

const GROCERIES: Category = { id: 'c1', name: 'Groceries', icon: 'ShoppingCart', color: 'emerald', kind: 'expense', order: 0, archived: false }
const COFFEE: Category = { id: 'c2', name: 'Coffee', icon: 'Coffee', color: 'amber', kind: 'expense', order: 2, archived: false }
const TAXI: Category = { id: 'c3', name: 'Taxi', icon: 'Car', color: 'yellow', kind: 'expense', order: 7, archived: false }
/** Active expense categories sorted by `order`; the gaps keep "next order" distinct from the count. */
const SIBLINGS = [GROCERIES, COFFEE, TAXI]

const { createCategory, updateCategory, swapCategoryOrder } = vi.hoisted(() => ({
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  swapCategoryOrder: vi.fn(),
}))
vi.mock('../lib/firestore', () => ({ createCategory, updateCategory, swapCategoryOrder }))

const onClose = vi.fn()
// nextOrder 12, as if archived categories of the kind reach order 11: past the siblings' max + 1 (8) on purpose.
const sheet = (props: Partial<ComponentProps<typeof CategoryEditSheet>> = {}) => (
  <ToastProvider>
    <CategoryEditSheet open kind="expense" editing={null} siblings={SIBLINGS} nextOrder={12} onClose={onClose} {...props} />
  </ToastProvider>
)

beforeEach(() => {
  vi.clearAllMocks()
  // Writes never settle (offline): the sheet must act without waiting for the server.
  createCategory.mockReturnValue({ id: 'new', done: new Promise<void>(() => {}) })
  updateCategory.mockReturnValue(new Promise<void>(() => {}))
  swapCategoryOrder.mockReturnValue(new Promise<void>(() => {}))
})

describe('CategoryEditSheet', () => {
  it('creates a category at the next order without waiting for the server', async () => {
    const user = userEvent.setup()
    render(sheet())
    const create = screen.getByRole('button', { name: 'Create' })
    expect(create).toBeDisabled()
    await user.type(screen.getByLabelText('Name'), '   ')
    expect(create).toBeDisabled()
    await user.type(screen.getByLabelText('Name'), 'Books ')
    expect(create).toBeEnabled()
    await user.click(create)
    expect(createCategory).toHaveBeenCalledWith({ name: 'Books', icon: 'CircleEllipsis', color: 'rose', kind: 'expense', order: 12, archived: false })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('creates a category of its kind at the next order even with no active siblings', async () => {
    const user = userEvent.setup()
    // Every income category is archived, the highest at order 3.
    render(sheet({ kind: 'income', siblings: [], nextOrder: 4 }))
    await user.type(screen.getByLabelText('Name'), 'Salary')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(createCategory).toHaveBeenCalledWith(expect.objectContaining({ name: 'Salary', kind: 'income', order: 4 }))
  })

  it('prefills an edit and saves the changed name, colour and icon', async () => {
    const user = userEvent.setup()
    render(sheet({ editing: COFFEE }))
    const name = screen.getByLabelText('Name')
    expect(name).toHaveValue('Coffee')
    expect(screen.getByRole('radio', { name: 'amber' })).toBeChecked()
    expect(screen.getByRole('option', { name: 'Coffee' })).toHaveAttribute('aria-selected', 'true')
    await user.clear(name)
    await user.type(name, 'Espresso')
    await user.click(screen.getByRole('radio', { name: 'teal' }))
    await user.click(screen.getByRole('option', { name: 'Beer' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(updateCategory).toHaveBeenCalledWith('c2', { name: 'Espresso', icon: 'Beer', color: 'teal' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('moves down by swapping with the next sibling; the first cannot move up', async () => {
    const user = userEvent.setup()
    render(sheet({ editing: GROCERIES }))
    expect(screen.getByRole('button', { name: 'Move up' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Move down' }))
    expect(swapCategoryOrder).toHaveBeenCalledWith(GROCERIES, COFFEE)
    expect(onClose).not.toHaveBeenCalled() // stays open for further moves
  })

  it('moves again from the re-sorted siblings, not the order it opened with', async () => {
    const user = userEvent.setup()
    const { rerender } = render(sheet({ editing: GROCERIES }))
    await user.click(screen.getByRole('button', { name: 'Move down' }))
    // The snapshot after the swap: Coffee took order 0 and Groceries order 2.
    rerender(sheet({ editing: GROCERIES, siblings: [{ ...COFFEE, order: 0 }, { ...GROCERIES, order: 2 }, TAXI] }))
    expect(screen.getByRole('button', { name: 'Move up' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Move down' }))
    expect(swapCategoryOrder).toHaveBeenLastCalledWith({ ...GROCERIES, order: 2 }, TAXI)
    rerender(sheet({ editing: GROCERIES, siblings: [{ ...COFFEE, order: 0 }, { ...TAXI, order: 2 }, { ...GROCERIES, order: 7 }] }))
    expect(screen.getByRole('button', { name: 'Move down' })).toBeDisabled()
  })

  it('archives, keeping the order, without waiting for the server and closes', async () => {
    const user = userEvent.setup()
    render(sheet({ editing: TAXI }))
    await user.click(screen.getByRole('button', { name: 'Archive' }))
    expect(updateCategory).toHaveBeenCalledWith('c3', { archived: true })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('cannot move an archived category', () => {
    // Archived categories are not among the active siblings.
    render(sheet({ editing: { ...TAXI, archived: true }, siblings: [GROCERIES, COFFEE] }))
    expect(screen.getByRole('button', { name: 'Move up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move down' })).toBeDisabled()
  })

  it('unarchive assigns the next order', async () => {
    const user = userEvent.setup()
    render(sheet({ editing: { ...TAXI, archived: true }, siblings: [GROCERIES, COFFEE] }))
    await user.click(screen.getByRole('button', { name: 'Unarchive' }))
    expect(updateCategory).toHaveBeenCalledWith('c3', { archived: false, order: 12 })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('narrows the icon grid by search and selects the clicked icon', async () => {
    const user = userEvent.setup()
    render(sheet())
    const grid = screen.getByRole('listbox', { name: 'Icon' })
    expect(within(grid).getAllByRole('option')).toHaveLength(ICON_KEYS.length)
    expect(within(grid).getByRole('option', { name: 'CircleEllipsis' })).toHaveAttribute('aria-selected', 'true')
    await user.type(screen.getByLabelText('Search icons'), 'coff')
    const options = within(grid).getAllByRole('option')
    expect(options.map((o) => o.getAttribute('aria-label'))).toEqual(['Coffee'])
    expect(options[0]).toHaveAttribute('aria-selected', 'false')
    await user.click(options[0])
    expect(within(grid).getByRole('option', { name: 'Coffee' })).toHaveAttribute('aria-selected', 'true')
    await user.type(screen.getByLabelText('Name'), 'Beans')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(createCategory).toHaveBeenCalledWith(expect.objectContaining({ name: 'Beans', icon: 'Coffee' }))
  })

  it('reports a failed save in a toast after closing', async () => {
    // Built on call, so the rejection gets its handler in the tick it is created.
    updateCategory.mockImplementation(() => Promise.reject(new Error('denied')))
    const user = userEvent.setup()
    render(sheet({ editing: COFFEE }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('status')).toHaveTextContent(/denied/)
  })
})
