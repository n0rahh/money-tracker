// Import and export, end to end: the app's own data layer (importTransactions and the four one-shot reads of an export)
// and the import pipeline of the sheet, against the real rules. Only the app's Firebase set-up is swapped for the owner's
// emulator client, so everything from the parsed file to the rules is the shipped code.
import { assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, disableNetwork, doc, enableNetwork, getDocs, serverTimestamp, setDoc, setLogLevel, Timestamp, type Firestore } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyMapping, categoryKey, guessMapping, importRowIds, parseCsv, planCategories, type ColumnMapping } from '../../src/lib/csv'
import { DEFAULT_CATEGORIES } from '../../src/lib/defaultCategories'
import { buildCsvExport } from '../../src/lib/exporting'
import { createCategory, createTransaction, getAllBudgets, getAllCategories, getAllRecurring, getAllTransactions, importTransactions } from '../../src/lib/firestore'
import type { TransactionInput } from '../../src/lib/types'

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

type Row = { id: string; input: TransactionInput & { source: 'import' } }
const row = (i: number, over: Partial<Row['input']> = {}): Row => ({
  id: `imp_${String(i).padStart(24, '0')}`,
  input: { kind: 'expense', amount: 100 + i, categoryId: 'c1', note: `n${i}`, date: '2026-09-15', source: 'import', ...over },
})
/** A collection as the server holds it, read through a fresh client (no local cache). */
const serverDocs = async (name: string) => (await assertSucceeds(getDocs(collection(owner(), name)))).docs

async function seedDefaults() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore
    for (const c of DEFAULT_CATEGORIES) await setDoc(doc(collection(db, 'categories')), { ...c, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  })
}

/** What ImportSheet's import does, minus React: guess, map, plan the categories, ids, then the writes. */
async function runImport(text: string) {
  const [header, ...rows] = parseCsv(text)
  const mapping = guessMapping(header)
  if (!mapping) throw new Error('no mapping')
  const { ok, errors } = applyMapping(rows, mapping, 2)
  const plan = planCategories(ok, await getAllCategories())
  const ids = await importRowIds(ok)
  const categoryIds = new Map(plan.matched)
  const created = plan.create.map(({ key, input }) => {
    const category = createCategory(input)
    categoryIds.set(key, category.id)
    return category.done
  })
  const docs = ok.map((r, i) => {
    const categoryId = categoryIds.get(categoryKey(r.kind, r.categoryName))
    if (categoryId === undefined) throw new Error(`no category for ${r.categoryName}`)
    return { id: ids[i], input: { kind: r.kind, amount: r.amount, categoryId, note: r.note, date: r.date, source: 'import' as const } }
  })
  const [count] = await Promise.all([importTransactions(docs), Promise.all(created)])
  return { ok, errors, plan, ids, count }
}

describe('importTransactions against the rules', () => {
  it('writes batches of 400 under the given ids as import entries, never with a recurringId, and the same documents again', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => row(i))
    rows[3] = row(3, { recurringId: 'tpl-1' }) // an input that carries a template id
    const progress: number[] = []
    expect(await importTransactions(rows, (done) => progress.push(done))).toBe(1001)
    expect(progress).toEqual([400, 800, 1001])
    const docs = await serverDocs('transactions')
    expect(docs).toHaveLength(1001)
    expect(docs.map((d) => d.id).sort()).toEqual(rows.map((r) => r.id).sort())
    for (const d of docs) {
      const data = d.data()
      expect(Object.keys(data).sort()).toEqual(['amount', 'at', 'categoryId', 'createdAt', 'date', 'kind', 'note', 'source', 'updatedAt'])
      expect(data.source).toBe('import')
      expect((data.at as Timestamp).toDate().getHours()).toBe(12) // back-dated: local noon
    }
    expect(await importTransactions(rows)).toBe(1001) // the same rows again overwrite
    expect(await serverDocs('transactions')).toHaveLength(1001)
  })

  it('fails a whole batch of 400 on one refused row, writes the others, and rejects only once every batch has settled', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => row(i))
    rows[500] = row(500, { amount: 0 }) // in the second batch
    const progress: number[] = []
    await expect(importTransactions(rows, (done) => progress.push(done))).rejects.toMatchObject({ code: 'permission-denied' })
    // Settled means settled: the third batch is on the server when the rejection arrives.
    expect(await serverDocs('transactions')).toHaveLength(601)
    expect(progress).toEqual([400, 601])
  })

  it('writes nothing for no rows', async () => {
    expect(await importTransactions([])).toBe(0)
    expect(await serverDocs('transactions')).toHaveLength(0)
  })
})

