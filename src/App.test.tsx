import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const { useAuth, useCategories, useSettings, useTransactions } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useCategories: vi.fn(),
  useSettings: vi.fn(),
  useTransactions: vi.fn(),
}))
// No Firebase here: the SDK set-up is replaced, the owner is signed in, and every hook a route reads is a stub.
vi.mock('./lib/firebase', () => ({ ALLOWED_EMAIL: 'owner@example.com', auth: {}, db: {}, googleProvider: {}, isFirebaseConfigured: true }))
vi.mock('./context/AuthContext', () => ({ AuthProvider: ({ children }: { children: ReactNode }) => children, useAuth }))
vi.mock('./hooks/useCategories', () => ({ useCategories }))
vi.mock('./hooks/useSettings', () => ({ useSettings }))
vi.mock('./hooks/useTransactions', () => ({ useTransactions }))

beforeEach(() => {
  useAuth.mockReturnValue({ user: { email: 'owner@example.com' }, loading: false, configured: true, error: null, signIn: vi.fn(), logOut: vi.fn() })
  useCategories.mockReturnValue({ categories: [], byId: new Map(), loading: false, error: null })
  useSettings.mockReturnValue({ settings: { currency: 'EUR', locale: 'en' }, loading: false, fromCache: false, error: null })
  useTransactions.mockReturnValue({ transactions: [], loading: false, pending: false, fromCache: false, error: null })
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('App routes', () => {
  it('loads Trends on its first visit, with the fallback inside the shell until the page is in', async () => {
    window.history.replaceState(null, '', '/trends')
    render(<App />)
    // The page's code is still on its way: the fallback holds its place in the shell, whose controls are already there.
    expect(screen.getByRole('main')).toContainElement(screen.getByText('Loading…'))
    expect(screen.getByRole('button', { name: 'Add transaction' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Trends' })).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
  })
})
