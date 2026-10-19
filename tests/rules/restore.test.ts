// Undo after a delete, end to end: the app's own restoreTransaction against the real rules. Only the app's Firebase set-up is
// swapped for the owner's emulator client, so everything from the payload to the rules is the shipped code.
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, setLogLevel, Timestamp, updateDoc, type DocumentData, type Firestore } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteTransaction, restoreTransaction } from '../../src/lib/firestore'
import { mapTransaction } from '../../src/lib/mappers'

const client = vi.hoisted(() => ({ db: null as unknown }))
vi.mock('../../src/lib/firebase', () => ({
  get db() {
    return client.db
  },
}))

const OWNER = 'vlad.herasymovychh@gmail.com'
let env: RulesTestEnvironment

beforeAll(async () => {
  setLogLevel('silent')
  env = await initializeTestEnvironment({
    projectId: 'demo-money-tracker',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  })
})
afterAll(async () => {
  await env.cleanup()
})
beforeEach(async () => {
  await env.clearFirestore()
  client.db = owner() // a fresh client, so no test sees another's cached documents
})

const owner = () => env.authenticatedContext('owner-uid', { email: OWNER, email_verified: true }).firestore() as unknown as Firestore
const stranger = () => env.authenticatedContext('other-uid', { email: 'someone.else@gmail.com', email_verified: true }).firestore() as unknown as Firestore
const ref = (id: string) => doc(owner(), 'transactions', id)
/** Microseconds, as Firestore keeps them: a trip through Date would lose them. */
const AT = new Timestamp(1_792_400_000, 123_456_000)
const stored = (extra: DocumentData = {}): DocumentData => ({
  kind: 'expense', amount: 1250, categoryId: 'c1', note: 'flat white', date: '2026-10-14', at: AT, source: 'app',
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...extra,
})
const read = async (id: string) => (await getDoc(ref(id))).data()
/** Writes the document, then reads it back as the app holds it (mapped), which is what the Add sheet hands to Undo. */
async function entry(id: string, data: DocumentData) {
  await assertSucceeds(setDoc(ref(id), data))
  const original = (await read(id))!
  return { original, tx: mapTransaction(id, original) }
}
const later = (a: unknown, b: unknown) => (a as Timestamp).valueOf() > (b as Timestamp).valueOf()

describe('restoreTransaction against the rules', () => {
  it('brings an entry added by hand back under its id: every field as stored, Timestamps exact, only updatedAt new', async () => {
    const { original, tx } = await entry('t1', stored())
    await assertSucceeds(deleteDoc(ref('t1')))
    expect(await read('t1')).toBeUndefined()
    await new Promise((resolve) => setTimeout(resolve, 30))
    await assertSucceeds(restoreTransaction(tx))
    const restored = (await read('t1'))!
    expect(Object.keys(restored).sort()).toEqual(Object.keys(original).sort())
    expect('recurringId' in restored).toBe(false)
    for (const k of ['kind', 'amount', 'categoryId', 'note', 'date', 'source']) expect(restored[k]).toEqual(original[k])
    expect((restored.at as Timestamp).isEqual(AT)).toBe(true)
    expect((restored.createdAt as Timestamp).isEqual(original.createdAt as Timestamp)).toBe(true)
    expect(later(restored.updatedAt, original.updatedAt)).toBe(true)
  })

  it("keeps a template instance's deterministic id and its recurringId", async () => {
    const { tx } = await entry('rec_r1_2026-10', stored({ recurringId: 'r1' }))
    await assertSucceeds(deleteDoc(ref('rec_r1_2026-10')))
    await assertSucceeds(restoreTransaction(tx))
    expect(await read('rec_r1_2026-10')).toMatchObject({ recurringId: 'r1', source: 'app', amount: 1250 })
  })

  it.each(['import', 'shortcut'])('keeps the source %s', async (source) => {
    const { tx } = await entry('x', stored({ source }))
    await assertSucceeds(deleteDoc(ref('x')))
    await assertSucceeds(restoreTransaction(tx))
    expect((await read('x'))!.source).toBe(source)
  })

  it('brings a document written without a source back with source "app", as the app reads it: valid, if not byte for byte', async () => {
    const withoutSource = stored()
    delete withoutSource.source
    const { original, tx } = await entry('legacy', withoutSource)
    expect('source' in original).toBe(false)
    await assertSucceeds(deleteDoc(ref('legacy')))
    await assertSucceeds(restoreTransaction(tx))
    expect((await read('legacy'))!.source).toBe('app')
  })

  it('ends with the entry back when Undo is tapped before the delete reached the server (neither write waited for)', async () => {
    const { original, tx } = await entry('t2', stored())
    // Through the app's own client, as the Add sheet sends both: one client keeps its writes in order. (A delete sent
    // through a second client could reach the server after the restore, and the entry would end up deleted.)
    const deleting = deleteTransaction('t2')
    const restoring = restoreTransaction(tx)
    await Promise.all([deleting, restoring])
    expect(await read('t2')).toMatchObject({ amount: original.amount, note: original.note, date: original.date })
  })

  it('is harmless a second time', async () => {
    const { tx } = await entry('t3', stored())
    await assertSucceeds(deleteDoc(ref('t3')))
    await assertSucceeds(restoreTransaction(tx))
    await assertSucceeds(restoreTransaction(tx))
    expect(await read('t3')).toMatchObject({ amount: 1250, note: 'flat white' })
  })

  it('gets a fresh createdAt, which the rules accept, when none was read', async () => {
    const { tx } = await entry('t4', stored())
    await assertSucceeds(deleteDoc(ref('t4')))
    await assertSucceeds(restoreTransaction({ ...tx, createdAt: undefined }))
    expect((await read('t4'))!.createdAt).toBeInstanceOf(Timestamp)
  })

  it('only writes the entry over itself when the delete had been refused', async () => {
    const { tx } = await entry('t5', stored())
    await assertFails(deleteDoc(doc(stranger(), 'transactions', 't5')))
    await assertSucceeds(restoreTransaction(tx))
    expect(await read('t5')).toMatchObject({ amount: 1250 })
  })

  it('puts back the copy it was given, over an edit made elsewhere in between: the last write wins', async () => {
    const { tx } = await entry('t6', stored())
    await assertSucceeds(updateDoc(ref('t6'), { amount: 9999 }))
    await assertSucceeds(deleteDoc(ref('t6')))
    await assertSucceeds(restoreTransaction(tx))
    expect((await read('t6'))!.amount).toBe(1250)
  })
})
