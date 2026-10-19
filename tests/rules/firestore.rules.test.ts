import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, setDoc, setLogLevel, Timestamp, updateDoc } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

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
})

const owner = () => env.authenticatedContext('owner-uid', { email: OWNER, email_verified: true }).firestore()
const stranger = () => env.authenticatedContext('other-uid', { email: 'someone.else@gmail.com', email_verified: true }).firestore()
const unverifiedOwner = () => env.authenticatedContext('owner-uid', { email: OWNER, email_verified: false }).firestore()
const anon = () => env.unauthenticatedContext().firestore()

const validTx = () => ({ kind: 'expense', amount: 1250, categoryId: 'c1', note: '', date: '2026-10-14', at: Timestamp.now(), source: 'app' })
const validCategory = () => ({ name: 'Coffee', icon: 'Coffee', color: 'amber', kind: 'expense', order: 2, archived: false })
const validBudget = () => ({ monthly: 50000 })
const validRecurring = () => ({
  kind: 'expense',
  amount: 120000,
  categoryId: 'rent',
  note: 'Flat',
  dayOfMonth: 5,
  startMonth: '2026-10',
  endMonth: null,
  lastAppliedMonth: null,
})

describe('transactions', () => {
  it('owner can create, read, update and delete a valid transaction', async () => {
    const ref = doc(owner(), 'transactions/t1')
    await assertSucceeds(setDoc(ref, validTx()))
    await assertSucceeds(getDoc(ref))
    await assertSucceeds(updateDoc(ref, { note: 'lunch' }))
    await assertSucceeds(deleteDoc(ref))
  })

  it('another verified Google account is denied', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'transactions/t1'), validTx()))
    await assertFails(getDoc(doc(stranger(), 'transactions/t1')))
    await assertFails(setDoc(doc(stranger(), 'transactions/t2'), validTx()))
  })

  it('the owner email without email_verified is denied', async () => {
    await assertFails(setDoc(doc(unverifiedOwner(), 'transactions/t1'), validTx()))
    await assertFails(getDoc(doc(unverifiedOwner(), 'transactions/t1')))
  })

  it('anonymous is denied', async () => {
    await assertFails(getDoc(doc(anon(), 'transactions/t1')))
    await assertFails(setDoc(doc(anon(), 'transactions/t1'), validTx()))
  })

  it('rejects schema violations on create', async () => {
    const db = owner()
    await assertFails(setDoc(doc(db, 'transactions/bad1'), { ...validTx(), amount: 0 }))
    await assertFails(setDoc(doc(db, 'transactions/bad2'), { ...validTx(), amount: 12.5 }))
    await assertFails(setDoc(doc(db, 'transactions/bad3'), { ...validTx(), kind: 'transfer' }))
    await assertFails(setDoc(doc(db, 'transactions/bad4'), { ...validTx(), date: '14/10/2026' }))
    await assertFails(setDoc(doc(db, 'transactions/bad5'), { ...validTx(), note: 'x'.repeat(201) }))
    await assertFails(setDoc(doc(db, 'transactions/bad6'), { ...validTx(), at: '2026-10-14T10:00:00Z' }))
    await assertFails(setDoc(doc(db, 'transactions/bad7'), { ...validTx(), categoryId: '' }))
  })

  it('rejects an update that breaks the schema', async () => {
    const ref = doc(owner(), 'transactions/t2')
    await assertSucceeds(setDoc(ref, validTx()))
    await assertFails(updateDoc(ref, { amount: -5 }))
  })

  it("another verified account cannot delete the owner's transaction", async () => {
    await assertSucceeds(setDoc(doc(owner(), 'transactions/t1'), validTx()))
    await assertFails(deleteDoc(doc(stranger(), 'transactions/t1')))
  })

  it('rejects an amount at or above the 10^11 cap', async () => {
    const db = owner()
    await assertFails(setDoc(doc(db, 'transactions/cap1'), { ...validTx(), amount: 100000000000 }))
    await assertSucceeds(setDoc(doc(db, 'transactions/cap2'), { ...validTx(), amount: 99999999999 }))
  })

  it('accepts a valid income transaction', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'transactions/i1'), { ...validTx(), kind: 'income', amount: 500000, categoryId: 'salary' }))
  })

  it('accepts a note of exactly 200 characters', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'transactions/n200'), { ...validTx(), note: 'x'.repeat(200) }))
  })
})

