import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Timestamp } from 'firebase/firestore'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('shows a failed month query as its error alone under the summary, not as an empty month', () => {
    withSettingsLoaded()
    render(page())
    fail(new Error('Missing or insufficient permissions.'))
    const message = screen.getByText('Missing or insufficient permissions.')
    expect(screen.getByText('Spent').compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText(/^Nothing in/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add your first entry' })).not.toBeInTheDocument()
  })

  it('reaches future months, so an entry saved with a wrong date can be found', async () => {
    const user = userEvent.setup()
    withSettingsLoaded()
    render(page())
    const next = screen.getByRole('button', { name: 'Next month' })
    expect(next).toBeEnabled()
    await user.click(next)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(monthLabel(addMonths(currentMonth(), 1), 'en'))
    const future = monthRange(addMonths(currentMonth(), 1))
    expect(subscribeTransactionsInRange).toHaveBeenLastCalledWith(future.from, future.to, expect.any(Function), expect.any(Function))
  })

  describe('on a return to the foreground', () => {
    const heading = () => screen.getByRole('heading', { level: 1 })
    /** The phone sat locked: the clock moves on, then the page turns visible again. */
    const resumeAt = (now: Date) => {
      vi.setSystemTime(now)
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
    }

    beforeEach(() => {
      // Only the clock: Testing Library's async wrapper (behind userEvent) waits on a real setTimeout that faked timers would freeze.
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(2026, 9, 31, 23, 0))
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
      withSettingsLoaded()
    })

    afterEach(() => {
      vi.useRealTimers()
      vi.restoreAllMocks() // the visibilityState spy
    })

    it('follows the calendar into the new month while the current month is shown', () => {
      render(page())
      expect(heading()).toHaveTextContent('October 2026')
      resumeAt(new Date(2026, 10, 1, 9, 0))
      expect(heading()).toHaveTextContent('November 2026')
      expect(subscribeTransactionsInRange).toHaveBeenLastCalledWith('2026-11-01', '2026-11-30', expect.any(Function), expect.any(Function))
    })

    it('stays on a month picked on purpose', async () => {
      const user = userEvent.setup()
      render(page())
      await user.click(screen.getByRole('button', { name: 'Previous month' }))
      resumeAt(new Date(2026, 10, 1, 9, 0))
      expect(heading()).toHaveTextContent('September 2026')
    })

    it('follows again once the current month is picked again', async () => {
      const user = userEvent.setup()
      render(page())
      await user.click(screen.getByRole('button', { name: 'Previous month' }))
      await user.click(screen.getByRole('button', { name: 'Next month' }))
      resumeAt(new Date(2026, 10, 1, 9, 0))
      expect(heading()).toHaveTextContent('November 2026')
    })

    it('moves "Today" and "Yesterday" on after midnight', () => {
      vi.setSystemTime(new Date(2026, 9, 15, 23, 0))
      render(page())
      deliver([{ ...FLAT_WHITE, date: '2026-10-15' }])
      expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument()
      resumeAt(new Date(2026, 9, 16, 9, 0))
      expect(screen.getByRole('heading', { name: 'Yesterday' })).toBeInTheDocument()
    })
  })
})
