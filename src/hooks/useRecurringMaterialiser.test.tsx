import { act, renderHook, screen } from '@testing-library/react'
import { FirebaseError } from 'firebase/app'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../context/ToastContext'
import { mapRecurring } from '../lib/mappers'
import type { RecurringTemplate } from '../lib/types'
import { useRecurringMaterialiser } from './useRecurringMaterialiser'

// The clock (Date only) reads Monday 19 Oct 2026 below.
/** Last written for August: owes September and October. */
const RENT: RecurringTemplate = {
  id: 'r1', kind: 'expense', amount: 120_000, categoryId: 'rent', note: 'Flat', dayOfMonth: 1, startMonth: '2026-01', endMonth: null, lastAppliedMonth: '2026-08',
}
/** New this month and never written: owes October. */
const NETFLIX: RecurringTemplate = {
  id: 'r2', kind: 'expense', amount: 1_599, categoryId: 'subs', note: 'Netflix', dayOfMonth: 31, startMonth: '2026-10', endMonth: null, lastAppliedMonth: null,
}
/** Up to date. */
const PAY: RecurringTemplate = {
  id: 'r3', kind: 'income', amount: 500_000, categoryId: 'salary', note: '', dayOfMonth: 25, startMonth: '2026-03', endMonth: null, lastAppliedMonth: '2026-10',
}
/** Starts in December: nothing is due yet. */
const LATER: RecurringTemplate = { ...NETFLIX, id: 'r4', startMonth: '2026-12' }

const { materialiseRecurring, useRecurring } = vi.hoisted(() => ({ materialiseRecurring: vi.fn(), useRecurring: vi.fn() }))
vi.mock('../lib/firestore', () => ({ materialiseRecurring }))
vi.mock('./useRecurring', () => ({ useRecurring }))

type Snapshot = { templates: RecurringTemplate[]; loading?: boolean; fromCache?: boolean; error?: Error | null }
/** What useRecurring answers: by default a list the server has confirmed. */
const withTemplates = ({ templates, loading = false, fromCache = false, error = null }: Snapshot) =>
  useRecurring.mockReturnValue({ templates, loading, fromCache, error })

