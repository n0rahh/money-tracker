// Recurring templates and their entries, end to end: the app's own recurring writes against the real rules. Only the app's
// Firebase set-up is swapped for the owner's emulator client, so everything from the payload to the rules is the shipped code.
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, setLogLevel, Timestamp, where, type DocumentData, type Firestore } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRecurringWithFirstInstance, deleteRecurring, materialiseRecurring, restoreRecurring, subscribeRecurring, updateRecurring } from '../../src/lib/firestore'
import { mapRecurring } from '../../src/lib/mappers'
import { isMaterialisable, monthsToMaterialise, templateFrom } from '../../src/lib/recurring'
import type { RecurringInput } from '../../src/lib/types'

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
/** The client the app's functions write through in this test. */
const appDb = () => client.db as Firestore

/** Rent on the 1st from August 2026, with no end. */
const RENT: RecurringInput = { kind: 'expense', amount: 120_000, categoryId: 'rent', note: 'Flat', dayOfMonth: 1, startMonth: '2026-08', endMonth: null }
/** The Add sheet's entry on Saturday 17 Oct 2026, repeating. */
const PAYDAY = { kind: 'income' as const, amount: 500_000, categoryId: 'salary', note: 'pay', date: '2026-10-17' }

/** Reads a template through a fresh client (the server's copy, no local cache), raw and as the app maps it. */
async function readTemplate(id: string) {
  const snap = await getDoc(doc(owner(), 'recurring', id))
  return snap.exists() ? { raw: snap.data(), template: mapRecurring(id, snap.data()) } : null
}
/** A template's entries on the server, in id order. */
async function entriesOf(id: string) {
  const snap = await getDocs(query(collection(owner(), 'transactions'), where('recurringId', '==', id)))
  return snap.docs.map((d) => ({ id: d.id, data: d.data() })).sort((a, b) => a.id.localeCompare(b.id))
}
/** A template stored as the app stores one, then read back as the app holds it. */
async function storedTemplate(id: string, input: RecurringInput, lastAppliedMonth: string | null = null) {
  await assertSucceeds(setDoc(doc(appDb(), 'recurring', id), { ...input, lastAppliedMonth, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
  return (await readTemplate(id))!.template
}
const noonOf = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0, 0)
}
const later = (a: unknown, b: unknown) => (a as Timestamp).valueOf() > (b as Timestamp).valueOf()
/** An entry's fields apart from its three Timestamps. */
const fieldsOf = ({ at: _at, createdAt: _c, updatedAt: _u, ...rest }: DocumentData) => rest

describe('createRecurringWithFirstInstance against the rules', () => {
  it('writes the template, already applied for its first month, with that month\'s entry: both pass the rules in one batch', async () => {
    const input = templateFrom(PAYDAY)
    const { id, done } = createRecurringWithFirstInstance(input)
    await assertSucceeds(done)

    const stored = (await readTemplate(id))!
    expect(stored.raw).toMatchObject({ ...input, endMonth: null, lastAppliedMonth: '2026-10' })
    expect(stored.raw.createdAt).toBeInstanceOf(Timestamp)
    expect(stored.raw.updatedAt).toBeInstanceOf(Timestamp)
    const entries = await entriesOf(id)
    expect(entries.map((e) => e.id)).toEqual([`rec_${id}_2026-10`])
    const [entry] = entries
    expect(fieldsOf(entry.data)).toEqual({ kind: 'income', amount: 500_000, categoryId: 'salary', note: 'pay', date: '2026-10-17', recurringId: id, source: 'app' })
    expect((entry.data.at as Timestamp).toDate()).toEqual(noonOf('2026-10-17'))
    expect(entry.data.createdAt).toBeInstanceOf(Timestamp)
    expect(entry.data.updatedAt).toBeInstanceOf(Timestamp)
    // Nothing is owed for the month just written.
    expect(monthsToMaterialise(stored.template, '2026-10')).toEqual([])
  })

  it('is refused as a whole: a template the rules refuse leaves no entry behind either', async () => {
    const { id, done } = createRecurringWithFirstInstance({ ...RENT, amount: 0 })
    await assertFails(done)
    expect(await readTemplate(id)).toBeNull()
    expect(await entriesOf(id)).toEqual([])
  })

  it('never lets a snapshot show the new template without its first month, which a materialiser would write again', async () => {
    const seen: (string | null)[] = []
    let confirmed = false
    const stop = subscribeRecurring((templates, fromCache) => {
      if (!fromCache) confirmed = true
      for (const t of templates) seen.push(t.lastAppliedMonth)
    })
    // In sync with the server first, as the app's listener is when Save is tapped online.
    await vi.waitFor(() => expect(confirmed).toBe(true))
    const { done } = createRecurringWithFirstInstance(templateFrom(PAYDAY))
    await assertSucceeds(done)
    await vi.waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(2)) // the local write and the server's acknowledgement
    stop()
    expect(seen).not.toContain(null)
    expect(new Set(seen)).toEqual(new Set(['2026-10']))
  })
})

