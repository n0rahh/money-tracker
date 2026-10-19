import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FirebaseError } from 'firebase/app'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../context/ToastContext'
import type { Category, RecurringTemplate } from '../lib/types'
import { RecurringPage } from './RecurringPage'

const HOUSING: Category = { id: 'rent', name: 'Housing', icon: 'House', color: 'orange', kind: 'expense', order: 0, archived: false }
const SALARY: Category = { id: 'salary', name: 'Salary', icon: 'Banknote', color: 'emerald', kind: 'income', order: 0, archived: false }
const SPORT: Category = { id: 'sport', name: 'Sport', icon: 'Dumbbell', color: 'sky', kind: 'expense', order: 1, archived: false }
const CATEGORIES = [HOUSING, SALARY, SPORT]

// The clock (Date only) reads Monday 19 Oct 2026 below.
/** Runs with no end. */
const RENT: RecurringTemplate = {
  id: 'r1', kind: 'expense', amount: 120_000, categoryId: 'rent', note: 'Flat', dayOfMonth: 1, startMonth: '2026-01', endMonth: null, lastAppliedMonth: '2026-10',
}
/** Ends in December, so it can still be stopped sooner. */
const PAY: RecurringTemplate = {
  id: 'r2', kind: 'income', amount: 500_000, categoryId: 'salary', note: '', dayOfMonth: 25, startMonth: '2026-03', endMonth: '2026-12', lastAppliedMonth: '2026-10',
}
/** Ended in August. */
const GYM: RecurringTemplate = {
  id: 'r3', kind: 'expense', amount: 4_900, categoryId: 'sport', note: 'Gym', dayOfMonth: 31, startMonth: '2025-11', endMonth: '2026-08', lastAppliedMonth: '2026-08',
}
/** Edited by hand in the console down to no amount: the materialiser never writes it. */
const BROKEN: RecurringTemplate = {
  id: 'r4', kind: 'expense', amount: 0, categoryId: 'rent', note: 'typo', dayOfMonth: 5, startMonth: '2026-02', endMonth: null, lastAppliedMonth: null,
}

const { useRecurring, useCategories, useSettings, updateRecurring, deleteRecurring, restoreRecurring } = vi.hoisted(() => ({
  useRecurring: vi.fn(),
  useCategories: vi.fn(),
  useSettings: vi.fn(),
  updateRecurring: vi.fn(),
  deleteRecurring: vi.fn(),
  restoreRecurring: vi.fn(),
}))
vi.mock('../hooks/useRecurring', () => ({ useRecurring }))
vi.mock('../hooks/useCategories', () => ({ useCategories }))
vi.mock('../hooks/useSettings', () => ({ useSettings }))
// Templates only: nothing on this page may touch the entries a template has made.
vi.mock('../lib/firestore', () => ({ updateRecurring, deleteRecurring, restoreRecurring }))

const withTemplates = (templates: RecurringTemplate[], state: { loading?: boolean; error?: Error } = {}) =>
  useRecurring.mockReturnValue({ templates, loading: state.loading ?? false, fromCache: false, error: state.error ?? null })
const withCategories = (categories: Category[], state: { loading?: boolean; error?: Error } = {}) =>
  useCategories.mockReturnValue({ categories, byId: new Map(categories.map((c) => [c.id, c])), loading: state.loading ?? false, error: state.error ?? null })

/** One path is a cold deep link; a list is the history that led to its last path. */
const tree = (path: string | string[]) => (
  <ToastProvider>
    <MemoryRouter initialEntries={typeof path === 'string' ? [path] : path} initialIndex={typeof path === 'string' ? 0 : path.length - 1}>
      <Routes>
        <Route path="recurring" element={<RecurringPage />} />
        <Route path="settings" element={<p>Settings stub</p>} />
      </Routes>
    </MemoryRouter>
  </ToastProvider>
)
const page = (path: string | string[] = '/recurring') => render(tree(path))
/** The list row a piece of its text is in. */
const rowOf = (text: string) => {
  const row = screen.getByText(text).closest('li')
  if (!row) throw new Error(`no row holds "${text}"`)
  return row
}
const denied = () => new FirebaseError('permission-denied', 'Missing or insufficient permissions.')
const DENIED_TEXT = "You don't have access to this data (signed in with the wrong account?)"

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 19, 9, 0))
  withTemplates([RENT, PAY, GYM])
  withCategories(CATEGORIES)
  useSettings.mockReturnValue({ settings: { currency: 'EUR', locale: 'en' }, loading: false, fromCache: false, error: null })
  // Never settle: the page must not wait for a write.
  updateRecurring.mockReturnValue(new Promise<void>(() => {}))
  deleteRecurring.mockReturnValue(new Promise<void>(() => {}))
  restoreRecurring.mockReturnValue(new Promise<void>(() => {}))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks() // the window.confirm spy
})