const wrapper = ({ children }: { children: ReactNode }) => <ToastProvider>{children}</ToastProvider>
const mount = (options: { reactStrictMode?: boolean } = {}) => renderHook(() => useRecurringMaterialiser(), { wrapper, ...options })
/** The app comes back to the foreground: the real useVisibilityTick counts it. */
const resume = () =>
  act(() => {
    window.dispatchEvent(new Event('focus'))
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 19, 9, 0))
  materialiseRecurring.mockReturnValue(new Promise<void>(() => {})) // never settles: offline, and never waited for
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useRecurringMaterialiser', () => {
  it('writes the owed months of every template, one call per template, oldest month first, without waiting for any', () => {
    withTemplates({ templates: [RENT, NETFLIX, PAY, LATER] })
    mount()
    // Both are issued although neither write has settled; the up-to-date and not-yet-due templates are left alone.
    expect(materialiseRecurring).toHaveBeenCalledTimes(2)
    expect(materialiseRecurring).toHaveBeenCalledWith(RENT, ['2026-09', '2026-10'])
    expect(materialiseRecurring).toHaveBeenCalledWith(NETFLIX, ['2026-10'])
  })

  it('does not issue the same work again before the snapshot catches up: not on a tick, a re-render or an unchanged snapshot', () => {
    withTemplates({ templates: [RENT, NETFLIX] })
    const { rerender } = mount()
    resume()
    rerender()
    withTemplates({ templates: [{ ...RENT }, { ...NETFLIX }] }) // a fresh list with the same state, such as a metadata-only snapshot
    rerender()
    resume()
    expect(materialiseRecurring).toHaveBeenCalledTimes(2)
  })

  it("issues each template's work once under StrictMode's doubled effects", () => {
    withTemplates({ templates: [RENT, NETFLIX] })
    mount({ reactStrictMode: true })
    expect(materialiseRecurring).toHaveBeenCalledTimes(2)
  })

  it('carries on where the last write stopped: 30 owed months go out as 24, then the remaining 6', () => {
    const behind: RecurringTemplate = { ...RENT, startMonth: '2024-05', lastAppliedMonth: null }
    withTemplates({ templates: [behind] })
    const { rerender } = mount()
    expect(materialiseRecurring).toHaveBeenCalledTimes(1)
    const [, first] = materialiseRecurring.mock.calls[0] as [RecurringTemplate, string[]]
    expect(first).toHaveLength(24)
    expect(first[0]).toBe('2024-05')
    expect(first.at(-1)).toBe('2026-04')

    // The batch's lastAppliedMonth reaches the snapshot.
    const halfway = { ...behind, lastAppliedMonth: '2026-04' }
    withTemplates({ templates: [halfway] })
    rerender()
    expect(materialiseRecurring).toHaveBeenCalledTimes(2)
    expect(materialiseRecurring).toHaveBeenLastCalledWith(halfway, ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])

    withTemplates({ templates: [{ ...behind, lastAppliedMonth: '2026-10' }] })
    rerender()
    expect(materialiseRecurring).toHaveBeenCalledTimes(2)
  })

  it('acts only on a list the server has confirmed: nothing while loading or while the list comes from the cache only', () => {
    withTemplates({ templates: [], loading: true })
    const { rerender } = mount()
    withTemplates({ templates: [RENT], fromCache: true }) // the cached list of an offline launch
    rerender()
    resume()
    expect(materialiseRecurring).not.toHaveBeenCalled()

    withTemplates({ templates: [RENT] }) // back online: the server's answer
    rerender()
    expect(materialiseRecurring).toHaveBeenCalledTimes(1)
    expect(materialiseRecurring).toHaveBeenCalledWith(RENT, ['2026-09', '2026-10'])
  })

  it('waits while the list is loading, whatever fromCache says', () => {
    // useRecurring never reports this pair (fromCache starts true), but the gate must not lean on that.
    withTemplates({ templates: [RENT], loading: true, fromCache: false })
    mount()
    resume()
    expect(materialiseRecurring).not.toHaveBeenCalled()
  })

  it('does nothing once the subscription has failed, even with templates from an earlier snapshot', () => {
    withTemplates({ templates: [RENT], error: new FirebaseError('permission-denied', 'Missing or insufficient permissions.') })
    mount()
    resume()
    expect(materialiseRecurring).not.toHaveBeenCalled()
  })

  it('skips a template it could never write, and still writes the others', () => {
    const noAmount: RecurringTemplate = { ...NETFLIX, id: 'r9', amount: 0 }
    const noCategory: RecurringTemplate = { ...NETFLIX, id: 'r8', categoryId: '' }
    withTemplates({ templates: [noAmount, RENT, noCategory] })
    mount()
    expect(materialiseRecurring).toHaveBeenCalledTimes(1)
    expect(materialiseRecurring).toHaveBeenCalledWith(RENT, ['2026-09', '2026-10'])
  })

  it.each(['2026/08', '2026-8', 202608])(
    'sends nothing for a template whose lastAppliedMonth reads %j (a hand edit), rather than writing every month again from its start',
    (typo) => {
      // As the app reads such a document: the month as stored, not "never applied", which would owe January to October.
      const { id: _id, ...fields } = RENT
      const edited = mapRecurring('r7', { ...fields, lastAppliedMonth: typo })
      withTemplates({ templates: [edited, NETFLIX] })
      mount()
      expect(materialiseRecurring).toHaveBeenCalledTimes(1)
      expect(materialiseRecurring).toHaveBeenCalledWith(NETFLIX, ['2026-10'])
    },
  )

  it('picks up a new month when the app comes back to the foreground in it, once', () => {
    vi.setSystemTime(new Date(2026, 9, 31, 23, 50))
    withTemplates({ templates: [PAY] })
    mount()
    expect(materialiseRecurring).not.toHaveBeenCalled()

    vi.setSystemTime(new Date(2026, 10, 1, 8, 0)) // the next morning, in November
    resume()
    expect(materialiseRecurring).toHaveBeenCalledTimes(1)
    expect(materialiseRecurring).toHaveBeenCalledWith(PAY, ['2026-11'])
    resume()
    expect(materialiseRecurring).toHaveBeenCalledTimes(1)
  })

  it('explains a failed write in a toast and leaves the retry to the next launch', async () => {
    materialiseRecurring.mockImplementation(() => Promise.reject(new FirebaseError('permission-denied', 'Missing or insufficient permissions.')))
    withTemplates({ templates: [RENT] })
    mount()
    expect(await screen.findByRole('status')).toHaveTextContent(
      "Could not add the repeating entries: You don't have access to this data (signed in with the wrong account?)",
    )
    // The rolled-back snapshot still owes the same months: not issued again in this session.
    withTemplates({ templates: [{ ...RENT }] })
    resume()
    expect(materialiseRecurring).toHaveBeenCalledTimes(1)
  })

  it('says only that it failed when the rejection carries no error to explain', async () => {
    materialiseRecurring.mockImplementation(() => Promise.reject('offline'))
    withTemplates({ templates: [RENT] })
    mount()
    expect(await screen.findByRole('status')).toHaveTextContent(/^Could not add the repeating entries$/)
  })
})
