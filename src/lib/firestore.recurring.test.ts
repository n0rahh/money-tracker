import { Timestamp } from 'firebase/firestore'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRecurringWithFirstInstance, deleteRecurring, materialiseRecurring, restoreRecurring, subscribeRecurring, updateRecurring } from './firestore'
import type { RecurringInput, RecurringTemplate } from './types'

type Ref = { id: string; path: string }
type Op = { kind: 'set' | 'update'; path: string; data: Record<string, unknown> }
const sdk = vi.hoisted(() => ({
  SERVER: { sentinel: 'serverTimestamp' },
  autoIds: 0,
  batches: [] as { db: unknown; ops: Op[] }[],
  commit: vi.fn((): Promise<void> => Promise.resolve()),
  setDoc: vi.fn((..._args: unknown[]): Promise<void> => Promise.resolve()),
  updateDoc: vi.fn((..._args: unknown[]): Promise<void> => Promise.resolve()),
  deleteDoc: vi.fn((..._args: unknown[]): Promise<void> => Promise.resolve()),
  onSnapshot: vi.fn((..._args: unknown[]) => () => {}),
}))
// Only the writes, the listener and the server-time sentinel are observed; the rest of the SDK is real (Timestamp is the real class).
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  collection: (_db: unknown, path: string) => ({ collectionPath: path }),
  // doc(collection) makes a new id, as the SDK does; doc(db, ...segments) names one.
  doc: (parent: unknown, ...segments: string[]): Ref => {
    if (typeof parent === 'object' && parent !== null && 'collectionPath' in parent) {
      const id = `auto${++sdk.autoIds}`
      return { id, path: `${(parent as { collectionPath: string }).collectionPath}/${id}` }
    }
    return { id: segments[segments.length - 1], path: segments.join('/') }
  },
  serverTimestamp: () => sdk.SERVER,
  setDoc: sdk.setDoc,
  updateDoc: sdk.updateDoc,
  deleteDoc: sdk.deleteDoc,
  onSnapshot: sdk.onSnapshot,
  writeBatch: (db: unknown) => {
    const ops: Op[] = []
    sdk.batches.push({ db, ops })
    return {
      set: (ref: Ref, data: Record<string, unknown>) => void ops.push({ kind: 'set', path: ref.path, data }),
      update: (ref: Ref, data: Record<string, unknown>) => void ops.push({ kind: 'update', path: ref.path, data }),
      commit: sdk.commit,
    }
  },
}))
vi.mock('./firebase', () => ({ db: 'db' }))

const SERVER = sdk.SERVER
/** What the Add sheet hands over: rent on the 31st from February 2026, with no end. */
const INPUT: RecurringInput = { kind: 'expense', amount: 120_000, categoryId: 'rent', note: 'Flat', dayOfMonth: 31, startMonth: '2026-02', endMonth: null }
/** Stored, read back with its own Timestamps (below a millisecond on purpose: a trip through Date would change them). */
const RENT: RecurringTemplate = {
  ...INPUT, id: 'r1', startMonth: '2026-01', lastAppliedMonth: '2026-08',
  createdAt: new Timestamp(1_767_000_000, 123_456_000), updatedAt: new Timestamp(1_786_000_000, 654_321_000),
}
/** The entry document of a template for a month, as both write paths must produce it. */
const entryOf = (t: { id: string; kind: string; amount: number; categoryId: string; note: string }, date: string) => ({
  kind: t.kind, amount: t.amount, categoryId: t.categoryId, note: t.note, date, at: expect.any(Timestamp), recurringId: t.id, source: 'app',
  createdAt: SERVER, updatedAt: SERVER,
})
const noonOf = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0, 0)
}
/** Neither may reach a write: Firestore refuses undefined, and the rules refuse null where a field is optional. */
const expectNoNullish = (data: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(data)) expect(value === undefined || value === null ? key : null).toBeNull()
}

beforeEach(() => {
  vi.clearAllMocks()
  sdk.autoIds = 0
  sdk.batches.length = 0
})

