// The Shortcut's two HTTP calls, end to end: the app's own REST client signs in on the Auth emulator and writes through
// the Firestore emulator's REST API, so the rules judge the token and the body exactly as they will the Shortcut's. The
// entry is then read back the way the app reads it. Only the hosts differ from production.
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, setLogLevel, Timestamp, type Firestore } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mapTransaction } from '../../src/lib/mappers'
import { firestoreFields, transactionsUrl, type RestHosts, type ShortcutEntry } from '../../src/lib/shortcut'
import { createTransactionViaRest, shortcutErrorText, ShortcutRestError, signInWithPassword } from '../../src/lib/shortcutRest'

const PROJECT = 'demo-money-tracker'
const API_KEY = 'fake-api-key'
const AUTH_EMULATOR = 'http://127.0.0.1:9099'
/**
 * The emulators in place of Google's hosts. The Auth emulator serves Identity Toolkit under its host name as a path
 * (http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/…), the Firestore emulator at its root (…:8080/v1/…).
 */
const HOSTS: RestHosts = { identity: `${AUTH_EMULATOR}/identitytoolkit.googleapis.com`, firestore: 'http://127.0.0.1:8080' }
const OWNER = 'vlad.herasymovychh@gmail.com'
const PASSWORD = 'Xq7Lm2Rt9Vb4Nc8Kd3Hf6Jw1'
/** The plan's example: €12.50 on 20 Oct 2026 at 17:05 UTC. */
const ENTRY: ShortcutEntry = { kind: 'expense', amount: 1250, categoryId: 'c1', note: '', date: '2026-10-20', at: new Date('2026-10-20T17:05:00Z') }

let env: RulesTestEnvironment

