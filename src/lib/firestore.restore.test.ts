import { Timestamp } from 'firebase/firestore'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { restoreTransaction } from './firestore'
import type { Transaction } from './types'

const { doc, setDoc, serverTimestamp } = vi.hoisted(() => ({
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  setDoc: vi.fn((..._args: unknown[]) => Promise.resolve()),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
}))
// Only the write and its sentinel are observed; the rest of the SDK is real (Timestamp above is the real class).
vi.mock('firebase/firestore', async (importOriginal) => ({ ...(await importOriginal<typeof import('firebase/firestore')>()), doc, setDoc, serverTimestamp }))
vi.mock('./firebase', () => ({ db: 'db' }))

/** Below a millisecond on purpose: a trip through Date would change it. */
const AT = new Timestamp(1_792_400_000, 123_456_000)
const CREATED = new Timestamp(1_791_000_000, 987_654_000)
const BY_HAND: Transaction = {
  id: 't9', kind: 'expense', amount: 350, categoryId: 'c1', note: 'flat white', date: '2026-10-01', at: AT, source: 'app',
  createdAt: CREATED, updatedAt: new Timestamp(1_791_500_000, 0),
}
const STORED = { kind: 'expense', amount: 350, categoryId: 'c1', note: 'flat white', date: '2026-10-01', at: AT, source: 'app', createdAt: CREATED }
const written = () => {
  expect(setDoc).toHaveBeenCalledTimes(1)
  const [ref, data] = setDoc.mock.calls[0] as [unknown, Record<string, unknown>]
  return { ref, data }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('restoreTransaction', () => {
  it('writes an entry added by hand back under its own id as it was read: only updatedAt is new, and no recurringId key', async () => {
    await restoreTransaction(BY_HAND)
    expect(doc).toHaveBeenCalledExactlyOnceWith('db', 'transactions', 't9')
    const { ref, data } = written()
    expect(ref).toStrictEqual({ path: 'transactions/t9' })
    expect(data).toStrictEqual({ ...STORED, updatedAt: 'SERVER_TIMESTAMP' })
    // The stored Timestamps themselves, not copies.
    expect(data.at).toBe(AT)
    expect(data.createdAt).toBe(CREATED)
  })

  it("keeps a template instance's deterministic id and its recurringId", async () => {
    await restoreTransaction({ ...BY_HAND, id: 'rec_r1_2026-10', recurringId: 'r1' })
    const { ref, data } = written()
    expect(ref).toStrictEqual({ path: 'transactions/rec_r1_2026-10' })
    expect(data).toStrictEqual({ ...STORED, recurringId: 'r1', updatedAt: 'SERVER_TIMESTAMP' })
  })

  it.each(['import', 'shortcut'] as const)('keeps the source %s', async (source) => {
    await restoreTransaction({ ...BY_HAND, source })
    expect(written().data).toStrictEqual({ ...STORED, source, updatedAt: 'SERVER_TIMESTAMP' })
  })

  it('asks the server for a createdAt when none was read (its own server time was still pending)', async () => {
    await restoreTransaction({ ...BY_HAND, createdAt: undefined })
    expect(written().data).toStrictEqual({ ...STORED, createdAt: 'SERVER_TIMESTAMP', updatedAt: 'SERVER_TIMESTAMP' })
  })

  it('hands back the write itself, so a refused Undo can be reported', async () => {
    const refused = new Error('permission-denied')
    setDoc.mockReturnValueOnce(Promise.reject(refused))
    await expect(restoreTransaction(BY_HAND)).rejects.toBe(refused)
  })
})
