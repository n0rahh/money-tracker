import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { categoryDictionary, DEFAULT_HOSTS, firestoreFields, generateShortcutPassword, SHORTCUT_RECIPE, signInUrl, transactionsUrl, type ShortcutEntry } from './shortcut'
import { createTransactionViaRest, signInWithPassword } from './shortcutRest'
import type { Category } from './types'

/** The Global Constraints example: €12.50 on 20 Oct 2026 at 17:05 UTC. */
const ENTRY: ShortcutEntry = { kind: 'expense', amount: 1250, categoryId: 'c1', note: '', date: '2026-10-20', at: new Date('2026-10-20T17:05:00Z') }

describe('firestoreFields', () => {
  it('types the seven fields the rules check: the amount as an integer string, the moment in UTC, the source shortcut', () => {
    expect(firestoreFields(ENTRY)).toStrictEqual({
      kind: { stringValue: 'expense' },
      amount: { integerValue: '1250' },
      categoryId: { stringValue: 'c1' },
      note: { stringValue: '' },
      date: { stringValue: '2026-10-20' },
      at: { timestampValue: '2026-10-20T17:05:00.000Z' },
      source: { stringValue: 'shortcut' },
    })
  })

  it('carries the kind, the category, the note and the date as given', () => {
    const fields = firestoreFields({ ...ENTRY, kind: 'income', categoryId: 'salary', note: 'October pay', date: '2026-10-01' })
    expect(fields).toMatchObject({
      kind: { stringValue: 'income' },
      categoryId: { stringValue: 'salary' },
      note: { stringValue: 'October pay' },
      date: { stringValue: '2026-10-01' },
    })
  })

  it('accepts every whole amount from 1 to the largest safe integer', () => {
    expect(firestoreFields({ ...ENTRY, amount: 1 }).amount).toStrictEqual({ integerValue: '1' })
    expect(firestoreFields({ ...ENTRY, amount: Number.MAX_SAFE_INTEGER }).amount).toStrictEqual({ integerValue: '9007199254740991' })
  })

  it.each([12.5, 0, -1, Number.NaN, 2 ** 53, Number.POSITIVE_INFINITY])('refuses the amount %s', (amount) => {
    expect(() => firestoreFields({ ...ENTRY, amount })).toThrow(RangeError)
  })
})

describe('generateShortcutPassword', () => {
  /** Hands out the given bytes in order, then zeros, however many each call asks for. */
  const bytesFrom = (values: number[]) => {
    const queue = [...values]
    return (bytes: Uint8Array) => {
      for (let i = 0; i < bytes.length; i++) bytes[i] = queue.shift() ?? 0
      return bytes
    }
  }
  const counting = () => bytesFrom(Array.from({ length: 256 }, (_, i) => i))

  it('makes 24 letters and digits', () => {
    const password = generateShortcutPassword()
    expect(password).toHaveLength(24)
    expect(password).toMatch(/^[A-Za-z0-9]{24}$/)
  })

  it('makes a different one each time', () => {
    expect(generateShortcutPassword()).not.toBe(generateShortcutPassword())
  })

  it('maps the bytes 0, 1, 2, … onto A to Z, a to z and 0 to 9, in that order', () => {
    const random = counting()
    expect(generateShortcutPassword(random)).toBe('ABCDEFGHIJKLMNOPQRSTUVWX')
    expect(generateShortcutPassword(random)).toBe('YZabcdefghijklmnopqrstuv')
    expect(generateShortcutPassword(random)).toBe('wxyz0123456789ABCDEFGHIJ')
  })

  it('skips the bytes 248 to 255, so that every character is equally likely, and asks for more bytes to make up for them', () => {
    // 247 is the last byte kept (it reads as "9"); 248 and 255 would read as "A" and "H" if they were not skipped.
    const random = bytesFrom([255, 248, 247, ...Array.from({ length: 40 }, (_, i) => i)])
    expect(generateShortcutPassword(random)).toBe('9ABCDEFGHIJKLMNOPQRSTUVW')
  })

  it('makes up for a single skipped byte too: 23 characters from the first round, the 24th from a second', () => {
    const random = vi.fn(bytesFrom([255, ...Array.from({ length: 46 }, (_, i) => i)]))
    expect(generateShortcutPassword(random)).toBe('ABCDEFGHIJKLMNOPQRSTUVWX')
    expect(random).toHaveBeenCalledTimes(2)
  })
})