beforeAll(async () => {
  setLogLevel('silent')
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  })
})
afterAll(async () => {
  await env.cleanup()
})
beforeEach(async () => {
  await env.clearFirestore()
  const cleared = await fetch(`${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })
  expect(cleared.ok).toBe(true)
})

/** The owner's own Firestore client, as the app reads with it. */
const owner = () => env.authenticatedContext('owner-uid', { email: OWNER, email_verified: true }).firestore() as unknown as Firestore

/** One Identity Toolkit call on the Auth emulator; a refusal fails the test with the emulator's answer. */
async function identity(op: string, body: object, headers: Record<string, string> = {}): Promise<{ localId: string }> {
  const res = await fetch(`${HOSTS.identity}/v1/accounts:${op}?key=${API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`accounts:${op} answered ${res.status}: ${await res.text()}`)
  return (await res.json()) as { localId: string }
}
/** An email/password account, unverified, as accounts:signUp makes one. */
const signUp = async (email: string) => (await identity('signUp', { email, password: PASSWORD, returnSecureToken: true })).localId
/** Marks the email verified as an admin would: the emulator takes `Bearer owner` for admin credentials. */
const markVerified = (localId: string) => identity('update', { localId, emailVerified: true }, { Authorization: 'Bearer owner' })

/** The Shortcut's write as step 14 sends it, a text body through fetch alone; resolves with the answer's status and JSON. */
async function rawWrite(idToken: string, body: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(transactionsUrl(PROJECT, HOSTS), { method: 'POST', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body })
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}
const storedCount = async () => (await getDocs(collection(owner(), 'transactions'))).size

describe("the Shortcut's REST calls against the rules", () => {
  it("the Shortcut's two calls create an entry the app reads back", async () => {
    await markVerified(await signUp(OWNER))
    const { idToken, emailVerified } = await signInWithPassword(OWNER, PASSWORD, API_KEY, HOSTS)
    expect(emailVerified).toBe(true)

    const { id } = await createTransactionViaRest(ENTRY, PROJECT, idToken, HOSTS)
    // A Firestore auto-id: the shape a CSV re-import keeps as the entry's own id.
    expect(id).toMatch(/^[A-Za-z0-9]{20}$/)
    const raw = (await getDoc(doc(owner(), 'transactions', id))).data()!
    // The seven fields and nothing else: no createdAt or updatedAt, which REST cannot set to the server's time.
    expect(Object.keys(raw).sort()).toStrictEqual(['amount', 'at', 'categoryId', 'date', 'kind', 'note', 'source'])
    const tx = mapTransaction(id, raw)
    expect(tx).toMatchObject({ id, kind: 'expense', amount: 1250, categoryId: 'c1', note: '', date: '2026-10-20', source: 'shortcut' })
    expect(tx.at.isEqual(Timestamp.fromDate(ENTRY.at))).toBe(true)
    expect('recurringId' in tx).toBe(false)
    expect(tx.createdAt).toBeUndefined()
    expect(tx.updatedAt).toBeUndefined()
  })

  it("takes the Shortcut's own text body, with Format Date's ISO 8601 time and its offset, as the same instant", async () => {
    await markVerified(await signUp(OWNER))
    const { idToken } = await signInWithPassword(OWNER, PASSWORD, API_KEY, HOSTS)
    // The Global Constraints JSON as the Shortcut's Text action writes it out, the time at +02:00 as the phone gives it.
    const body = '{"fields":{"kind":{"stringValue":"expense"},"amount":{"integerValue":"1250"},"categoryId":{"stringValue":"c1"},"note":{"stringValue":""},"date":{"stringValue":"2026-10-20"},"at":{"timestampValue":"2026-10-20T19:05:00+02:00"},"source":{"stringValue":"shortcut"}}}'
    const { status, json } = await rawWrite(idToken, body)
    expect(status).toBe(200)
    const [stored] = (await getDocs(collection(owner(), 'transactions'))).docs
    // What step 14's If looks for: the answer to a stored entry has the document's name.
    expect(json.name).toBe(`projects/${PROJECT}/databases/(default)/documents/transactions/${stored.id}`)
    const tx = mapTransaction(stored.id, stored.data())
    expect(tx).toMatchObject({ amount: 1250, date: '2026-10-20', source: 'shortcut' })
    expect(tx.at.isEqual(Timestamp.fromDate(ENTRY.at))).toBe(true)
  })

  it('an unverified owner is refused', async () => {
    await signUp(OWNER)
    const { idToken, emailVerified } = await signInWithPassword(OWNER, PASSWORD, API_KEY, HOSTS)
    expect(emailVerified).toBe(false)
    const write = createTransactionViaRest(ENTRY, PROJECT, idToken, HOSTS)
    await expect(write).rejects.toBeInstanceOf(ShortcutRestError)
    await expect(write).rejects.toMatchObject({ step: 'write', status: 403, code: 'PERMISSION_DENIED' })
    expect(await storedCount()).toBe(0)
  })

  it('another verified account is refused', async () => {
    await markVerified(await signUp('someone.else@gmail.com'))
    const { idToken, emailVerified } = await signInWithPassword('someone.else@gmail.com', PASSWORD, API_KEY, HOSTS)
    expect(emailVerified).toBe(true)
    await expect(createTransactionViaRest(ENTRY, PROJECT, idToken, HOSTS)).rejects.toMatchObject({ step: 'write', status: 403, code: 'PERMISSION_DENIED' })
    expect(await storedCount()).toBe(0)
  })

  it('a malformed body is refused by the rules', async () => {
    await markVerified(await signUp(OWNER))
    const { idToken } = await signInWithPassword(OWNER, PASSWORD, API_KEY, HOSTS)
    const withAmount = (amount: object) => JSON.stringify({ fields: { ...firestoreFields(ENTRY), amount } })
    // A double, even a whole one, is no int to the rules; 0 is no amount.
    for (const amount of [{ doubleValue: 12.5 }, { doubleValue: 1250 }, { integerValue: '0' }]) {
      const { status, json } = await rawWrite(idToken, withAmount(amount))
      expect(status).toBe(403)
      // Step 14's If takes the other branch: no name, and an error.message for the notification.
      expect(json).not.toHaveProperty('name')
      expect(json).toMatchObject({ error: { status: 'PERMISSION_DENIED', message: expect.any(String) } })
    }
    expect(await storedCount()).toBe(0)
  })

  it('a wrong password is refused at sign-in', async () => {
    await markVerified(await signUp(OWNER))
    const signIn = signInWithPassword(OWNER, 'nope-nope', API_KEY, HOSTS)
    await expect(signIn).rejects.toBeInstanceOf(ShortcutRestError)
    const error = (await signIn.catch((e: unknown) => e)) as ShortcutRestError
    expect(error).toMatchObject({ step: 'sign-in', status: 400 })
    // INVALID_LOGIN_CREDENTIALS with email enumeration protection on (production's default), INVALID_PASSWORD without.
    expect(['INVALID_LOGIN_CREDENTIALS', 'INVALID_PASSWORD']).toContain(error.code)
    expect(shortcutErrorText(error)).toBe('Wrong password. Reset it in step 1 and paste the new one.')
  })
})