describe('createRecurringWithFirstInstance', () => {
  it('writes the template, already applied for its start month, and that month\'s entry in ONE batch, and hands back the new id', async () => {
    const { id, done } = createRecurringWithFirstInstance(INPUT)
    await done
    expect(id).toBe('auto1')
    expect(sdk.batches).toHaveLength(1)
    expect(sdk.commit).toHaveBeenCalledTimes(1)
    const [batch] = sdk.batches
    expect(batch.db).toBe('db')
    expect(batch.ops.map((op) => [op.kind, op.path])).toEqual([
      ['set', 'recurring/auto1'],
      ['set', 'transactions/rec_auto1_2026-02'],
    ])
    const [template, entry] = batch.ops
    // endMonth written as null, not left out; lastAppliedMonth already the start month, so no snapshot owes it.
    expect(template.data).toStrictEqual({ ...INPUT, endMonth: null, lastAppliedMonth: '2026-02', createdAt: SERVER, updatedAt: SERVER })
    expect(entry.data).toStrictEqual(entryOf({ ...INPUT, id: 'auto1' }, '2026-02-28')) // day 31 in a February of 28 days
    expect((entry.data.at as Timestamp).toDate()).toEqual(noonOf('2026-02-28'))
    expectNoNullish(entry.data)
    // Nothing outside the batch.
    expect(sdk.setDoc).not.toHaveBeenCalled()
    expect(sdk.updateDoc).not.toHaveBeenCalled()
  })

  it("hands back the batch's own promise, so a refused template (and with it its entry) can be reported", async () => {
    const refused = new Error('permission-denied')
    sdk.commit.mockReturnValueOnce(Promise.reject(refused))
    await expect(createRecurringWithFirstInstance(INPUT).done).rejects.toBe(refused)
  })

  it('writes the same entry document as materialiseRecurring does for that template and month', async () => {
    const { id } = createRecurringWithFirstInstance(INPUT)
    await materialiseRecurring({ ...INPUT, id, lastAppliedMonth: null }, ['2026-02'])
    const first = sdk.batches[0].ops[1]
    const again = sdk.batches[1].ops[0]
    expect(again.path).toBe(first.path)
    expect(again.data).toStrictEqual(first.data)
  })
})

describe('materialiseRecurring', () => {
  it('one batch: a plain set per month under its deterministic id, then the template moved to the last month, one commit', async () => {
    await materialiseRecurring(RENT, ['2026-09', '2026-10', '2026-11'])
    expect(sdk.batches).toHaveLength(1)
    expect(sdk.commit).toHaveBeenCalledTimes(1)
    const [batch] = sdk.batches
    expect(batch.db).toBe('db')
    expect(batch.ops.map((op) => [op.kind, op.path])).toEqual([
      ['set', 'transactions/rec_r1_2026-09'],
      ['set', 'transactions/rec_r1_2026-10'],
      ['set', 'transactions/rec_r1_2026-11'],
      ['update', 'recurring/r1'],
    ])
    const [sep, oct, nov, template] = batch.ops
    expect(sep.data).toStrictEqual(entryOf(RENT, '2026-09-30'))
    expect(oct.data).toStrictEqual(entryOf(RENT, '2026-10-31'))
    expect(nov.data).toStrictEqual(entryOf(RENT, '2026-11-30'))
    expect((oct.data.at as Timestamp).toDate()).toEqual(noonOf('2026-10-31'))
    for (const op of [sep, oct, nov]) expectNoNullish(op.data)
    expect(template.data).toStrictEqual({ lastAppliedMonth: '2026-11', updatedAt: SERVER })
  })

  it('writes nothing for no months', async () => {
    await expect(materialiseRecurring(RENT, [])).resolves.toBeUndefined()
    expect(sdk.batches).toHaveLength(0)
    expect(sdk.commit).not.toHaveBeenCalled()
  })

  it("hands back the batch's own promise, so the materialiser can report a refusal", async () => {
    const refused = new Error('permission-denied')
    sdk.commit.mockReturnValueOnce(Promise.reject(refused))
    await expect(materialiseRecurring(RENT, ['2026-09'])).rejects.toBe(refused)
  })
})

