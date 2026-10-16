import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Timestamp } from 'firebase/firestore'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AddSheetProvider } from '../context/AddSheetContext'
import { addMonths, currentMonth, monthLabel, monthRange, todayIso } from '../lib/dates'
import type { Category, Transaction } from '../lib/types'
import { HomePage } from './HomePage'

const COFFEE: Category = { id: 'c1', name: 'Coffee', icon: 'Coffee', color: 'amber', kind: 'expense', order: 0, archived: false }
const FLAT_WHITE: Transaction = { id: 't1', kind: 'expense', amount: 350, categoryId: 'c1', note: 'flat white', date: todayIso(), at: Timestamp.now(), source: 'app' }

const { subscribeTransactionsInRange, useSettings } = vi.hoisted(() => ({
  subscribeTransactionsInRange: vi.fn(),
  useSettings: vi.fn(),
}))
// The real useTransactions runs on top of this, so its reset on a month change is under test too.
vi.mock('../lib/firestore', () => ({ subscribeTransactionsInRange }))
vi.mock('../hooks/useCategories', () => ({
  useCategories: () => ({ categories: [COFFEE], byId: new Map([[COFFEE.id, COFFEE]]), loading: false, error: null }),
}))
vi.mock('../hooks/useSettings', () => ({ useSettings }))

const page = () => <AddSheetProvider><HomePage /></AddSheetProvider>
/** Answers the newest transactions subscription with rows (and the snapshot's hasPendingWrites), or with an error. */
const deliver = (rows: Transaction[], hasPendingWrites = false) => act(() => subscribeTransactionsInRange.mock.lastCall?.[2](rows, hasPendingWrites))
const fail = (e: Error) => act(() => subscribeTransactionsInRange.mock.lastCall?.[3](e))
const withSettingsLoaded = () => useSettings.mockReturnValue({ settings: { currency: 'EUR', locale: 'en' }, loading: false, fromCache: false, error: null })

beforeEach(() => {
  vi.clearAllMocks()
  subscribeTransactionsInRange.mockReturnValue(() => {})
})

describe('HomePage', () => {
  it('shows no amounts before the currency is known and nothing from one month under another', async () => {
    const user = userEvent.setup()
    useSettings.mockReturnValue({ settings: null, loading: true, fromCache: true, error: null })
    const { rerender } = render(page())
    deliver([FLAT_WHITE]) // rows may arrive before the settings snapshot
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByText('Spent')).not.toBeInTheDocument()
    expect(screen.queryByText(/[$€]/)).not.toBeInTheDocument()

    withSettingsLoaded()
    rerender(page())
    expect(screen.getByRole('button', { name: /coffee.*€3\.50/i })).toBeInTheDocument()
    fail(new Error('boom'))
    expect(screen.getByText('boom')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    const previous = monthRange(addMonths(currentMonth(), -1))
    expect(subscribeTransactionsInRange).toHaveBeenLastCalledWith(previous.from, previous.to, expect.any(Function), expect.any(Function))
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /coffee/i })).not.toBeInTheDocument()
    expect(screen.queryByText('€3.50')).not.toBeInTheDocument() // no stale totals in the summary either
    expect(screen.queryByText('boom')).not.toBeInTheDocument()

    deliver([])
    expect(screen.getByText(`Nothing in ${monthLabel(addMonths(currentMonth(), -1), 'en')}`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add your first entry' })).toBeInTheDocument()
  })

  it('shows "Syncing…" while the month holds unacknowledged writes and hides it once they are synced', () => {
    withSettingsLoaded()
    render(page())
    deliver([FLAT_WHITE], true) // added offline: on screen at once, not yet on the server
    expect(screen.getByRole('button', { name: /coffee.*€3\.50/i })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Syncing…')

    deliver([FLAT_WHITE], false) // the server acknowledged it
    expect(screen.queryByText('Syncing…')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /coffee.*€3\.50/i })).toBeInTheDocument()
  })

  it('drops "Syncing…" when the month changes or its query fails', async () => {
    const user = userEvent.setup()
    withSettingsLoaded()
    render(page())
    deliver([FLAT_WHITE], true)
    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.queryByText('Syncing…')).not.toBeInTheDocument() // before the new month's first snapshot

    deliver([], true)
    expect(screen.getByText('Syncing…')).toBeInTheDocument()
    fail(new Error('Missing or insufficient permissions.'))
    expect(screen.queryByText('Syncing…')).not.toBeInTheDocument() // the listener is gone; nothing would clear it later
  })
})
