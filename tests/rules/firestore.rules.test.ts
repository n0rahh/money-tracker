import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, setDoc, Timestamp, updateDoc } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

const OWNER = 'vlad.herasymovychh@gmail.com'
let env: RulesTestEnvironment

beforeAll(async () => {
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
})

describe('settings', () => {
  it('owner can write settings/main; stranger cannot', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'settings/main'), { currency: 'EUR', locale: null }))
    await assertFails(setDoc(doc(stranger(), 'settings/main'), { currency: 'USD', locale: null }))
  })
})

describe('other collections', () => {
  it('nobody can write to an unknown collection', async () => {
    await assertFails(setDoc(doc(owner(), 'secrets/x'), { a: 1 }))
  })
})
