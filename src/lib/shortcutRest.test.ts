import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readErrorText } from './readError'
import { firestoreFields, type ShortcutEntry } from './shortcut'
import { createTransactionViaRest, shortcutErrorText, ShortcutRestError, signInWithPassword } from './shortcutRest'

const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const base64url = (text: string) => Buffer.from(text, 'utf8').toString('base64url')
/** A token shaped like Firebase's: header, payload and signature, each base64url without padding. */
const token = (payload: object) => `${base64url('{"alg":"RS256","kid":"k1","typ":"JWT"}')}.${base64url(JSON.stringify(payload))}.c2lnbmF0dXJl`
const OWNER_CLAIMS = { iss: 'https://securetoken.google.com/p', aud: 'p', sub: 'uid-1', email: 'vlad@example.com' }

const ENTRY: ShortcutEntry = { kind: 'expense', amount: 1250, categoryId: 'c1', note: '', date: '2026-10-20', at: new Date('2026-10-20T17:05:00Z') }
const EMULATORS = { identity: 'http://127.0.0.1:9099/identitytoolkit.googleapis.com', firestore: 'http://127.0.0.1:8080' }

/** The one request fetch was given: its URL and init, with the JSON body parsed. */
function sent() {
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  return { url, init, body: JSON.parse(String(init.body)) as unknown }
}

describe('signInWithPassword', () => {
  it('posts the email, the password and returnSecureToken as JSON to the sign-in URL, and reads email_verified from the token', async () => {
    const idToken = token({ ...OWNER_CLAIMS, email_verified: true })
    fetchMock.mockResolvedValueOnce(reply(200, { kind: 'identitytoolkit#VerifyPasswordResponse', idToken, refreshToken: 'r', expiresIn: '3600' }))
    await expect(signInWithPassword('vlad@example.com', 'secret', 'key-1')).resolves.toStrictEqual({ idToken, emailVerified: true })
    const { url, init, body } = sent()
    expect(url).toBe('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=key-1')
    expect(init).toStrictEqual({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: init.body, signal: expect.any(AbortSignal) })
    expect(body).toStrictEqual({ email: 'vlad@example.com', password: 'secret', returnSecureToken: true })
  })

  it('goes to the hosts it is given', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { idToken: token(OWNER_CLAIMS) }))
    await signInWithPassword('vlad@example.com', 'secret', 'fake-api-key', EMULATORS)
    expect(sent().url).toBe('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key')
  })

  it.each([
    ['the claim is missing', token(OWNER_CLAIMS)],
    ['the claim is false', token({ ...OWNER_CLAIMS, email_verified: false })],
    ['the claim is the text "true"', token({ ...OWNER_CLAIMS, email_verified: 'true' })],
    ['the token has no payload', 'just-one-part'],
    ['the payload is not base64', 'a.%%%.c'],
    ['the payload is not JSON', `a.${base64url('not json')}.c`],
    ['the payload is not an object', `a.${base64url('[true]')}.c`],
  ])('reads emailVerified as false when %s', async (_, idToken) => {
    fetchMock.mockResolvedValueOnce(reply(200, { idToken }))
    await expect(signInWithPassword('vlad@example.com', 'secret', 'key-1')).resolves.toStrictEqual({ idToken, emailVerified: false })
  })

  it('decodes a payload that needs the base64url alphabet and padding back, and one with non-Latin text in it', async () => {
    const payload = JSON.stringify({ ...OWNER_CLAIMS, name: 'Влад ~~~???>>>', email_verified: true })
    const segment = base64url(payload)
    // The point of the case: the segment uses "-" and "_" and is not a multiple of 4 long, as a real token's often is.
    expect(segment).toMatch(/[-_]/)
    expect(segment.length % 4).not.toBe(0)
    const idToken = `${base64url('{"alg":"none"}')}.${segment}.`
    fetchMock.mockResolvedValueOnce(reply(200, { idToken }))
    await expect(signInWithPassword('vlad@example.com', 'secret', 'key-1')).resolves.toStrictEqual({ idToken, emailVerified: true })
  })

  it("rejects with the server's code for a refused sign-in", async () => {
    fetchMock.mockResolvedValueOnce(reply(400, { error: { code: 400, message: 'INVALID_LOGIN_CREDENTIALS', errors: [{ message: 'INVALID_LOGIN_CREDENTIALS', domain: 'global', reason: 'invalid' }] } }))
    const failure = signInWithPassword('vlad@example.com', 'nope', 'key-1')
    await expect(failure).rejects.toBeInstanceOf(ShortcutRestError)
    await expect(failure).rejects.toMatchObject({ step: 'sign-in', status: 400, code: 'INVALID_LOGIN_CREDENTIALS' })
  })

  it('keeps only the code of a message that carries an explanation after " : "', async () => {
    const message = 'TOO_MANY_ATTEMPTS_TRY_LATER : Access to this account has been temporarily disabled due to many failed login attempts.'
    fetchMock.mockResolvedValueOnce(reply(400, { error: { code: 400, message } }))
    await expect(signInWithPassword('vlad@example.com', 'nope', 'key-1')).rejects.toMatchObject({ step: 'sign-in', status: 400, code: 'TOO_MANY_ATTEMPTS_TRY_LATER' })
  })

  it('rejects with NETWORK and status 0 when no answer arrives at all', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(signInWithPassword('vlad@example.com', 'secret', 'key-1')).rejects.toMatchObject({ step: 'sign-in', status: 0, code: 'NETWORK' })
  })

  it.each(['TimeoutError', 'AbortError'])('rejects with TIMEOUT and status 0 when the signal ends the request (%s)', async (name) => {
    fetchMock.mockRejectedValueOnce(new DOMException('The operation timed out.', name))
    await expect(signInWithPassword('vlad@example.com', 'secret', 'key-1')).rejects.toMatchObject({ step: 'sign-in', status: 0, code: 'TIMEOUT' })
  })

  it('rejects with the status as the code when the answer has no error in it', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Service Unavailable</html>', { status: 503 }))
    await expect(signInWithPassword('vlad@example.com', 'secret', 'key-1')).rejects.toMatchObject({ step: 'sign-in', status: 503, code: '503' })
  })

  it('rejects an answer without a token (a Wi-Fi login page, say) instead of sending "Bearer undefined" on', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Sign in to the Wi-Fi</html>', { status: 200 }))
    await expect(signInWithPassword('vlad@example.com', 'secret', 'key-1')).rejects.toMatchObject({ step: 'sign-in', status: 200, code: 'BAD_RESPONSE' })
  })
})