describe('categories', () => {
  it('owner can create a valid category and archive it', async () => {
    const ref = doc(owner(), 'categories/c1')
    await assertSucceeds(setDoc(ref, validCategory()))
    await assertSucceeds(updateDoc(ref, { archived: true }))
  })
  it('rejects an empty or too-long name', async () => {
    await assertFails(setDoc(doc(owner(), 'categories/c2'), { ...validCategory(), name: '' }))
    await assertFails(setDoc(doc(owner(), 'categories/c3'), { ...validCategory(), name: 'x'.repeat(41) }))
  })
  it('stranger cannot read categories', async () => {
    await assertFails(getDoc(doc(stranger(), 'categories/c1')))
  })
  it('another verified account cannot create or update a category', async () => {
    await assertFails(setDoc(doc(stranger(), 'categories/c1'), validCategory()))
    await assertSucceeds(setDoc(doc(owner(), 'categories/c1'), validCategory()))
    await assertFails(updateDoc(doc(stranger(), 'categories/c1'), { name: 'x' }))
  })
  it('rejects an unknown kind', async () => {
    await assertFails(setDoc(doc(owner(), 'categories/c4'), { ...validCategory(), kind: 'transfer' }))
  })
  it('owner can read a category it created', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'categories/c1'), validCategory()))
    await assertSucceeds(getDoc(doc(owner(), 'categories/c1')))
  })
  it('owner can delete a category; another verified account cannot', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'categories/c1'), validCategory()))
    await assertFails(deleteDoc(doc(stranger(), 'categories/c1')))
    await assertSucceeds(deleteDoc(doc(owner(), 'categories/c1')))
  })
  it('rejects wrong field types', async () => {
    const db = owner()
    await assertFails(setDoc(doc(db, 'categories/t1'), { ...validCategory(), icon: 7 }))
    await assertFails(setDoc(doc(db, 'categories/t2'), { ...validCategory(), order: '2' }))
    await assertFails(setDoc(doc(db, 'categories/t3'), { ...validCategory(), archived: 'false' }))
  })
  it('accepts names of 1 and 40 characters', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'categories/n1'), { ...validCategory(), name: 'x' }))
    await assertSucceeds(setDoc(doc(owner(), 'categories/n40'), { ...validCategory(), name: 'x'.repeat(40) }))
  })
})

describe('settings', () => {
  it('owner can write settings/main; stranger cannot', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'settings/main'), { currency: 'EUR', locale: null }))
    await assertFails(setDoc(doc(stranger(), 'settings/main'), { currency: 'USD', locale: null }))
  })
  it('another verified account cannot read settings/main', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'settings/main'), { currency: 'EUR', locale: null }))
    await assertFails(getDoc(doc(stranger(), 'settings/main')))
  })
  it('owner can read settings/main after writing it', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'settings/main'), { currency: 'EUR', locale: null }))
    await assertSucceeds(getDoc(doc(owner(), 'settings/main')))
  })
})

describe.each([
  { who: 'anonymous', db: anon },
  { who: 'the owner email without email_verified', db: unverifiedOwner },
])('$who on categories and settings', ({ db }) => {
  beforeEach(async () => {
    // Existing documents, so a denial is the rules' doing, not a missing document.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'categories/c1'), validCategory())
      await setDoc(doc(ctx.firestore(), 'settings/main'), { currency: 'EUR', locale: null })
    })
  })
  it('is denied reading and writing categories', async () => {
    await assertFails(getDoc(doc(db(), 'categories/c1')))
    await assertFails(setDoc(doc(db(), 'categories/c2'), validCategory()))
    await assertFails(updateDoc(doc(db(), 'categories/c1'), { name: 'Tea' }))
  })
  it('is denied reading and writing settings', async () => {
    await assertFails(getDoc(doc(db(), 'settings/main')))
    await assertFails(setDoc(doc(db(), 'settings/main'), { currency: 'USD', locale: null }))
  })
})