describe('restoreRecurring', () => {
  const written = () => {
    expect(sdk.setDoc).toHaveBeenCalledTimes(1)
    const [ref, data] = sdk.setDoc.mock.calls[0] as [Ref, Record<string, unknown>]
    return { ref, data }
  }

  it('writes the template back under its own id as it was read: its own createdAt, only updatedAt new', async () => {
    await restoreRecurring({ ...RENT, endMonth: '2026-12' })
    const { ref, data } = written()
    expect(ref.path).toBe('recurring/r1')
    expect(data).toStrictEqual({
      kind: 'expense', amount: 120_000, categoryId: 'rent', note: 'Flat', dayOfMonth: 31, startMonth: '2026-01', endMonth: '2026-12', lastAppliedMonth: '2026-08',
      createdAt: RENT.createdAt, updatedAt: SERVER,
    })
    expect(data.createdAt).toBe(RENT.createdAt) // the stored Timestamp itself, not a copy
  })

  it('writes an open end and a never-applied template as explicit nulls, which the rules require', async () => {
    await restoreRecurring({ ...RENT, endMonth: null, lastAppliedMonth: null })
    const { data } = written()
    expect(Object.keys(data)).toEqual(expect.arrayContaining(['endMonth', 'lastAppliedMonth']))
    expect(data.endMonth).toBeNull()
    expect(data.lastAppliedMonth).toBeNull()
  })

  it('asks the server for a createdAt when none was read (its own server time was still pending)', async () => {
    await restoreRecurring({ ...RENT, createdAt: undefined })
    expect(written().data.createdAt).toBe(SERVER)
  })
})

describe('updateRecurring and deleteRecurring', () => {
  it("Stop's patch: the end month and a new updatedAt, nothing else", async () => {
    await updateRecurring('r1', { endMonth: '2026-10' })
    expect(sdk.updateDoc).toHaveBeenCalledTimes(1)
    const [ref, data] = sdk.updateDoc.mock.calls[0] as [Ref, Record<string, unknown>]
    expect(ref.path).toBe('recurring/r1')
    expect(data).toStrictEqual({ endMonth: '2026-10', updatedAt: SERVER })
  })

  it('keeps an explicit null (no end again), never turning it into a removed field', async () => {
    await updateRecurring('r1', { endMonth: null })
    const [, data] = sdk.updateDoc.mock.calls[0] as [Ref, Record<string, unknown>]
    expect(data).toStrictEqual({ endMonth: null, updatedAt: SERVER })
  })

  it('deletes the template document only', async () => {
    await deleteRecurring('r1')
    expect(sdk.deleteDoc).toHaveBeenCalledTimes(1)
    expect((sdk.deleteDoc.mock.calls[0] as [Ref])[0].path).toBe('recurring/r1')
  })
})

describe('subscribeRecurring', () => {
  it('listens with metadata changes and passes fromCache with the templates, sorted by start month and day', () => {
    const onData = vi.fn()
    const onError = vi.fn()
    subscribeRecurring(onData, onError)
    expect(sdk.onSnapshot).toHaveBeenCalledTimes(1)
    const [target, options, next, fail] = sdk.onSnapshot.mock.calls[0] as [{ collectionPath: string }, unknown, (snap: unknown) => void, (e: Error) => void]
    expect(target).toEqual({ collectionPath: 'recurring' })
    expect(options).toStrictEqual({ includeMetadataChanges: true })
    const stored = (id: string, startMonth: string, dayOfMonth: number) => ({
      id, data: () => ({ kind: 'expense', amount: 1, categoryId: 'c', note: '', dayOfMonth, startMonth, endMonth: null, lastAppliedMonth: null }),
    })
    next({ docs: [stored('b', '2026-03', 5), stored('a', '2026-01', 20), stored('c', '2026-03', 1)], metadata: { fromCache: true } })
    expect(onData).toHaveBeenCalledTimes(1)
    const [templates, fromCache] = onData.mock.lastCall as [RecurringTemplate[], boolean]
    expect(templates.map((t) => t.id)).toEqual(['a', 'c', 'b'])
    expect(fromCache).toBe(true)
    next({ docs: [], metadata: { fromCache: false } })
    expect(onData).toHaveBeenLastCalledWith([], false)
    const denied = new Error('permission-denied')
    fail(denied)
    expect(onError).toHaveBeenCalledWith(denied)
  })
})