describe('createTransactionViaRest', () => {
  it("posts the entry's typed fields with the token to the transactions URL and returns the new document's id", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { name: 'projects/p/databases/(default)/documents/transactions/abc', fields: firestoreFields(ENTRY) }))
    await expect(createTransactionViaRest(ENTRY, 'p', 't')).resolves.toStrictEqual({ id: 'abc' })
    const { url, init, body } = sent()
    expect(url).toBe('https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents/transactions')
    expect(init).toStrictEqual({ method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: init.body, signal: expect.any(AbortSignal) })
    expect(body).toStrictEqual({ fields: firestoreFields(ENTRY) })
  })

  it('goes to the hosts it is given', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { name: 'projects/demo/databases/(default)/documents/transactions/x9' }))
    await expect(createTransactionViaRest(ENTRY, 'demo', 't', EMULATORS)).resolves.toStrictEqual({ id: 'x9' })
    expect(sent().url).toBe('http://127.0.0.1:8080/v1/projects/demo/databases/(default)/documents/transactions')
  })

  it("rejects with Firestore's status for an entry the rules refuse", async () => {
    fetchMock.mockResolvedValueOnce(reply(403, { error: { code: 403, message: "\nfalse for 'create' @ L56", status: 'PERMISSION_DENIED' } }))
    const failure = createTransactionViaRest(ENTRY, 'p', 't')
    await expect(failure).rejects.toBeInstanceOf(ShortcutRestError)
    await expect(failure).rejects.toMatchObject({ step: 'write', status: 403, code: 'PERMISSION_DENIED' })
  })

  it('rejects with NETWORK and status 0 when no answer arrives at all', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Load failed'))
    await expect(createTransactionViaRest(ENTRY, 'p', 't')).rejects.toMatchObject({ step: 'write', status: 0, code: 'NETWORK' })
  })

  it('rejects with TIMEOUT and status 0 when the time runs out', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'))
    await expect(createTransactionViaRest(ENTRY, 'p', 't')).rejects.toMatchObject({ step: 'write', status: 0, code: 'TIMEOUT' })
  })

  it('rejects with the status as the code when the answer has no error in it', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Bad gateway', { status: 502 }))
    await expect(createTransactionViaRest(ENTRY, 'p', 't')).rejects.toMatchObject({ step: 'write', status: 502, code: '502' })
  })

  it('rejects an answer without a document name', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Sign in to the Wi-Fi</html>', { status: 200 }))
    await expect(createTransactionViaRest(ENTRY, 'p', 't')).rejects.toMatchObject({ step: 'write', status: 200, code: 'BAD_RESPONSE' })
  })

  it('sends nothing for an amount the rules would refuse', async () => {
    await expect(createTransactionViaRest({ ...ENTRY, amount: 12.5 }, 'p', 't')).rejects.toBeInstanceOf(RangeError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('the time limit', () => {
  it('gives each of the two calls its own 15-second signal', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    try {
      fetchMock
        .mockResolvedValueOnce(reply(200, { idToken: token(OWNER_CLAIMS) }))
        .mockResolvedValueOnce(reply(200, { name: 'projects/p/databases/(default)/documents/transactions/abc' }))
      await signInWithPassword('vlad@example.com', 'secret', 'key-1')
      await createTransactionViaRest(ENTRY, 'p', 't')
      expect(timeout.mock.calls).toStrictEqual([[15_000], [15_000]])
      const signals = fetchMock.mock.calls.map(([, init]) => init?.signal)
      expect(signals).toStrictEqual(timeout.mock.results.map((r) => r.value))
      expect(signals[0]).not.toBe(signals[1])
    } finally {
      timeout.mockRestore()
    }
  })
})

describe('shortcutErrorText', () => {
  const PROVIDER_OFF = 'Email/password sign-in is off. Turn it on in Firebase Console → Authentication → Sign-in method.'
  const WRONG_PASSWORD = 'Wrong password. Reset it in step 1 and paste the new one.'

  it.each([
    { step: 'sign-in', status: 400, code: 'OPERATION_NOT_ALLOWED', text: PROVIDER_OFF },
    // What a password sign-in gets while the provider is off (the SDK's server-error map and the Auth emulator agree).
    { step: 'sign-in', status: 400, code: 'PASSWORD_LOGIN_DISABLED', text: PROVIDER_OFF },
    { step: 'sign-in', status: 400, code: 'INVALID_LOGIN_CREDENTIALS', text: WRONG_PASSWORD },
    { step: 'sign-in', status: 400, code: 'INVALID_PASSWORD', text: WRONG_PASSWORD },
    { step: 'sign-in', status: 400, code: 'EMAIL_NOT_FOUND', text: WRONG_PASSWORD },
    { step: 'sign-in', status: 400, code: 'TOO_MANY_ATTEMPTS_TRY_LATER', text: 'Too many attempts. Try again in a few minutes.' },
    { step: 'write', status: 403, code: 'PERMISSION_DENIED', text: "Firestore refused the entry. The email must be the owner's and verified (see step 3)." },
    { step: 'sign-in', status: 0, code: 'NETWORK', text: "You're offline." },
    { step: 'write', status: 0, code: 'NETWORK', text: "You're offline." },
    { step: 'write', status: 0, code: 'TIMEOUT', text: 'The request timed out. Check the connection and try again.' },
  ] as const)('explains $code', ({ step, status, code, text }) => {
    expect(shortcutErrorText(new ShortcutRestError(step, status, code))).toBe(text)
  })

  it.each([
    new ShortcutRestError('write', 429, 'RESOURCE_EXHAUSTED'),
    new ShortcutRestError('write', 429, '429'),
    new ShortcutRestError('sign-in', 429, 'QUOTA_EXCEEDED'),
    new ShortcutRestError('write', 400, 'RESOURCE_EXHAUSTED'),
  ])('says the quota is reached for $code ($status), in the words of the read errors', (error) => {
    expect(shortcutErrorText(error)).toBe(readErrorText({ code: 'resource-exhausted' }))
    expect(shortcutErrorText(error)).toBe('Firebase quota reached, data will refresh after midnight PT')
  })

  it('names the code of any other refusal, or its status when it had none', () => {
    expect(shortcutErrorText(new ShortcutRestError('write', 401, 'UNAUTHENTICATED'))).toBe('Something went wrong (UNAUTHENTICATED).')
    expect(shortcutErrorText(new ShortcutRestError('write', 500, '500'))).toBe('Something went wrong (500).')
  })

  it('names the message of any other error', () => {
    expect(shortcutErrorText(new Error('x'))).toBe('Something went wrong (x).')
    expect(shortcutErrorText(new RangeError('The amount must be a whole number above 0, not 12.5'))).toBe('Something went wrong (The amount must be a whole number above 0, not 12.5).')
  })

  it.each([null, undefined, 'boom', 42, { code: 'PERMISSION_DENIED' }, new Error('')])('falls back to a plain sentence for %j', (value) => {
    expect(shortcutErrorText(value)).toBe('Something went wrong.')
  })
})

describe('ShortcutRestError', () => {
  it('is an Error that says which call failed and how, for logs', () => {
    const error = new ShortcutRestError('write', 403, 'PERMISSION_DENIED')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ShortcutRestError')
    expect(error.message).toBe('The write failed: PERMISSION_DENIED (403)')
  })
})
