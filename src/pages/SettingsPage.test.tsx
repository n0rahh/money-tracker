import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FirebaseError } from 'firebase/app'
import { Timestamp } from 'firebase/firestore'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../context/ToastContext'
import { CURRENCIES } from '../lib/currencies'
import { parseCsv } from '../lib/csv'
import type { Budget, Category, RecurringTemplate, Settings, Transaction } from '../lib/types'
import { SettingsPage } from './SettingsPage'

const OWNER = 'vlad.herasymovychh@gmail.com'
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const DESKTOP_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const { useAuth, useSettings, useRecurring, saveSettings, isStandalone, getAllTransactions, getAllCategories, getAllBudgets, getAllRecurring, shareOrDownload } =
  vi.hoisted(() => ({
    useAuth: vi.fn(),
    useSettings: vi.fn(),
    useRecurring: vi.fn(),
    saveSettings: vi.fn(),
    isStandalone: vi.fn(),
    getAllTransactions: vi.fn(),
    getAllCategories: vi.fn(),
    getAllBudgets: vi.fn(),
    getAllRecurring: vi.fn(),
    shareOrDownload: vi.fn(),
  }))
vi.mock('../context/AuthContext', () => ({ useAuth }))
vi.mock('../hooks/useSettings', () => ({ useSettings }))
vi.mock('../hooks/useRecurring', () => ({ useRecurring }))
vi.mock('../lib/firestore', () => ({ saveSettings, getAllTransactions, getAllCategories, getAllBudgets, getAllRecurring }))
vi.mock('../lib/platform', () => ({ isStandalone }))
// The files are built for real; only handing them over (share sheet or download) is replaced.
vi.mock('../lib/exporting', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/exporting')>()), shareOrDownload }))
// The sheet has tests of its own: here, only that the page opens and closes it, lazily, with the settings it needs.
vi.mock('../components/ImportSheet', () => ({
  ImportSheet: ({ currency, locale, onClose }: { currency: string; locale: string | null; onClose: () => void }) => (
    <div role="dialog" aria-label="Import CSV">
      <p>{`Importing in ${currency}, locale ${locale ?? 'of the browser'}`}</p>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}))

const logOut = vi.fn()
const GROCERIES: Category = { id: 'groceries', name: 'Groceries', icon: 'ShoppingCart', color: 'emerald', kind: 'expense', order: 0, archived: false }
const SALARY: Category = { id: 'salary', name: 'Salary', icon: 'Banknote', color: 'emerald', kind: 'income', order: 0, archived: false }
const CATEGORIES = [GROCERIES, SALARY]
const TRANSACTIONS: Transaction[] = [
  { id: 't1', kind: 'expense', amount: 1250, categoryId: 'groceries', note: 'Milk, bread', date: '2026-10-14', at: Timestamp.fromDate(new Date(2026, 9, 14, 9)), source: 'app' },
  { id: 't2', kind: 'income', amount: 500_000, categoryId: 'salary', note: '', date: '2026-10-12', at: Timestamp.fromDate(new Date(2026, 9, 12, 12)), source: 'import' },
  { id: 't3', kind: 'expense', amount: 999, categoryId: 'removed', note: '', date: '2026-10-11', at: Timestamp.fromDate(new Date(2026, 9, 11, 12)), source: 'shortcut' },
]
const BUDGETS: Budget[] = [{ categoryId: 'groceries', monthly: 80_000 }]
const RENT: RecurringTemplate = {
  id: 'r1', kind: 'expense', amount: 120_000, categoryId: 'groceries', note: 'Flat', dayOfMonth: 1, startMonth: '2026-01', endMonth: null, lastAppliedMonth: '2026-10',
}
const withSettings = (settings: Settings) => useSettings.mockReturnValue({ settings, loading: false, fromCache: false, error: null })
const withTemplates = (templates: RecurringTemplate[], loading = false) =>
  useRecurring.mockReturnValue({ templates, loading, fromCache: false, error: null })
const page = () =>
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="settings" element={<SettingsPage />} />
          <Route path="recurring" element={<p>Recurring stub</p>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  useAuth.mockReturnValue({ user: { email: OWNER }, logOut })
  logOut.mockResolvedValue(undefined)
  withSettings({ currency: 'PLN', locale: null })
  withTemplates([])
  // Never settles: the page must not wait for the write before it updates the screen.
  saveSettings.mockReturnValue(new Promise<void>(() => {}))
  isStandalone.mockReturnValue(false)
  getAllTransactions.mockResolvedValue(TRANSACTIONS)
  getAllCategories.mockResolvedValue(CATEGORIES)
  getAllBudgets.mockResolvedValue(BUDGETS)
  getAllRecurring.mockResolvedValue([RENT])
  shareOrDownload.mockResolvedValue('shared')
})

afterEach(() => {
  vi.restoreAllMocks() // the user-agent spies
  vi.unstubAllGlobals()
})

describe('SettingsPage', () => {
  it('shows the currency, who is signed in and the app version', () => {
    vi.stubGlobal('__APP_VERSION__', '0.1.0') // vite.config defines it from package.json; pinned so this test does not follow a version bump
    page()
    expect(screen.getByRole('button', { name: /^Currency/ })).toHaveTextContent('PLN')
    expect(screen.getByText(OWNER)).toBeInTheDocument()
    expect(screen.getByText('Money Tracker v0.1.0')).toBeInTheDocument()
  })

  it('signs out', async () => {
    const user = userEvent.setup()
    page()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(logOut).toHaveBeenCalledTimes(1)
  })

  it.each([
    { name: 'the reason', rejection: new Error('Firebase: Error (auth/network-request-failed).'), shown: 'Firebase: Error (auth/network-request-failed).' },
    { name: 'a generic message', rejection: 'offline', shown: 'Could not sign out' },
  ])('toasts $name when signing out fails', async ({ rejection, shown }) => {
    const user = userEvent.setup()
    logOut.mockRejectedValue(rejection)
    page()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('status')).toHaveTextContent(shown)
  })

  describe('recurring', () => {
    const running = (id: string, endMonth: string | null): RecurringTemplate => ({
      id, kind: 'expense', amount: 1_599, categoryId: 'subs', note: id, dayOfMonth: 5, startMonth: '2026-01', endMonth, lastAppliedMonth: '2026-08',
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('links to the templates and counts those that still run: no end, or an end this month or later', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(2026, 9, 19, 9, 0)) // October 2026
      withTemplates([running('open', null), running('ends-now', '2026-10'), running('ends-later', '2026-12'), running('ended', '2026-09')])
      const user = userEvent.setup()
      page()
      const link = screen.getByRole('link', { name: /^Recurring/ })
      expect(link).toHaveAttribute('href', '/recurring')
      expect(within(link).getByText('3')).toBeInTheDocument()
      await user.click(link)
      expect(screen.getByText('Recurring stub')).toBeInTheDocument()
    })

    it('counts 0 with none, and shows no number before the templates are in', () => {
      const { unmount } = page()
      expect(within(screen.getByRole('link', { name: /^Recurring/ })).getByText('0')).toBeInTheDocument()
      unmount()
      withTemplates([], true)
      page()
      const link = screen.getByRole('link', { name: /^Recurring/ })
      expect(link).toHaveTextContent(/^Recurring—$/)
    })
  })

  describe('currency', () => {
    it('saves the choice and closes the sheet at once, without waiting for the write', async () => {
      const user = userEvent.setup()
      page()
      await user.click(screen.getByRole('button', { name: /^Currency/ }))
      const dialog = screen.getByRole('dialog', { name: 'Currency' })
      expect(within(dialog).getByText('Changing the currency changes the symbol and formatting. Amounts are not converted.')).toBeInTheDocument()

      await user.click(within(dialog).getByRole('button', { name: /^Euro/ }))
      expect(saveSettings).toHaveBeenCalledWith({ currency: 'EUR', locale: null })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('closes without saving when dismissed', async () => {
      const user = userEvent.setup()
      page()
      await user.click(screen.getByRole('button', { name: /^Currency/ }))
      await user.click(within(screen.getByRole('dialog', { name: 'Currency' })).getByRole('button', { name: 'Close' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(saveSettings).not.toHaveBeenCalled()
    })

    it('starts every visit with an empty search and the full list', async () => {
      const user = userEvent.setup()
      page()
      await user.click(screen.getByRole('button', { name: /^Currency/ }))
      await user.type(screen.getByLabelText('Search currency'), 'usd')
      await user.click(screen.getByRole('button', { name: /^US dollar/ }))

      await user.click(screen.getByRole('button', { name: /^Currency/ }))
      expect(screen.getByLabelText('Search currency')).toHaveValue('')
      expect(within(screen.getByRole('dialog', { name: 'Currency' })).getAllByRole('listitem')).toHaveLength(CURRENCIES.length)
    })

    it('keeps the stored locale', async () => {
      const user = userEvent.setup()
      withSettings({ currency: 'PLN', locale: 'pl-PL' })
      page()
      await user.click(screen.getByRole('button', { name: /^Currency/ }))
      await user.click(screen.getByRole('button', { name: /^Euro/ }))
      expect(saveSettings).toHaveBeenCalledWith({ currency: 'EUR', locale: 'pl-PL' })
    })

    it.each([
      { name: 'the reason', rejection: new Error('Missing or insufficient permissions.'), shown: 'Missing or insufficient permissions.' },
      { name: 'a generic message', rejection: 'offline', shown: 'Could not save' },
    ])('toasts $name when the write is rejected, after the sheet has closed', async ({ rejection, shown }) => {
      const user = userEvent.setup()
      saveSettings.mockRejectedValue(rejection)
      page()
      await user.click(screen.getByRole('button', { name: /^Currency/ }))
      await user.click(screen.getByRole('button', { name: /^Euro/ }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(await screen.findByRole('status')).toHaveTextContent(shown)
    })

    describe('with a different number of decimals', () => {
      const WARNING =
        'Switching between currencies with a different number of decimals changes how stored amounts are read (for example 12.50 becomes ¥1,250). Continue?'
      const choose = async (name: RegExp) => {
        const user = userEvent.setup()
        page()
        await user.click(screen.getByRole('button', { name: /^Currency/ }))
        await user.click(screen.getByRole('button', { name }))
      }

      it('does not ask when the decimals match (PLN → EUR)', async () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
        await choose(/^Euro/)
        expect(confirm).not.toHaveBeenCalled()
        expect(saveSettings).toHaveBeenCalledWith({ currency: 'EUR', locale: null })
      })

      it('asks first and keeps the currency when cancelled (PLN → JPY)', async () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
        await choose(/^Japanese yen/)
        expect(confirm).toHaveBeenCalledWith(WARNING)
        expect(saveSettings).not.toHaveBeenCalled()
        expect(screen.getByRole('dialog', { name: 'Currency' })).toBeInTheDocument() // still open to pick another
      })

      it('saves once confirmed (PLN → JPY)', async () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
        await choose(/^Japanese yen/)
        expect(confirm).toHaveBeenCalledWith(WARNING)
        expect(saveSettings).toHaveBeenCalledWith({ currency: 'JPY', locale: null })
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      })
    })
  })

  describe('data', () => {
    const exportCsv = () => screen.getByRole('button', { name: /^Export CSV/ })
    const exportJson = () => screen.getByRole('button', { name: /^Export JSON/ })
    /** The file the page handed over: its name, type and content. */
    const handedOver = (call = 0) => {
      const [name, mime, content] = shareOrDownload.mock.calls[call] as [string, string, string]
      return { name, mime, content }
    }

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(2026, 9, 19, 9, 0))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('exports every entry as CSV, read once, and says how many', async () => {
      const user = userEvent.setup()
      page()
      await user.click(exportCsv())
      expect(await screen.findByRole('status')).toHaveTextContent('Exported 3 entries')
      expect(getAllTransactions).toHaveBeenCalledTimes(1)
      expect(getAllCategories).toHaveBeenCalledTimes(1)
      // A spreadsheet has no use for budgets or templates.
      expect(getAllBudgets).not.toHaveBeenCalled()
      expect(getAllRecurring).not.toHaveBeenCalled()
      const file = handedOver()
      expect(file.name).toBe('money-tracker-2026-10-19.csv')
      expect(file.mime).toBe('text/csv')
      expect(parseCsv(file.content)).toEqual([
        ['id', 'date', 'kind', 'amount', 'currency', 'category', 'note', 'source'],
        ['t1', '2026-10-14', 'expense', '12.50', 'PLN', 'Groceries', 'Milk, bread', 'app'],
        ['t2', '2026-10-12', 'income', '5000.00', 'PLN', 'Salary', '', 'import'],
        ['t3', '2026-10-11', 'expense', '9.99', 'PLN', 'Uncategorized', '', 'shortcut'],
      ])
    })

    it('exports a JSON backup with categories, budgets and recurring templates', async () => {
      const user = userEvent.setup()
      withSettings({ currency: 'EUR', locale: 'de-DE' })
      shareOrDownload.mockResolvedValue('downloaded')
      page()
      await user.click(exportJson())
      expect(await screen.findByRole('status')).toHaveTextContent('Exported 3 entries')
      for (const read of [getAllTransactions, getAllCategories, getAllBudgets, getAllRecurring]) expect(read).toHaveBeenCalledTimes(1)
      const file = handedOver()
      expect(file.name).toBe('money-tracker-2026-10-19.json')
      expect(file.mime).toBe('application/json')
      const backup = JSON.parse(file.content) as Record<string, unknown[]>
      expect(backup.currency).toBe('EUR')
      expect(backup.transactions.map((t) => (t as Transaction).id)).toEqual(['t1', 't2', 't3'])
      expect(backup.categories).toHaveLength(2)
      expect(backup.budgets).toEqual([{ categoryId: 'groceries', monthly: 80_000 }])
      expect(backup.recurring.map((t) => (t as RecurringTemplate).id)).toEqual(['r1'])
    })

    it('says 1 entry for one', async () => {
      const user = userEvent.setup()
      getAllTransactions.mockResolvedValue(TRANSACTIONS.slice(0, 1))
      page()
      await user.click(exportCsv())
      expect(await screen.findByRole('status')).toHaveTextContent('Exported 1 entry')
    })

    it('shows that it is busy while it reads, and takes no second export meanwhile', async () => {
      let resolve: (txs: Transaction[]) => void = () => {}
      getAllTransactions.mockReturnValue(
        new Promise<Transaction[]>((r) => {
          resolve = r
        }),
      )
      const user = userEvent.setup()
      page()
      await user.click(exportCsv())
      expect(exportCsv()).toHaveTextContent('Exporting…')
      expect(exportCsv()).toBeDisabled()
      expect(exportJson()).toBeDisabled()
      await user.click(exportJson())
      expect(getAllTransactions).toHaveBeenCalledTimes(1)

      resolve(TRANSACTIONS)
      expect(await screen.findByRole('status')).toHaveTextContent('Exported 3 entries')
      expect(exportCsv()).toBeEnabled()
      expect(exportCsv()).not.toHaveTextContent('Exporting…')
      expect(shareOrDownload).toHaveBeenCalledTimes(1)
    })

    it.each([
      { name: 'a read error', rejection: new FirebaseError('permission-denied', 'Missing or insufficient permissions.'), shown: "Could not export: You don't have access to this data (signed in with the wrong account?)" },
      { name: 'being offline', rejection: new FirebaseError('unavailable', 'Failed to get documents from server.'), shown: 'Could not export while offline' },
      { name: 'something odd', rejection: 'boom', shown: 'Could not export' },
    ])('toasts $name and is ready again', async ({ rejection, shown }) => {
      getAllTransactions.mockRejectedValue(rejection)
      const user = userEvent.setup()
      page()
      await user.click(exportCsv())
      expect(await screen.findByRole('status')).toHaveTextContent(shown)
      expect(shareOrDownload).not.toHaveBeenCalled()
      expect(exportCsv()).toBeEnabled()
    })

    it('says nothing when the share sheet is dismissed', async () => {
      shareOrDownload.mockRejectedValue(new DOMException('Share canceled', 'AbortError'))
      const user = userEvent.setup()
      page()
      await user.click(exportCsv())
      await waitFor(() => expect(exportCsv()).toBeEnabled())
      expect(shareOrDownload).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    it('offers a Share button when the browser wants a fresh tap to open the share sheet', async () => {
      // iOS opens the share sheet only right after a tap, and reading every entry can take longer than that.
      shareOrDownload.mockRejectedValueOnce(new DOMException('Not allowed', 'NotAllowedError')).mockResolvedValueOnce('shared')
      const user = userEvent.setup()
      page()
      await user.click(exportCsv())
      const toast = await screen.findByRole('status')
      expect(toast).toHaveTextContent('3 entries ready to export')
      await user.click(within(toast).getByRole('button', { name: 'Share' }))
      expect(await screen.findByText('Exported 3 entries')).toBeInTheDocument()
      expect(shareOrDownload).toHaveBeenCalledTimes(2)
      expect(handedOver(1)).toEqual(handedOver(0))
      expect(getAllTransactions).toHaveBeenCalledTimes(1) // the second tap reads nothing again
    })

    it('keeps the Share toast for ten seconds', async () => {
      const timers = vi.spyOn(window, 'setTimeout')
      shareOrDownload.mockRejectedValueOnce(new DOMException('Not allowed', 'NotAllowedError'))
      const user = userEvent.setup()
      page()
      await user.click(exportCsv())
      await screen.findByRole('button', { name: 'Share' })
      expect(timers.mock.calls.map(([, ms]) => ms)).toContain(10_000)
    })

    it('toasts a share that fails for another reason, and is ready again', async () => {
      shareOrDownload.mockRejectedValue(new TypeError('Invalid share data'))
      const user = userEvent.setup()
      page()
      await user.click(exportCsv())
      expect(await screen.findByRole('status')).toHaveTextContent('Could not export: Invalid share data')
      expect(exportCsv()).toBeEnabled()
    })

    it('toasts a retry from the Share button that fails', async () => {
      shareOrDownload.mockRejectedValueOnce(new DOMException('Not allowed', 'NotAllowedError')).mockRejectedValueOnce(new TypeError('Share failed again'))
      const user = userEvent.setup()
      page()
      await user.click(exportCsv())
      const toast = await screen.findByRole('status')
      await user.click(within(toast).getByRole('button', { name: 'Share' }))
      expect(await screen.findByText('Could not export: Share failed again')).toBeInTheDocument()
    })

    it('is busy while it reads only: the rows are back while the share sheet is still open', async () => {
      shareOrDownload.mockReturnValue(new Promise(() => {}))
      const user = userEvent.setup()
      page()
      await user.click(exportCsv())
      await waitFor(() => expect(shareOrDownload).toHaveBeenCalledTimes(1))
      expect(exportCsv()).toBeEnabled()
      expect(exportCsv()).not.toHaveTextContent('Exporting…')
      expect(exportJson()).toBeEnabled()
    })

    it('opens the import sheet, loaded on demand, with the currency and locale, and closes it', async () => {
      const user = userEvent.setup()
      withSettings({ currency: 'PLN', locale: 'pl-PL' })
      page()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Import CSV' }))
      const sheet = await screen.findByRole('dialog', { name: 'Import CSV' })
      expect(sheet).toHaveTextContent('Importing in PLN, locale pl-PL')
      await user.click(within(sheet).getByRole('button', { name: 'Close' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('offers export and import only once the settings are in', () => {
      useSettings.mockReturnValue({ settings: null, loading: true, fromCache: true, error: null })
      page()
      expect(exportCsv()).toBeDisabled()
      expect(exportJson()).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Import CSV' })).toBeDisabled()
    })

    it('says what each export is for', () => {
      page()
      expect(screen.getByText('CSV opens in a spreadsheet. JSON is a full backup, with categories, budgets and recurring entries.')).toBeInTheDocument()
    })
  })

  describe('install hint', () => {
    it('shows on an iPhone that has not installed the app', () => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE_SAFARI)
      page()
      expect(screen.getByText('Install as an app')).toBeInTheDocument()
    })

    it('is gone once the app runs from the home screen', () => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE_SAFARI)
      isStandalone.mockReturnValue(true)
      page()
      expect(screen.queryByText('Install as an app')).not.toBeInTheDocument()
    })

    it('is not shown outside iOS', () => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(DESKTOP_CHROME)
      page()
      expect(screen.queryByText('Install as an app')).not.toBeInTheDocument()
    })
  })
})