describe('categoryDictionary', () => {
  const cat = (id: string, name: string, order: number, extra: Partial<Category> = {}): Category => ({
    id, name, order, kind: 'expense', archived: false, icon: 'Coffee', color: 'amber', ...extra,
  })
  const CATEGORIES = [
    cat('transport', 'Transport', 3),
    cat('groceries', 'Groceries', 1),
    cat('coffee', 'Coffee', 2),
    cat('phone', 'Old phone', 0, { archived: true }),
    cat('salary', 'Salary', 0, { kind: 'income' }),
    cat('bonus', 'Bonus', 1, { kind: 'income', archived: true }),
    cat('coffee-2', 'Coffee', 5),
    cat('coffee-3', 'Coffee', 6),
  ]

  it('maps the names of the active categories of one kind to their ids, in their order, two spaces deep', () => {
    expect(categoryDictionary(CATEGORIES, 'expense')).toBe(
      '{\n  "Groceries": "groceries",\n  "Coffee": "coffee",\n  "Transport": "transport",\n  "Coffee (2)": "coffee-2",\n  "Coffee (3)": "coffee-3"\n}',
    )
    expect(categoryDictionary(CATEGORIES, 'income')).toBe('{\n  "Salary": "salary"\n}')
  })

  it('reads back with JSON.parse, with one key per category: a repeated name keeps every category apart', () => {
    expect(JSON.parse(categoryDictionary(CATEGORIES, 'expense'))).toStrictEqual({
      Groceries: 'groceries', Coffee: 'coffee', Transport: 'transport', 'Coffee (2)': 'coffee-2', 'Coffee (3)': 'coffee-3',
    })
  })

  it('never gives two categories the same key, even when a name already ends in a number', () => {
    const categories = [cat('a', 'Coffee', 0), cat('b', 'Coffee (2)', 1), cat('c', 'Coffee', 2)]
    expect(JSON.parse(categoryDictionary(categories, 'expense'))).toStrictEqual({ Coffee: 'a', 'Coffee (2)': 'b', 'Coffee (3)': 'c' })
  })

  it('keeps a name that is also a property of every object as it is', () => {
    expect(JSON.parse(categoryDictionary([cat('t', 'toString', 0), cat('c', 'constructor', 1)], 'expense'))).toStrictEqual({ toString: 't', constructor: 'c' })
  })

  it('keeps the order of the categories for names of digits only, which an object would move to the front', () => {
    const categories = [cat('y', '2026', 0), cat('g', 'Groceries', 1), cat('s', '7', 2)]
    expect(categoryDictionary(categories, 'expense')).toBe('{\n  "2026": "y",\n  "Groceries": "g",\n  "7": "s"\n}')
  })

  it('drops every "." from the names, which the Shortcut would read as a path into the dictionary, then keeps the keys apart', () => {
    const categories = [cat('dr', 'Dr. visits', 0), cat('usa', 'U.S.A. trip', 1), cat('dr-2', 'Dr visits', 2), cat('dr-3', 'Dr. visits', 3)]
    expect(categoryDictionary(categories, 'expense')).toBe(
      '{\n  "Dr visits": "dr",\n  "USA trip": "usa",\n  "Dr visits (2)": "dr-2",\n  "Dr visits (3)": "dr-3"\n}',
    )
  })

  it('calls a name that nothing is left of once its dots are gone "Unnamed", never an empty key, and keeps those apart too', () => {
    const categories = [cat('a', '...', 0), cat('b', ' . ', 1), cat('c', 'Unnamed', 2)]
    expect(categoryDictionary(categories, 'expense')).toBe('{\n  "Unnamed": "a",\n  "Unnamed (2)": "b",\n  "Unnamed (3)": "c"\n}')
  })

  it('escapes quotes in a name, so the pasted text stays valid JSON', () => {
    expect(JSON.parse(categoryDictionary([cat('q', 'Say "cheese"', 0)], 'expense'))).toStrictEqual({ 'Say "cheese"': 'q' })
  })

  it('is an empty dictionary when the kind has no active category', () => {
    expect(categoryDictionary([cat('phone', 'Old phone', 0, { archived: true })], 'expense')).toBe('{}')
  })
})