describe('other collections', () => {
  it('nobody can write to an unknown collection', async () => {
    await assertFails(setDoc(doc(owner(), 'secrets/x'), { a: 1 }))
  })
  it('nobody can read an unknown collection', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'secrets/x'), { a: 1 })
    })
    await assertFails(getDoc(doc(owner(), 'secrets/x')))
  })
})

describe('budgets', () => {
  it('owner can set, read, change and delete a budget', async () => {
    const ref = doc(owner(), 'budgets/c1')
    await assertSucceeds(setDoc(ref, validBudget()))
    await assertSucceeds(getDoc(ref))
    await assertSucceeds(updateDoc(ref, { monthly: 75000 }))
    await assertSucceeds(deleteDoc(ref))
  })

  it('rejects a monthly limit that is not a positive integer below 10^11', async () => {
    const db = owner()
    await assertFails(setDoc(doc(db, 'budgets/bad1'), { monthly: 0 }))
    await assertFails(setDoc(doc(db, 'budgets/bad2'), { monthly: 12.5 }))
    await assertFails(setDoc(doc(db, 'budgets/bad3'), { monthly: -100 }))
    await assertFails(setDoc(doc(db, 'budgets/bad4'), { monthly: '500' }))
    await assertFails(setDoc(doc(db, 'budgets/bad5'), { monthly: 100000000000 }))
    await assertFails(setDoc(doc(db, 'budgets/bad6'), {}))
    await assertSucceeds(setDoc(doc(db, 'budgets/ok1'), { monthly: 1 }))
    await assertSucceeds(setDoc(doc(db, 'budgets/ok2'), { monthly: 99999999999 }))
    await assertFails(updateDoc(doc(db, 'budgets/ok1'), { monthly: 0 }))
  })

  it('is denied to another verified account, to the owner email without email_verified, and to anonymous', async () => {
    // An existing document, so a denial is the rules' doing, not a missing document.
    await assertSucceeds(setDoc(doc(owner(), 'budgets/c1'), validBudget()))
    await assertFails(getDoc(doc(stranger(), 'budgets/c1')))
    await assertFails(setDoc(doc(stranger(), 'budgets/c2'), validBudget()))
    await assertFails(updateDoc(doc(stranger(), 'budgets/c1'), { monthly: 1 }))
    await assertFails(deleteDoc(doc(stranger(), 'budgets/c1')))
    await assertFails(getDoc(doc(unverifiedOwner(), 'budgets/c1')))
    await assertFails(setDoc(doc(unverifiedOwner(), 'budgets/c2'), validBudget()))
    await assertFails(updateDoc(doc(unverifiedOwner(), 'budgets/c1'), { monthly: 1 }))
    await assertFails(deleteDoc(doc(unverifiedOwner(), 'budgets/c1')))
    await assertFails(getDoc(doc(anon(), 'budgets/c1')))
    await assertFails(setDoc(doc(anon(), 'budgets/c2'), validBudget()))
    await assertFails(updateDoc(doc(anon(), 'budgets/c1'), { monthly: 1 }))
    await assertFails(deleteDoc(doc(anon(), 'budgets/c1')))
  })
})