describe('the importer trims to exactly what the rules accept', () => {
  const M: ColumnMapping = { date: 0, amount: 1, kind: null, category: 2, note: 3, signMeansExpense: true }
  // One character each of 1, 2 and 8 UTF-16 units, in one code point or several: n, é, a CJK ideograph, an emoji, e with a
  // combining accent, a family emoji joined by zero-width joiners. Escaped, so none of them hides in the source.
  const UNITS = ['n', '\u00e9', '\u4e2d', '\u{1F600}', 'e\u0301', '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}']

  it('writes notes of 195 to 210 units and names of 35 to 45 units, in every kind of character', async () => {
    let n = 0
    for (const ch of UNITS) {
      for (let length = 195; length <= 210; length++) {
        const note = ch.repeat(Math.ceil(length / ch.length))
        const { ok } = applyMapping([['2026-10-01', '1', 'Food', note]], M, 2)
        expect(ok[0].note.length).toBeLessThanOrEqual(200)
        // At most one character is lost beyond the limit.
        expect(ok[0].note.length).toBeGreaterThan(Math.min(note.length, 200) - ch.length)
        await assertSucceeds(
          setDoc(doc(owner(), 'transactions', `t${n++}`), { kind: 'expense', amount: 1, categoryId: 'c', note: ok[0].note, date: '2026-10-01', at: Timestamp.now(), source: 'import' }),
        )
      }
      for (let length = 35; length <= 45; length++) {
        const name = ch.repeat(Math.ceil(length / ch.length))
        const { ok } = applyMapping([['2026-10-01', '1', name, '']], M, 2)
        expect(ok[0].categoryName.length).toBeLessThanOrEqual(40)
        await createCategory({ name: ok[0].categoryName, icon: 'CircleEllipsis', color: 'slate', kind: 'expense', order: 1, archived: false }).done
      }
    }
  })

  it('counts UTF-16 code units, as the cut does: not code points, not bytes', async () => {
    const emoji = '\u{1F600}'
    const tx = (note: string) => ({ kind: 'expense', amount: 1, categoryId: 'c', note, date: '2026-10-01', at: Timestamp.now(), source: 'import' })
    const accepted = async (data: Record<string, unknown>, id: string) => setDoc(doc(owner(), 'transactions', id), data).then(() => true, () => false)
    expect({
      n200: await accepted(tx('n'.repeat(200)), 'a'),
      n201: await accepted(tx('n'.repeat(201)), 'b'),
      emoji100: await accepted(tx(emoji.repeat(100)), 'c'),
      emoji101: await accepted(tx(emoji.repeat(101)), 'd'),
      cjk200: await accepted(tx('\u4e2d'.repeat(200)), 'e'),
      max: await accepted({ ...tx(''), amount: 99_999_999_999 }, 'f'),
      over: await accepted({ ...tx(''), amount: 100_000_000_000 }, 'g'),
    }).toEqual({ n200: true, n201: false, emoji100: true, emoji101: false, cjk200: true, max: true, over: false })
  })
})

describe('exports read from the server only', () => {
  it('fail with unavailable for all four reads offline, though the cache holds the data', async () => {
    const db = appDb()
    await setDoc(doc(db, 'transactions', 'offline-1'), { kind: 'expense', amount: 1, categoryId: 'c', note: '', date: '2026-10-01', at: Timestamp.now(), source: 'app' })
    expect(await getAllTransactions()).toHaveLength(1)
    await disableNetwork(db)
    try {
      for (const [name, read] of [['transactions', getAllTransactions], ['categories', getAllCategories], ['budgets', getAllBudgets], ['recurring', getAllRecurring]] as const) {
        await expect(read(), name).rejects.toMatchObject({ code: 'unavailable' })
      }
      // The cache had it all along: a getDocs export would have gone through with whatever it holds.
      expect((await getDocs(collection(db, 'transactions'))).size).toBe(1)
    } finally {
      await enableNetwork(db)
    }
  })

  it('leave out a budget that is no limit, and give the templates in their order', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore
      // A malformed budget written by hand (the console), which the backup leaves out.
      await setDoc(doc(db, 'budgets', 'bad'), { monthly: 'abc' })
      await setDoc(doc(db, 'budgets', 'good'), { monthly: 5000 })
      const template = { kind: 'expense', amount: 1, categoryId: 'c', note: '', dayOfMonth: 5, endMonth: null, lastAppliedMonth: null }
      await setDoc(doc(db, 'recurring', 'a-later'), { ...template, startMonth: '2026-09' })
      await setDoc(doc(db, 'recurring', 'z-early'), { ...template, startMonth: '2026-01' })
    })
    expect(await getAllBudgets()).toEqual([{ categoryId: 'good', monthly: 5000 }])
    expect((await getAllRecurring()).map((t) => t.id)).toEqual(['z-early', 'a-later'])
  })

  it('include an entry that a date-and-time order would leave out: one written by hand without its time', async () => {
    await env.withSecurityRulesDisabled(async (ctx) =>
      setDoc(doc(ctx.firestore() as unknown as Firestore, 'transactions', 'by-hand'), { kind: 'expense', amount: 1, categoryId: 'c', note: '', date: '2026-10-01' }),
    )
    expect((await getAllTransactions()).map((t) => t.id)).toEqual(['by-hand'])
  })
})

