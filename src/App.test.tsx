import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { Category, RecurringTemplate } from './lib/types'

const { useAuth, useBudgets, useCategories, useSettings, useTransactions, useRecurring, materialiseRecurring } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useBudgets: vi.fn(),
  useCategories: vi.fn(),
  useSettings: vi.fn(),
  useTransactions: vi.fn(),
  useRecurring: vi.fn(),
  materialiseRecurring: vi.fn(),
}))
// No Firebase here: the SDK set-up is replaced, the owner is signed in, and every hook a route reads is a stub.
vi.mock('./lib/firebase', () => ({ ALLOWED_EMAIL: 'owner@example.com', auth: {}, db: {}, googleProvider: {}, isFirebaseConfigured: true }))
vi.mock('./context/AuthContext', () => ({ AuthProvider: ({ children }: { children: ReactNode }) => children, useAuth }))
vi.mock('./hooks/useBudgets', () => ({ useBudgets }))
vi.mock('./hooks/useCategories', () => ({ useCategories }))
vi.mock('./hooks/useSettings', () => ({ useSettings }))
vi.mock('./hooks/useTransactions', () => ({ useTransactions }))
// Read by the shell's materialiser as well as by the Settings and Recurring pages.
vi.mock('./hooks/useRecurring', () => ({ useRecurring }))
vi.mock('./lib/firestore', async (importOriginal) => ({ ...(await importOriginal<typeof import('./lib/firestore')>()), materialiseRecurring }))

const COFFEE: Category = { id: 'c1', name: 'Coffee', icon: 'Coffee', color: 'amber', kind: 'expense', order: 0, archived: false }
/** A lazy page's code arrives in its own time: generous, so a busy CI machine does not fail it (the default is 1 s). */
const LOAD = { timeout: 3000 }

beforeEach(() => {
  vi.clearAllMocks()
  useAuth.mockReturnValue({ user: { email: 'owner@example.com' }, loading: false, configured: true, error: null, signIn: vi.fn(), logOut: vi.fn() })
  useBudgets.mockReturnValue({ budgets: new Map(), loading: false, error: null })
  useCategories.mockReturnValue({ categories: [COFFEE], byId: new Map([[COFFEE.id, COFFEE]]), loading: false, error: null })
  useSettings.mockReturnValue({ settings: { currency: 'EUR', locale: 'en' }, loading: false, fromCache: false, error: null })
  useTransactions.mockReturnValue({ transactions: [], loading: false, pending: false, fromCache: false, error: null })
  useRecurring.mockReturnValue({ templates: [], loading: false, fromCache: false, error: null })
  materialiseRecurring.mockReturnValue(new Promise<void>(() => {}))
})

afterEach(() => {
  vi.useRealTimers()
  window.history.replaceState(null, '', '/')
})

describe('App routes', () => {
  it('loads Trends on its first visit, with the fallback inside the shell until the page is in', async () => {
    window.history.replaceState(null, '', '/trends')
    render(<App />)
    // The page's code is still on its way: the fallback holds its place in the shell, whose controls are already there.
    expect(screen.getByRole('main')).toContainElement(screen.getByText('Loading…'))
    expect(screen.getByRole('button', { name: 'Add transaction' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Trends' }, LOAD)).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
  })

  it('loads the Recurring page on its first visit, in the shell', async () => {
    window.history.replaceState(null, '', '/recurring')
    render(<App />)
    expect(screen.getByRole('main')).toContainElement(screen.getByText('Loading…'))
    expect(await screen.findByRole('heading', { name: 'Recurring' }, LOAD)).toBeInTheDocument()
    expect(screen.getByText("Nothing repeats yet. Turn on 'Repeat every month' when adding an entry.")).toBeInTheDocument()
  })

  it('writes the months a template owes from the shell, whichever page is open', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 19, 9, 0))
    const rent: RecurringTemplate = {
      id: 'r1', kind: 'expense', amount: 120_000, categoryId: 'rent', note: 'Flat', dayOfMonth: 1, startMonth: '2026-01', endMonth: null, lastAppliedMonth: '2026-09',
    }
    useRecurring.mockReturnValue({ templates: [rent], loading: false, fromCache: false, error: null })
    window.history.replaceState(null, '', '/settings')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Settings' }, LOAD)).toBeInTheDocument()
    expect(materialiseRecurring).toHaveBeenCalledTimes(1)
    expect(materialiseRecurring).toHaveBeenCalledWith(rent, ['2026-10'])
  })

  // After the tests above, which each need their page's first visit to see the fallback: these only pin which page a path shows.
  it.each([
    ['/trends', 'Trends'],
    ['/categories', 'Categories'],
    ['/category/c1', 'Coffee'],
    ['/settings', 'Settings'],
    ['/recurring', 'Recurring'],
  ])('%s shows its own page, %s', async (path, heading) => {
    window.history.replaceState(null, '', path)
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: heading }, LOAD)).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })
})
