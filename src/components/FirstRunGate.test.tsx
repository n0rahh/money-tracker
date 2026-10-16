import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../context/ToastContext'
import type { Settings } from '../lib/types'
import { FirstRunGate } from './FirstRunGate'

type SettingsState = { settings: Settings | null; loading: boolean; fromCache: boolean; error: Error | null }

const { useSettings, saveSettings, seedDefaultCategories } = vi.hoisted(() => ({
  useSettings: vi.fn(),
  saveSettings: vi.fn(),
  seedDefaultCategories: vi.fn(),
}))
vi.mock('../hooks/useSettings', () => ({ useSettings }))
vi.mock('../lib/firestore', () => ({ saveSettings, seedDefaultCategories }))

/** Defaults to the first-run state: the server confirmed there is no settings document. */
const settingsState = (over: Partial<SettingsState> = {}): SettingsState => ({ settings: null, loading: false, fromCache: false, error: null, ...over })
const setup = () => render(<ToastProvider><FirstRunGate /></ToastProvider>)

beforeEach(() => {
  vi.clearAllMocks()
  useSettings.mockReturnValue(settingsState())
  saveSettings.mockResolvedValue(undefined)
  seedDefaultCategories.mockResolvedValue(25)
})

describe('FirstRunGate', () => {
  it.each<{ name: string; state: Partial<SettingsState> }>([
    { name: 'while settings load', state: { loading: true, fromCache: true } },
    { name: 'for a cached "no settings" result', state: { fromCache: true } },
    { name: 'once settings exist', state: { settings: { currency: 'EUR', locale: null } } },
  ])('renders nothing $name', ({ state }) => {
    useSettings.mockReturnValue(settingsState(state))
    const { container } = setup()
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the non-dismissible currency sheet once the server confirms there are no settings', () => {
    setup()
    const dialog = screen.getByRole('dialog', { name: 'Welcome! Pick your currency' })
    expect(within(dialog).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(within(dialog).getAllByRole('button')[0]).toHaveTextContent(/^Polish złoty/)
  })

  it('saves the choice and seeds the defaults once, ignoring a second tap before the sheet goes away', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: /^Polish złoty/ }))
    // The mocked snapshot still says "no settings", so the sheet is still there for a second tap.
    await user.click(screen.getByRole('button', { name: /^Euro/ }))
    expect(saveSettings).toHaveBeenCalledTimes(1)
    expect(saveSettings).toHaveBeenCalledWith({ currency: 'PLN', locale: null })
    expect(seedDefaultCategories).toHaveBeenCalledTimes(1)
  })

  it('reports how many default categories were added', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: /^Polish złoty/ }))
    expect(await screen.findByText('Added 25 default categories')).toBeInTheDocument()
  })
})