describe('the two URLs', () => {
  it("are the plan's URLs on Google's hosts", () => {
    expect(signInUrl('k')).toBe('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=k')
    expect(transactionsUrl('p')).toBe('https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents/transactions')
  })

  it('put the same paths on other hosts, such as the emulators', () => {
    const hosts = { identity: 'http://127.0.0.1:9099/identitytoolkit.googleapis.com', firestore: 'http://127.0.0.1:8080' }
    expect(signInUrl('fake-api-key', hosts)).toBe('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key')
    expect(transactionsUrl('demo-money-tracker', hosts)).toBe('http://127.0.0.1:8080/v1/projects/demo-money-tracker/databases/(default)/documents/transactions')
  })

  it("default to Google's hosts, written without a trailing slash", () => {
    expect(DEFAULT_HOSTS).toStrictEqual({ identity: 'https://identitytoolkit.googleapis.com', firestore: 'https://firestore.googleapis.com' })
  })

  it('encode the key and the project id, so a stray character cannot change the request', () => {
    expect(signInUrl('a&b c')).toBe('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=a%26b%20c')
    expect(transactionsUrl('p/q')).toBe('https://firestore.googleapis.com/v1/projects/p%2Fq/databases/(default)/documents/transactions')
  })
})

describe('SHORTCUT_RECIPE', () => {
  it('has the 14 steps of the plan, in order, each with one sentence of detail', () => {
    expect(SHORTCUT_RECIPE.map((step) => step.title)).toStrictEqual([
      'Ask for Input',
      'Calculate',
      'Round Number',
      'Format Number + Replace Text',
      'Text (categories)',
      'Get Dictionary from Input',
      'Get Dictionary Value (All Keys)',
      'Choose from List',
      'Get Dictionary Value (the id)',
      'Get Contents of URL (sign in)',
      'Get Dictionary Value (idToken)',
      'Format Date (twice)',
      'Text (body)',
      'Get Contents of URL (write) + If + Show Notification',
    ])
    for (const { detail } of SHORTCUT_RECIPE) {
      expect(detail).toMatch(/^[A-Z].*\.$/)
      expect(detail.slice(0, -1)).not.toMatch(/\.\s/)
    }
  })
})

describe('docs/shortcut.md, which the owner builds the Shortcut from', () => {
  // From the project root, where the tests run, as the rules tests read firestore.rules.
  const docs = readFileSync('docs/shortcut.md', 'utf8')

  /** Step `n` of the recipe in the docs: its heading and what follows, up to the next heading. */
  function step(n: number): string {
    const start = docs.indexOf(`\n### ${n}. `)
    if (start === -1) throw new Error(`docs/shortcut.md has no step ${n}`)
    const rest = docs.slice(start + 1)
    const end = rest.search(/\n#{1,6} /)
    return end === -1 ? rest : rest.slice(0, end)
  }
  /** The line of a step's first JSON block, which the owner pastes. */
  const pasted = (section: string) => /```json\n(.+)\n```/.exec(section)?.[1] ?? ''

  /** The body of the one request the app's client sends for `call`, answered with `answer`. */
  async function bodySent(call: () => Promise<unknown>, answer: object): Promise<string> {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(answer), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await call()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    return String(fetchMock.mock.calls[0]?.[1]?.body)
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("fills step 13's template, its four placeholders replaced by the entry's values, into exactly the body the client sends", async () => {
    const template = pasted(step(13))
    // In the order of the table under it: the day's Formatted Date first, then the moment's.
    expect(template.match(/<[^>]+>/g)).toStrictEqual(['<Updated Text>', '<Dictionary Value>', '<Formatted Date>', '<Formatted Date>'])
    const filled = template
      .replace('<Updated Text>', String(ENTRY.amount))
      .replace('<Dictionary Value>', ENTRY.categoryId)
      .replace('<Formatted Date>', ENTRY.date)
      .replace('<Formatted Date>', ENTRY.at.toISOString())
    const sent = await bodySent(() => createTransactionViaRest(ENTRY, 'p', 't'), { name: 'projects/p/databases/(default)/documents/transactions/abc' })
    expect(filled).toBe(sent)
  })

  it("shows step 10's body, the email and the password put in, as exactly the client's sign-in body", async () => {
    const filled = pasted(step(10)).replace('<owner email>', 'vlad@example.com').replace('<password>', 'Pw1')
    const sent = await bodySent(() => signInWithPassword('vlad@example.com', 'Pw1', 'k'), { idToken: 'header.payload.signature' })
    expect(filled).toBe(sent)
  })

  it.each([
    // Format Number may group the digits ("1,250"): only a pattern that keeps digits alone makes them plain.
    { n: 4, docs: '`[^0-9]`', page: 'find [^0-9]' },
    // The body is the Text of step 13 as it is: a "JSON" body would be rebuilt from fields by Shortcuts.
    { n: 14, docs: '"Request Body": "File"', page: 'Request Body "File"' },
  ])('agrees with the page on step $n', ({ n, docs: inDocs, page }) => {
    expect(step(n)).toContain(inDocs)
    expect(SHORTCUT_RECIPE[n - 1]?.detail).toContain(page)
  })
})