describe('materialiseRecurring against the rules', () => {
  it('writes each owed month as an ordinary entry under its deterministic id, and moves lastAppliedMonth in the same batch', async () => {
    const template = await storedTemplate('r1', RENT)
    const before = (await readTemplate('r1'))!.raw
    const months = monthsToMaterialise(template, '2026-10')
    expect(months).toEqual(['2026-08', '2026-09', '2026-10'])
    await new Promise((resolve) => setTimeout(resolve, 30))
    await assertSucceeds(materialiseRecurring(template, months))

    const entries = await entriesOf('r1')
    expect(entries.map((e) => e.id)).toEqual(['rec_r1_2026-08', 'rec_r1_2026-09', 'rec_r1_2026-10'])
    for (const { id, data } of entries) {
      const date = `${id.slice(-7)}-01`
      expect(fieldsOf(data)).toEqual({ kind: 'expense', amount: 120_000, categoryId: 'rent', note: 'Flat', date, recurringId: 'r1', source: 'app' })
      expect((data.at as Timestamp).toDate()).toEqual(noonOf(date))
      expect(data.createdAt).toBeInstanceOf(Timestamp)
    }
    const after = (await readTemplate('r1'))!
    expect(after.raw.lastAppliedMonth).toBe('2026-10')
    expect(after.raw.endMonth).toBeNull()
    expect((after.raw.createdAt as Timestamp).isEqual(before.createdAt as Timestamp)).toBe(true)
    expect(later(after.raw.updatedAt, before.updatedAt)).toBe(true)
    expect(monthsToMaterialise(after.template, '2026-10')).toEqual([])
  })

  it('puts day 31 on the last day of shorter months', async () => {
    const template = await storedTemplate('r31', { ...RENT, dayOfMonth: 31, startMonth: '2028-01' })
    await assertSucceeds(materialiseRecurring(template, monthsToMaterialise(template, '2028-04')))
    expect((await entriesOf('r31')).map((e) => e.data.date)).toEqual(['2028-01-31', '2028-02-29', '2028-03-31', '2028-04-30'])
  })

  it('takes a full run of 24 months in one batch (25 writes), then the remaining 6 once lastAppliedMonth has advanced', async () => {
    const template = await storedTemplate('behind', { ...RENT, startMonth: '2024-05' })
    const first = monthsToMaterialise(template, '2026-10')
    expect(first).toHaveLength(24)
    await assertSucceeds(materialiseRecurring(template, first))
    const halfway = (await readTemplate('behind'))!.template
    expect(halfway.lastAppliedMonth).toBe('2026-04')
    await assertSucceeds(materialiseRecurring(halfway, monthsToMaterialise(halfway, '2026-10')))
    expect(await entriesOf('behind')).toHaveLength(30)
    expect((await readTemplate('behind'))!.raw.lastAppliedMonth).toBe('2026-10')
  })

  it('stays one entry per month when a month is written again, as a second device or tab would', async () => {
    const template = await storedTemplate('twice', { ...RENT, startMonth: '2026-10' })
    await Promise.all([assertSucceeds(materialiseRecurring(template, ['2026-10'])), assertSucceeds(materialiseRecurring(template, ['2026-10']))])
    expect((await entriesOf('twice')).map((e) => e.id)).toEqual(['rec_twice_2026-10'])
  })

  it('is refused as a whole for a template the rules refuse (only a console edit makes one): what isMaterialisable keeps it from', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'recurring', 'hand-edited'), { ...RENT, amount: 0, lastAppliedMonth: null })
    })
    const template = (await readTemplate('hand-edited'))!.template
    expect(isMaterialisable(template)).toBe(false)
    await assertFails(materialiseRecurring(template, ['2026-10']))
    expect(await entriesOf('hand-edited')).toEqual([]) // all or nothing
  })
})

describe('restoreRecurring and Stop against the rules', () => {
  it.each([
    { what: 'running and never applied (both nulls written)', input: RENT, lastAppliedMonth: null },
    { what: 'ended and applied', input: { ...RENT, endMonth: '2026-12' }, lastAppliedMonth: '2026-10' },
  ])('brings a deleted template back under its id, $what: every field as stored, createdAt exact, only updatedAt new', async ({ input, lastAppliedMonth }) => {
    const template = await storedTemplate('back', input, lastAppliedMonth)
    const original = (await readTemplate('back'))!.raw
    await assertSucceeds(deleteRecurring('back'))
    expect(await readTemplate('back')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 30))
    await assertSucceeds(restoreRecurring(template))

    const restored = (await readTemplate('back'))!.raw
    expect(Object.keys(restored).sort()).toEqual(Object.keys(original).sort())
    const { createdAt, updatedAt, ...fields } = restored
    const { createdAt: createdBefore, updatedAt: updatedBefore, ...fieldsBefore } = original
    expect(fields).toEqual(fieldsBefore)
    expect((createdAt as Timestamp).isEqual(createdBefore as Timestamp)).toBe(true)
    expect(later(updatedAt, updatedBefore)).toBe(true)
  })

  it('gets a fresh createdAt, which the rules accept, when none was read', async () => {
    const template = await storedTemplate('fresh', RENT)
    await assertSucceeds(deleteRecurring('fresh'))
    await assertSucceeds(restoreRecurring({ ...template, createdAt: undefined }))
    expect((await readTemplate('fresh'))!.raw.createdAt).toBeInstanceOf(Timestamp)
  })

  it('ends with the template back when Undo is tapped before the delete reached the server, its entries untouched', async () => {
    const { id, done } = createRecurringWithFirstInstance(templateFrom(PAYDAY))
    await assertSucceeds(done)
    const template = (await readTemplate(id))!.template
    await Promise.all([deleteRecurring(id), restoreRecurring(template)])
    expect((await readTemplate(id))!.raw).toMatchObject({ ...templateFrom(PAYDAY), lastAppliedMonth: '2026-10' })
    expect(await entriesOf(id)).toHaveLength(1)
  })

  it("takes Stop's end month, and an explicit null for no end", async () => {
    await storedTemplate('stop', RENT, '2026-10')
    await assertSucceeds(updateRecurring('stop', { endMonth: '2026-10' }))
    expect((await readTemplate('stop'))!.raw.endMonth).toBe('2026-10')
    await assertSucceeds(updateRecurring('stop', { endMonth: null }))
    expect((await readTemplate('stop'))!.raw.endMonth).toBeNull()
  })
})