describe('recurring templates', () => {
  it('owner can create, read, update and delete a valid template', async () => {
    const db = owner()
    const ref = doc(db, 'recurring/r1')
    await assertSucceeds(setDoc(ref, validRecurring()))
    await assertSucceeds(getDoc(ref))
    await assertSucceeds(updateDoc(ref, { lastAppliedMonth: '2026-10' })) // what the launch-time materialiser writes
    await assertSucceeds(updateDoc(ref, { endMonth: '2027-03' })) // what "Stop" writes
    await assertSucceeds(deleteDoc(ref))
    await assertSucceeds(
      setDoc(doc(db, 'recurring/r2'), { ...validRecurring(), kind: 'income', amount: 500000, categoryId: 'salary', startMonth: '2026-01', endMonth: '2026-12', lastAppliedMonth: '2026-09' }),
    )
  })

  it('rejects a kind, amount, categoryId, note or dayOfMonth outside the schema', async () => {
    const db = owner()
    await assertFails(setDoc(doc(db, 'recurring/bad1'), { ...validRecurring(), dayOfMonth: 0 }))
    await assertFails(setDoc(doc(db, 'recurring/bad2'), { ...validRecurring(), dayOfMonth: 32 }))
    await assertFails(setDoc(doc(db, 'recurring/bad3'), { ...validRecurring(), dayOfMonth: 15.5 }))
    await assertFails(setDoc(doc(db, 'recurring/bad4'), { ...validRecurring(), dayOfMonth: '15' }))
    await assertFails(setDoc(doc(db, 'recurring/bad5'), { ...validRecurring(), kind: 'transfer' }))
    await assertFails(setDoc(doc(db, 'recurring/bad6'), { ...validRecurring(), amount: 0 }))
    await assertFails(setDoc(doc(db, 'recurring/bad7'), { ...validRecurring(), amount: 12.5 }))
    await assertFails(setDoc(doc(db, 'recurring/bad8'), { ...validRecurring(), amount: 100000000000 }))
    await assertFails(setDoc(doc(db, 'recurring/bad9'), { ...validRecurring(), categoryId: '' }))
    await assertFails(setDoc(doc(db, 'recurring/bad10'), { ...validRecurring(), note: 'x'.repeat(201) }))
    await assertSucceeds(setDoc(doc(db, 'recurring/day1'), { ...validRecurring(), dayOfMonth: 1 }))
    await assertSucceeds(setDoc(doc(db, 'recurring/day31'), { ...validRecurring(), dayOfMonth: 31 }))
    await assertSucceeds(setDoc(doc(db, 'recurring/cap'), { ...validRecurring(), amount: 99999999999, note: 'x'.repeat(200) }))
    await assertFails(updateDoc(doc(db, 'recurring/day1'), { dayOfMonth: 32 }))
  })

  it('rejects a startMonth that is not a real YYYY-MM', async () => {
    const db = owner()
    await assertFails(setDoc(doc(db, 'recurring/bad1'), { ...validRecurring(), startMonth: '2026-13' }))
    await assertFails(setDoc(doc(db, 'recurring/bad2'), { ...validRecurring(), startMonth: '2026-00' }))
    await assertFails(setDoc(doc(db, 'recurring/bad3'), { ...validRecurring(), startMonth: '2026-1' }))
    await assertFails(setDoc(doc(db, 'recurring/bad4'), { ...validRecurring(), startMonth: '2026-10-01' }))
    await assertFails(setDoc(doc(db, 'recurring/bad5'), { ...validRecurring(), startMonth: 'x' }))
    await assertFails(setDoc(doc(db, 'recurring/bad6'), { ...validRecurring(), startMonth: 202610 }))
    await assertFails(setDoc(doc(db, 'recurring/bad7'), { ...validRecurring(), startMonth: null }))
    await assertSucceeds(setDoc(doc(db, 'recurring/ok'), { ...validRecurring(), startMonth: '2026-12' }))
  })

  it('accepts null or a real month for endMonth and lastAppliedMonth and rejects anything else', async () => {
    const db = owner()
    await assertFails(setDoc(doc(db, 'recurring/bad1'), { ...validRecurring(), endMonth: 'x' }))
    await assertFails(setDoc(doc(db, 'recurring/bad2'), { ...validRecurring(), endMonth: '2026-13' }))
    await assertFails(setDoc(doc(db, 'recurring/bad3'), { ...validRecurring(), lastAppliedMonth: 'x' }))
    await assertFails(setDoc(doc(db, 'recurring/bad4'), { ...validRecurring(), lastAppliedMonth: '2026-00' }))
    await assertFails(setDoc(doc(db, 'recurring/bad5'), { ...validRecurring(), lastAppliedMonth: 202610 }))
    // "No end" and "never applied" are stored as null, never as a missing field.
    const noEnd: Record<string, unknown> = validRecurring()
    delete noEnd.endMonth
    await assertFails(setDoc(doc(db, 'recurring/bad6'), noEnd))
    const neverApplied: Record<string, unknown> = validRecurring()
    delete neverApplied.lastAppliedMonth
    await assertFails(setDoc(doc(db, 'recurring/bad7'), neverApplied))
    await assertSucceeds(setDoc(doc(db, 'recurring/ok1'), { ...validRecurring(), endMonth: null, lastAppliedMonth: null }))
    await assertSucceeds(setDoc(doc(db, 'recurring/ok2'), { ...validRecurring(), endMonth: '2027-03', lastAppliedMonth: '2026-10' }))
  })

  it('is denied to another verified account, to the owner email without email_verified, and to anonymous', async () => {
    // An existing document, so a denial is the rules' doing, not a missing document.
    await assertSucceeds(setDoc(doc(owner(), 'recurring/r1'), validRecurring()))
    await assertFails(getDoc(doc(stranger(), 'recurring/r1')))
    await assertFails(setDoc(doc(stranger(), 'recurring/r2'), validRecurring()))
    await assertFails(updateDoc(doc(stranger(), 'recurring/r1'), { note: 'x' }))
    await assertFails(deleteDoc(doc(stranger(), 'recurring/r1')))
    await assertFails(getDoc(doc(unverifiedOwner(), 'recurring/r1')))
    await assertFails(setDoc(doc(unverifiedOwner(), 'recurring/r2'), validRecurring()))
    await assertFails(updateDoc(doc(unverifiedOwner(), 'recurring/r1'), { note: 'x' }))
    await assertFails(deleteDoc(doc(unverifiedOwner(), 'recurring/r1')))
    await assertFails(getDoc(doc(anon(), 'recurring/r1')))
    await assertFails(setDoc(doc(anon(), 'recurring/r2'), validRecurring()))
    await assertFails(updateDoc(doc(anon(), 'recurring/r1'), { note: 'x' }))
    await assertFails(deleteDoc(doc(anon(), 'recurring/r1')))
  })
})

