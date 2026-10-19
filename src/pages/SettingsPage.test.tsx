import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../context/ToastContext'
import { CURRENCIES } from '../lib/currencies'
import type { RecurringTemplate, Settings } from '../lib/types'
import { SettingsPage } from './SettingsPage'

const OWNER = 'vlad.herasymovychh@gmail.com'
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const DESKTOP_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const { useAuth, useSettings, useRecurring, saveSettings, isStandalone } = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useSettings: vi.fn(),
  useRecurring: vi.fn(),
  saveSettings: vi.fn(),
  isStandalone: vi.fn(),
}))
vi.mock('../context/AuthContext', () => ({ useAuth }))
vi.mock('../hooks/useSettings', () => ({ useSettings }))
vi.mock('../hooks/useRecurring', () => ({ useRecurring }))
vi.mock('../lib/firestore', () => ({ saveSettings }))
vi.mock('../lib/platform', () => ({ isStandalone }))

const logOut = vi.fn()
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