const MONEY_MANAGER = [
  'Date,Account,Category,Subcategory,Note,PLN,Income/Expense,Description,Amount,Currency',
  '14.10.2026,Cash,groceries,,"Milk, bread",12.50,Expense,,"12,50",PLN',
  '12.10.2026,Bank,Salary,,October,5000.00,Income,,"5 000,00",PLN',
  '11.10.2026,Cash,Books,,"Dune, ""deluxe""",45.00,Expense,,"45,00",PLN',
  '11.10.2026,Cash,Books,,"Dune, ""deluxe""",45.00,Expense,,"45,00",PLN',
  '03.09.2026,Cash,books,,,30.00,Expense,,"30,00",PLN',
  '02.09.2026,Card,Eating out,,Lunch,25.00,Expense,,"25,00",PLN',
  '01.09.2026,Card,Eating out,,,0.00,Expense,,"0,00",PLN',
  '31.08.2026,Card,Bank,,,100.00,Transfer-Out,,"100,00",PLN',
].join('\r\n')

describe('the import pipeline of the sheet, against the rules', () => {
  it('imports a Money Manager file once: a second run adds nothing and creates no category twice', async () => {
    await seedDefaults()
    const first = await runImport(MONEY_MANAGER)
    const second = await runImport(MONEY_MANAGER)
    expect(first.ok).toHaveLength(6) // the file has two identical Dune rows: two entries
    expect(first.plan.create.map((c) => c.input.name)).toEqual(['Books'])
    expect(second.plan.create).toHaveLength(0)
    const docs = await serverDocs('transactions')
    expect(docs).toHaveLength(6)
    expect(docs.every((d) => /^imp_[0-9a-f]{24}$/.test(d.id))).toBe(true)
    expect(await serverDocs('categories')).toHaveLength(DEFAULT_CATEGORIES.length + 1)
  })

  it("puts the app's own CSV export back in place: three entries stay three, import after import", async () => {
    await seedDefaults()
    const categories = await getAllCategories()
    const groceries = categories.find((c) => c.name === 'Groceries' && c.kind === 'expense')
    const salary = categories.find((c) => c.name === 'Salary' && c.kind === 'income')
    if (!groceries || !salary) throw new Error('no default categories')
    // Two equal entries on one day (a coffee in the morning and one in the evening), and a salary.
    await createTransaction({ kind: 'expense', amount: 1250, categoryId: groceries.id, note: 'Milk', date: '2026-10-14', at: new Date(2026, 9, 14, 8, 30) }).done
    await createTransaction({ kind: 'expense', amount: 1250, categoryId: groceries.id, note: 'Milk', date: '2026-10-14', at: new Date(2026, 9, 14, 18, 45) }).done
    await createTransaction({ kind: 'income', amount: 500_000, categoryId: salary.id, note: '', date: '2026-10-12' }).done
    const before = await getAllTransactions()
    const csv = buildCsvExport(before, new Map(categories.map((c) => [c.id, c])), 'PLN')

    const first = await runImport(csv)
    const afterOne = await getAllTransactions()
    await runImport(csv)
    const afterTwo = await getAllTransactions()

    expect([before.length, afterOne.length, afterTwo.length]).toEqual([3, 3, 3])
    expect(first.plan.create).toHaveLength(0)
    // The same documents, under the ids the export carries, in the same categories.
    const ids = (list: typeof before) => list.map((t) => t.id).sort()
    expect(ids(afterTwo)).toEqual(ids(before))
    for (const t of afterTwo) {
      const old = before.find((b) => b.id === t.id)
      expect(t).toMatchObject({ kind: old?.kind, amount: old?.amount, categoryId: old?.categoryId, note: old?.note, date: old?.date, source: 'import' })
    }
  })
})