describe('RecurringPage', () => {
  it('lists every template with its category, note, amount and schedule', () => {
    page()
    expect(screen.getByRole('heading', { name: 'Recurring' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)

    const rent = rowOf('Flat')
    expect(within(rent).getByText('Housing')).toBeInTheDocument()
    expect(within(rent).getByText('€1,200.00')).toBeInTheDocument()
    expect(within(rent).getByText('Every month on day 1 · since January 2026')).toBeInTheDocument()

    const pay = rowOf('Salary')
    expect(within(pay).getByText('+€5,000.00')).toBeInTheDocument()
    expect(within(pay).getByText('Every month on day 25 · since March 2026 · until December 2026')).toBeInTheDocument()

    expect(within(rowOf('Gym')).getByText('Every month on day 31 · since November 2025 · until August 2026')).toBeInTheDocument()
  })

  it('offers Stop while a template runs past this month, and Delete on every template', () => {
    page()
    for (const text of ['Flat', 'Salary']) {
      expect(within(rowOf(text)).getByRole('button', { name: 'Stop' })).toBeInTheDocument()
      expect(within(rowOf(text)).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    }
    const gym = rowOf('Gym') // ended in August
    expect(within(gym).queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
    expect(within(gym).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('Stop ends a template with this month, without waiting for the server; its entries stay', async () => {
    const user = userEvent.setup()
    const { rerender } = page()
    await user.click(within(rowOf('Flat')).getByRole('button', { name: 'Stop' }))
    expect(updateRecurring).toHaveBeenCalledTimes(1)
    expect(updateRecurring).toHaveBeenCalledWith('r1', { endMonth: '2026-10' })
    expect(deleteRecurring).not.toHaveBeenCalled()

    // The local snapshot follows: the template now ends this month, and stopping it again would change nothing.
    withTemplates([{ ...RENT, endMonth: '2026-10' }, PAY, GYM])
    rerender(tree('/recurring'))
    const rent = rowOf('Flat')
    expect(within(rent).getByText('Every month on day 1 · since January 2026 · until October 2026')).toBeInTheDocument()
    expect(within(rent).queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
  })

  it('Delete removes the template at once, without asking or waiting, and offers Undo', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    page()
    await user.click(within(rowOf('Flat')).getByRole('button', { name: 'Delete' }))
    expect(confirm).not.toHaveBeenCalled()
    expect(deleteRecurring).toHaveBeenCalledTimes(1)
    expect(deleteRecurring).toHaveBeenCalledWith('r1')
    const toast = screen.getByRole('status')
    expect(toast).toHaveTextContent('Template deleted')
    expect(within(toast).getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    expect(restoreRecurring).not.toHaveBeenCalled()
  })

  it('Undo writes the template back exactly as it was, once', async () => {
    const user = userEvent.setup()
    page()
    await user.click(within(rowOf('Salary')).getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(restoreRecurring).toHaveBeenCalledTimes(1)
    expect(restoreRecurring).toHaveBeenCalledWith(PAY)
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    expect(deleteRecurring).toHaveBeenCalledTimes(1)
  })

  it.each([
    { action: 'Stop', fail: () => updateRecurring.mockImplementation(() => Promise.reject(denied())), shown: `Could not stop: ${DENIED_TEXT}` },
    { action: 'Delete', fail: () => deleteRecurring.mockImplementation(() => Promise.reject(denied())), shown: `Could not delete: ${DENIED_TEXT}` },
  ])('explains a failed $action in a toast', async ({ action, fail, shown }) => {
    fail()
    const user = userEvent.setup()
    page()
    await user.click(within(rowOf('Flat')).getByRole('button', { name: action }))
    expect(await screen.findByText(shown)).toBeInTheDocument()
  })

  it('explains a failed Undo in a toast', async () => {
    restoreRecurring.mockImplementation(() => Promise.reject(denied()))
    const user = userEvent.setup()
    page()
    await user.click(within(rowOf('Flat')).getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText(`Could not undo: ${DENIED_TEXT}`)).toBeInTheDocument()
  })

  it('marks a template it cannot use as invalid and offers only Delete, without an Undo the rules would refuse', async () => {
    withTemplates([RENT, BROKEN])
    const user = userEvent.setup()
    page()
    const broken = rowOf('typo')
    expect(within(broken).getByText('Invalid template')).toBeInTheDocument()
    expect(within(broken).queryByText(/^Every month/)).not.toBeInTheDocument()
    expect(within(broken).queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
    await user.click(within(broken).getByRole('button', { name: 'Delete' }))
    expect(deleteRecurring).toHaveBeenCalledWith('r4')
    expect(screen.getByRole('status')).toHaveTextContent('Template deleted')
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('names a template whose category was removed "Uncategorized"', () => {
    withTemplates([{ ...RENT, categoryId: 'removed-in-console' }])
    page()
    expect(within(rowOf('Flat')).getByText('Uncategorized')).toBeInTheDocument()
  })

  it('says how to make one when nothing repeats yet', () => {
    withTemplates([])
    page()
    expect(screen.getByText("Nothing repeats yet. Turn on 'Repeat every month' when adding an entry.")).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it.each([
    { what: 'the templates', arrange: () => withTemplates([], { loading: true }) },
    { what: 'the categories', arrange: () => withCategories([], { loading: true }) },
    { what: 'the currency', arrange: () => useSettings.mockReturnValue({ settings: null, loading: true, fromCache: true, error: null }) },
  ])('shows Loading… and no empty state until $what are in', ({ arrange }) => {
    arrange()
    page()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByText(/Nothing repeats yet/)).not.toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it.each([
    { what: 'the templates', arrange: () => withTemplates([], { error: denied() }) },
    { what: 'the categories', arrange: () => withCategories([], { error: denied() }) },
  ])('says why when $what cannot be read, instead of an empty list', ({ arrange }) => {
    arrange()
    page()
    expect(screen.getByText(DENIED_TEXT)).toBeInTheDocument()
    expect(screen.queryByText(/Nothing repeats yet/)).not.toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('opened cold from a link, its Back link goes to Settings', () => {
    page()
    expect(screen.getByRole('link', { name: 'Back to Settings' })).toHaveAttribute('href', '/settings')
  })

  it('opened from Settings, Back returns through history instead of stacking another Settings', async () => {
    const user = userEvent.setup()
    page(['/settings', '/recurring'])
    expect(screen.queryByRole('link', { name: 'Back to Settings' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Settings stub')).toBeInTheDocument()
  })
})