describe('transactions created from templates and imports', () => {
  it('accepts a recurringId and every known source, and still accepts a missing source', async () => {
    const db = owner()
    await assertSucceeds(setDoc(doc(db, 'transactions/rec_a_2026-10'), { ...validTx(), recurringId: 'rec_a_2026-10', source: 'import' }))
    await assertSucceeds(setDoc(doc(db, 'transactions/s1'), { ...validTx(), source: 'shortcut' }))
    await assertSucceeds(setDoc(doc(db, 'transactions/s2'), { ...validTx(), source: 'app' }))
    const noSource: Record<string, unknown> = validTx()
    delete noSource.source
    await assertSucceeds(setDoc(doc(db, 'transactions/s3'), noSource))
    await assertSucceeds(setDoc(doc(db, 'transactions/r1'), { ...validTx(), recurringId: 'x' }))
    await assertSucceeds(setDoc(doc(db, 'transactions/r64'), { ...validTx(), recurringId: 'x'.repeat(64) }))
    // A later edit of such an entry is checked against the whole resulting document, which still carries both fields.
    await assertSucceeds(updateDoc(doc(db, 'transactions/rec_a_2026-10'), { note: 'rent, October' }))
  })

  it('rejects a source other than app, shortcut or import', async () => {
    const db = owner()
    await assertFails(setDoc(doc(db, 'transactions/bad1'), { ...validTx(), source: 'bogus' }))
    await assertFails(setDoc(doc(db, 'transactions/bad2'), { ...validTx(), source: '' }))
    await assertFails(setDoc(doc(db, 'transactions/bad3'), { ...validTx(), source: 7 }))
    await assertFails(setDoc(doc(db, 'transactions/bad4'), { ...validTx(), source: null }))
    await assertSucceeds(setDoc(doc(db, 'transactions/t1'), validTx()))
    await assertFails(updateDoc(doc(db, 'transactions/t1'), { source: 'bogus' }))
  })

  it('rejects a recurringId that is empty, longer than 64 characters or not a string', async () => {
    const db = owner()
    await assertFails(setDoc(doc(db, 'transactions/bad1'), { ...validTx(), recurringId: '' }))
    await assertFails(setDoc(doc(db, 'transactions/bad2'), { ...validTx(), recurringId: 'x'.repeat(65) }))
    await assertFails(setDoc(doc(db, 'transactions/bad3'), { ...validTx(), recurringId: 7 }))
    await assertFails(setDoc(doc(db, 'transactions/bad4'), { ...validTx(), recurringId: null }))
    await assertSucceeds(setDoc(doc(db, 'transactions/t1'), validTx()))
    await assertFails(updateDoc(doc(db, 'transactions/t1'), { recurringId: '' }))
  })
})
