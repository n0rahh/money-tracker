import type { Category, IsoDate, Kind } from './types'

/** One entry as the Shortcut sends it: a transaction without an id, a recurringId or server timestamps. */
export type ShortcutEntry = {
  kind: Kind
  /** Integer minor units (cents), above 0. */
  amount: number
  categoryId: string
  note: string
  date: IsoDate
  at: Date
}

/** A document's fields in the typed JSON of Firestore's REST API. */
export type FirestoreFields = Record<string, { stringValue: string } | { integerValue: string } | { timestampValue: string }>

/**
 * The entry's fields exactly as the Shortcut's write carries them (the plan's Global Constraints): the seven fields
 * `validTransaction` checks and nothing else. No createdAt or updatedAt: REST cannot ask for a server timestamp, and the
 * rules and the mapper treat both as optional. The amount goes as an `integerValue`, a decimal string, because the rules
 * want an int: a `doubleValue`, even 1250.0, is refused.
 */
export function firestoreFields(e: ShortcutEntry): FirestoreFields {
  // A fraction of a cent (1249.9999 from a × 100 left unrounded), 0 or a negative number would only be refused by the
  // rules, and a number beyond 2^53 is no longer the integer that was meant.
  if (!Number.isSafeInteger(e.amount) || e.amount <= 0) throw new RangeError(`The amount must be a whole number above 0, not ${e.amount}`)
  return {
    kind: { stringValue: e.kind },
    amount: { integerValue: String(e.amount) },
    categoryId: { stringValue: e.categoryId },
    note: { stringValue: e.note },
    date: { stringValue: e.date },
    at: { timestampValue: e.at.toISOString() },
    source: { stringValue: 'shortcut' },
  }
}

const PASSWORD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const PASSWORD_LENGTH = 24
/** 248, the largest multiple of 62 that a byte can hold: bytes from it up are skipped, as they would favour A to H. */
const UNBIASED_BYTES = 256 - (256 % PASSWORD_ALPHABET.length)

/**
 * The Shortcut's password: 24 letters and digits (about 143 bits), each byte mapped onto the alphabet without modulo
 * bias. Letters and digits only, so it survives being pasted into a JSON text in the Shortcuts app. `random` is
 * `crypto.getRandomValues` but for tests (whose DOM typing wants a buffer that cannot be shared, hence `<ArrayBuffer>`).
 */
export function generateShortcutPassword(random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  let password = ''
  while (password.length < PASSWORD_LENGTH) {
    for (const byte of random(new Uint8Array(PASSWORD_LENGTH))) {
      if (byte < UNBIASED_BYTES && password.length < PASSWORD_LENGTH) password += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]
    }
  }
  return password
}

/**
 * The text pasted into the Shortcut's categories step: `{ "name": "id" }` for the active categories of one kind, in their
 * order (the order the Shortcut's list shows them in), two spaces deep. A repeated name gets " (2)", " (3)", …: a JSON
 * object cannot hold one key twice, so without the suffix one of the categories would silently drop out of the list.
 * Archived categories stay out, as in every picker of the app.
 */
export function categoryDictionary(categories: Category[], kind: Kind): string {
  const active = categories.filter((c) => c.kind === kind && !c.archived).sort((a, b) => a.order - b.order)
  // The keys taken so far in a Set, not an object: "constructor" or "toString" would already be "in" a plain object.
  const taken = new Set<string>()
  const entries: [string, string][] = []
  for (const { id, name } of active) {
    let key = name
    for (let n = 2; taken.has(key); n++) key = `${name} (${n})`
    taken.add(key)
    entries.push([key, id])
  }
  return JSON.stringify(Object.fromEntries(entries), null, 2)
}

/**
 * The Shortcut, action by action (spec §14). The titles are the ones the page lists and docs/shortcut.md explains in
 * full, where every parameter is spelled out; each detail is the one sentence the page shows under its title.
 */
export const SHORTCUT_RECIPE: ReadonlyArray<{ title: string; detail: string }> = [
  { title: 'Ask for Input', detail: 'Input type Number with the prompt "Amount?" and decimal numbers allowed.' },
  { title: 'Calculate', detail: 'Multiply the Provided Input by 100, which gives the amount in cents.' },
  { title: 'Round Number', detail: 'Round the result to the nearest whole number (Ones Place).' },
  { title: 'Format Number + Replace Text', detail: 'Format Number, 0 decimal places; then Replace Text, regular expression on, find [^0-9] and replace with nothing, so the minor units are plain digits in every locale.' },
  { title: 'Text (categories)', detail: 'Paste the expense categories copied from this page.' },
  { title: 'Get Dictionary from Input', detail: 'Turn that text into a dictionary of category names and ids.' },
  { title: 'Get Dictionary Value (All Keys)', detail: 'Get All Keys of the dictionary, which are the category names.' },
  { title: 'Choose from List', detail: 'Choose from the names with the prompt "Category?".' },
  { title: 'Get Dictionary Value (the id)', detail: "Get the Value for the Chosen Item from the dictionary, which is the category's id." },
  { title: 'Get Contents of URL (sign in)', detail: 'POST to the sign-in URL with the JSON body email, password and returnSecureToken, a Boolean set to true.' },
  { title: 'Get Dictionary Value (idToken)', detail: 'Get the Value for idToken from the answer, the sign-in token for the next request.' },
  { title: 'Format Date (twice)', detail: 'Format the Current Date as yyyy-MM-dd (Custom), then again as ISO 8601 with the time included.' },
  { title: 'Text (body)', detail: 'A Text action holding the whole JSON body {"fields":{…}} with the four variables inserted: the digits from step 4, the id from step 9, the two dates from step 12.' },
  { title: 'Get Contents of URL (write) + If + Show Notification', detail: 'POST the transactions URL with headers Authorization "Bearer <idToken>" and Content-Type "application/json", Request Body "File" set to the Text from step 13; Get Dictionary Value "name" from the result; If it has any value, Show Notification "Added <Provided Input> to <Chosen Item>", otherwise show the result\'s "error.message".' },
]

/** What the app says while the Email/Password provider is still off in the console (only the owner can turn it on there). */
export const PROVIDER_OFF_TEXT = 'Email/password sign-in is off. Turn it on in Firebase Console → Authentication → Sign-in method.'

/** Where the two requests go: Google's hosts, or the emulators in a test. Base URLs without a trailing slash. */
export type RestHosts = { identity: string; firestore: string }

export const DEFAULT_HOSTS: RestHosts = { identity: 'https://identitytoolkit.googleapis.com', firestore: 'https://firestore.googleapis.com' }

/** The Shortcut's first request: a password sign-in that answers with an ID token. */
export function signInUrl(apiKey: string, hosts: RestHosts = DEFAULT_HOSTS): string {
  return `${hosts.identity}/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`
}

/** The Shortcut's second request: a document with an auto-id in `transactions`. */
export function transactionsUrl(projectId: string, hosts: RestHosts = DEFAULT_HOSTS): string {
  return `${hosts.firestore}/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/transactions`
}
