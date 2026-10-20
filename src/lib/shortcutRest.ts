// The Shortcut's two HTTP calls, made from the app with fetch exactly as the Shortcut makes them, so the owner can test
// the whole path (the password, the provider switch in the console, the verified email, the rules) before building it.
// No Firebase SDK here: it would send its own requests, and a pass would prove nothing about the Shortcut's.
import { readErrorText } from './readError'
import { DEFAULT_HOSTS, firestoreFields, PROVIDER_OFF_TEXT, signInUrl, transactionsUrl, type RestHosts, type ShortcutEntry } from './shortcut'

type Step = 'sign-in' | 'write'

/**
 * A refused or failed call. `code` is what the server named the failure: Identity Toolkit's `error.message`
 * (`INVALID_LOGIN_CREDENTIALS`) for the sign-in, Firestore's `error.status` (`PERMISSION_DENIED`) for the write; the HTTP
 * status as text when the answer held no error; with status 0, `NETWORK` when no answer came at all and `TIMEOUT` when
 * none came within REQUEST_TIMEOUT_MS.
 */
export class ShortcutRestError extends Error {
  readonly step: Step
  readonly status: number
  readonly code: string

  constructor(step: Step, status: number, code: string) {
    super(`The ${step} failed: ${code} (${status})`)
    this.name = 'ShortcutRestError'
    this.step = step
    this.status = status
    this.code = code
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** How long each call may take: without a limit, a stalled connection would keep the page's test running for minutes. */
const REQUEST_TIMEOUT_MS = 15_000

/**
 * The code an error answer names. Identity Toolkit may follow its code with " : " and an explanation
 * ("TOO_MANY_ATTEMPTS_TRY_LATER : Access to this account has been temporarily disabled…"); only the code is kept, as the
 * Firebase SDK does.
 */
function errorCode(step: Step, body: unknown): string | undefined {
  const error = isRecord(body) ? body.error : undefined
  if (!isRecord(error)) return undefined
  const named = step === 'sign-in' ? error.message : error.status
  return typeof named === 'string' && named.trim() !== '' ? named.split(' : ')[0].trim() : undefined
}

/** One POST with a JSON body; resolves with the answer's status and JSON object, or rejects with a ShortcutRestError. */
async function post(step: Step, url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (e) {
    // fetch rejects only when no answer arrived: the signal's TimeoutError (an AbortError in older engines) when the time
    // ran out, a TypeError for no connection, a failed DNS lookup or a request cut off.
    const name = isRecord(e) ? e.name : undefined
    throw new ShortcutRestError(step, 0, name === 'TimeoutError' || name === 'AbortError' ? 'TIMEOUT' : 'NETWORK')
  }
  // An answer that is no JSON (a proxy's or a Wi-Fi login page's HTML) reads as an empty one.
  const json: unknown = await response.json().catch(() => undefined)
  if (!response.ok) throw new ShortcutRestError(step, response.status, errorCode(step, json) ?? String(response.status))
  return { status: response.status, json: isRecord(json) ? json : {} }
}

/**
 * Whether the ID token says the email is verified, which the rules require (spec §5). Read from the token's own payload
 * (base64url JSON, the second of its three parts), because that claim, not the user record, is what the rules see. A
 * token that cannot be read counts as unverified.
 */
function emailVerifiedClaim(idToken: string): boolean {
  try {
    // base64url back to base64; the missing "=" padding needs no restoring, atob's forgiving decode does without it.
    const base64 = (idToken.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/')
    // atob gives one character per byte; TextDecoder turns the bytes back into the UTF-8 text they are (a name in the
    // payload can be "Влад").
    const payload: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))))
    return isRecord(payload) && payload.email_verified === true
  } catch {
    return false
  }
}

/** The Shortcut's first call: a password sign-in, answered with an ID token whose payload says whether the email is verified. */
export async function signInWithPassword(email: string, password: string, apiKey: string, hosts: RestHosts = DEFAULT_HOSTS): Promise<{ idToken: string; emailVerified: boolean }> {
  const { status, json } = await post('sign-in', signInUrl(apiKey, hosts), {}, { email, password, returnSecureToken: true })
  // A 200 without a token (a Wi-Fi login page, say) stops here, rather than as a puzzling 401 on the write.
  if (typeof json.idToken !== 'string' || json.idToken === '') throw new ShortcutRestError('sign-in', status, 'BAD_RESPONSE')
  return { idToken: json.idToken, emailVerified: emailVerifiedClaim(json.idToken) }
}

/** The Shortcut's second call: the entry as a new document with an auto-id, written with the ID token through the rules. */
export async function createTransactionViaRest(entry: ShortcutEntry, projectId: string, idToken: string, hosts: RestHosts = DEFAULT_HOSTS): Promise<{ id: string }> {
  // Built before anything is sent: an amount the rules would refuse throws its RangeError here.
  const fields = firestoreFields(entry)
  const { status, json } = await post('write', transactionsUrl(projectId, hosts), { Authorization: `Bearer ${idToken}` }, { fields })
  // The answer is the stored document; its name is projects/<p>/databases/(default)/documents/transactions/<id>.
  const id = typeof json.name === 'string' ? (json.name.split('/').pop() ?? '') : ''
  if (id === '') throw new ShortcutRestError('write', status, 'BAD_RESPONSE')
  return { id }
}

const WRONG_PASSWORD_TEXT = 'Wrong password. Reset it in step 1 and paste the new one.'
const ERROR_TEXTS = new Map<string, string>([
  ['OPERATION_NOT_ALLOWED', PROVIDER_OFF_TEXT],
  // What a password sign-in is answered while the provider is off (the SDK's server-error map; the Auth emulator agrees).
  ['PASSWORD_LOGIN_DISABLED', PROVIDER_OFF_TEXT],
  // INVALID_LOGIN_CREDENTIALS is the one code once email enumeration protection is on (the default for new projects);
  // without it a wrong password and an unknown email answer INVALID_PASSWORD and EMAIL_NOT_FOUND.
  ['INVALID_LOGIN_CREDENTIALS', WRONG_PASSWORD_TEXT],
  ['INVALID_PASSWORD', WRONG_PASSWORD_TEXT],
  ['EMAIL_NOT_FOUND', WRONG_PASSWORD_TEXT],
  ['TOO_MANY_ATTEMPTS_TRY_LATER', 'Too many attempts. Try again in a few minutes.'],
  ['PERMISSION_DENIED', "Firestore refused the entry. The email must be the owner's and verified (see step 3)."],
  ['NETWORK', "You're offline."],
  ['TIMEOUT', 'The request timed out. Check the connection and try again.'],
])

/** What a failed test on the Shortcut page says: a sentence that says what to do for the failures the owner can fix. */
export function shortcutErrorText(e: unknown): string {
  if (e instanceof ShortcutRestError) {
    if (e.status === 429 || e.code === 'RESOURCE_EXHAUSTED') return readErrorText({ code: 'resource-exhausted' })
    return ERROR_TEXTS.get(e.code) ?? `Something went wrong (${e.code}).`
  }
  return e instanceof Error && e.message !== '' ? `Something went wrong (${e.message}).` : 'Something went wrong.'
}
