import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore'
import { DEFAULT_CATEGORIES } from './defaultCategories'
import { db } from './firebase'
import { mapBudget, mapCategory, mapRecurring, mapSettings, mapTransaction, transactionAt } from './mappers'
import { instanceFor, instanceId } from './recurring'
import type { Budget, Category, CategoryInput, IsoDate, IsoMonth, RecurringInput, RecurringTemplate, Settings, Transaction, TransactionInput } from './types'

const categoriesCol = () => collection(db, 'categories')
const transactionsCol = () => collection(db, 'transactions')
const budgetsCol = () => collection(db, 'budgets')
const recurringCol = () => collection(db, 'recurring')
const settingsDoc = () => doc(db, 'settings', 'main')

// ---- categories ----

export function subscribeCategories(onData: (categories: Category[]) => void, onError?: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    query(categoriesCol(), orderBy('order')),
    (snap) => onData(snap.docs.map((d) => mapCategory(d.id, d.data()))),
    (e) => onError?.(e),
  )
}

/**
 * Every category, archived ones included, read once from the server for an export. Exports read from the server, never the
 * cache: offline, the cache holds only what this device has opened, and a backup that silently left the rest out would be
 * worse than none, so offline they fail with `unavailable` instead.
 */
export async function getAllCategories(): Promise<Category[]> {
  const snap = await getDocsFromServer(query(categoriesCol(), orderBy('order')))
  return snap.docs.map((d) => mapCategory(d.id, d.data()))
}

export function createCategory(input: CategoryInput): { id: string; done: Promise<void> } {
  const ref = doc(categoriesCol())
  const done = setDoc(ref, { ...input, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  return { id: ref.id, done }
}

export function updateCategory(id: string, patch: Partial<CategoryInput>): Promise<void> {
  return updateDoc(doc(db, 'categories', id), { ...patch, updatedAt: serverTimestamp() })
}

export function swapCategoryOrder(a: Category, b: Category): Promise<void> {
  const batch = writeBatch(db)
  batch.update(doc(db, 'categories', a.id), { order: b.order, updatedAt: serverTimestamp() })
  batch.update(doc(db, 'categories', b.id), { order: a.order, updatedAt: serverTimestamp() })
  return batch.commit()
}

/** Writes the default categories once; returns how many were written (0 when any category exists). */
export async function seedDefaultCategories(): Promise<number> {
  const existing = await getDocs(query(categoriesCol(), limit(1)))
  if (!existing.empty) return 0
  const batch = writeBatch(db)
  for (const c of DEFAULT_CATEGORIES) {
    batch.set(doc(categoriesCol()), { ...c, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  }
  await batch.commit()
  return DEFAULT_CATEGORIES.length
}

// ---- transactions ----

export function subscribeTransactionsInRange(
  from: IsoDate,
  to: IsoDate,
  onData: (transactions: Transaction[], hasPendingWrites: boolean, fromCache: boolean) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  const q = query(
    transactionsCol(),
    where('date', '>=', from),
    where('date', '<=', to),
    orderBy('date', 'desc'),
    orderBy('at', 'desc'),
  )
  return onSnapshot(
    q,
    // includeMetadataChanges: the server acknowledging a queued write, or confirming rows first served from the cache, changes
    // only the metadata, and the "Syncing…" pill and the cache hint must see it.
    { includeMetadataChanges: true },
    (snap) => onData(snap.docs.map((d) => mapTransaction(d.id, d.data())), snap.metadata.hasPendingWrites, snap.metadata.fromCache),
    (e) => onError?.(e),
  )
}

/**
 * Every transaction, read once from the server (as getAllCategories): an export, one tap, within spec §4's read budget.
 * The whole collection, in no particular order (the export builders sort): ordering by date and time here would leave out
 * a document without either, one made by hand in the console, say, and a backup should not.
 */
export async function getAllTransactions(): Promise<Transaction[]> {
  const snap = await getDocsFromServer(transactionsCol())
  return snap.docs.map((d) => mapTransaction(d.id, d.data()))
}

function transactionData(input: TransactionInput) {
  return {
    kind: input.kind,
    amount: input.amount,
    categoryId: input.categoryId,
    note: input.note,
    date: input.date,
    at: transactionAt(input),
    // Left out, never `undefined` (Firestore refuses it), for an entry that does not come from a template.
    ...(input.recurringId ? { recurringId: input.recurringId } : {}),
  }
}

export function createTransaction(input: TransactionInput): { id: string; done: Promise<void> } {
  const ref = doc(transactionsCol())
  const done = setDoc(ref, { ...transactionData(input), source: 'app', createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  return { id: ref.id, done }
}

export function updateTransaction(id: string, input: TransactionInput): Promise<void> {
  return updateDoc(doc(db, 'transactions', id), { ...transactionData(input), updatedAt: serverTimestamp() })
}

export function deleteTransaction(id: string): Promise<void> {
  return deleteDoc(doc(db, 'transactions', id))
}

/**
 * Undo of a delete: writes the transaction back under its own id exactly as it was read. `at` and `createdAt` are the
 * stored Timestamps themselves (a trip through Date, as in `transactionData`, would drop their microseconds); only
 * `updatedAt` is new.
 */
export function restoreTransaction(tx: Transaction): Promise<void> {
  return setDoc(doc(db, 'transactions', tx.id), {
    kind: tx.kind,
    amount: tx.amount,
    categoryId: tx.categoryId,
    note: tx.note,
    date: tx.date,
    at: tx.at,
    source: tx.source,
    // Left out, never null (the rules refuse it), for an entry that does not come from a template.
    ...(tx.recurringId ? { recurringId: tx.recurringId } : {}),
    // Absent when there was none to read, such as the original's own server timestamp still pending: a fresh one then.
    createdAt: tx.createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

/** Writes per batch in an import: under Firestore's 500 per batch, with room to spare. */
export const IMPORT_BATCH_SIZE = 400

/**
 * Writes imported rows under their deterministic ids (`imp_…`), as plain sets in batches of IMPORT_BATCH_SIZE, so an
 * import of the same rows again overwrites them instead of adding them twice. Every batch is queued at once, so all of
 * them reach the local cache (and the screen) at once and sync on their own even offline; `onProgress` gets the number
 * of rows written each time a batch is confirmed. Resolves with that number once every batch is; when one fails, rejects
 * with its error once the others have settled. The one write the UI waits for (spec §11): an import shows its progress.
 */
export async function importTransactions(
  rows: { id: string; input: TransactionInput & { source: 'import' } }[],
  onProgress?: (done: number) => void,
): Promise<number> {
  let done = 0
  const commits: Promise<void>[] = []
  for (let start = 0; start < rows.length; start += IMPORT_BATCH_SIZE) {
    const chunk = rows.slice(start, start + IMPORT_BATCH_SIZE)
    const batch = writeBatch(db)
    for (const { id, input } of chunk) {
      batch.set(doc(db, 'transactions', id), {
        // Never a template's entry, whatever the input carries: an imported row has no recurringId.
        ...transactionData({ ...input, recurringId: undefined }),
        source: 'import',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    }
    commits.push(
      batch.commit().then(() => {
        done += chunk.length
        onProgress?.(done)
      }),
    )
  }
  const failed = (await Promise.allSettled(commits)).find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failed) throw failed.reason
  return done
}

// ---- budgets ----

/**
 * The monthly limit of every category that has one, by category id. Every value is a whole number above 0: a document
 * without a usable limit is left out, so a consumer that divides by a budget never divides by 0.
 */
export function subscribeBudgets(onData: (budgets: Map<string, number>) => void, onError?: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    budgetsCol(),
    (snap) => {
      const budgets = new Map<string, number>()
      for (const d of snap.docs) {
        const { categoryId, monthly } = mapBudget(d.id, d.data())
        if (monthly > 0) budgets.set(categoryId, monthly)
      }
      onData(budgets)
    },
    (e) => onError?.(e),
  )
}

/** Every budget, read once from the server for the JSON backup (as getAllCategories); like subscribeBudgets, only usable limits. */
export async function getAllBudgets(): Promise<Budget[]> {
  const snap = await getDocsFromServer(budgetsCol())
  return snap.docs.map((d) => mapBudget(d.id, d.data())).filter((b) => b.monthly > 0)
}

/** Sets the monthly limit of a category (whole minor units above 0), or removes it when `monthly` is null. */
export function setBudget(categoryId: string, monthly: number | null): Promise<void> {
  const ref = doc(db, 'budgets', categoryId)
  return monthly === null ? deleteDoc(ref) : setDoc(ref, { monthly, updatedAt: serverTimestamp() })
}

// ---- recurring ----

/** By start month and then day, sorted here rather than by the query: ordering by two fields would need a new index. */
const byStart = (a: RecurringTemplate, b: RecurringTemplate) => a.startMonth.localeCompare(b.startMonth) || a.dayOfMonth - b.dayOfMonth

export function subscribeRecurring(
  onData: (templates: RecurringTemplate[], fromCache: boolean) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(
    recurringCol(),
    // includeMetadataChanges: the materialiser writes only from a list the server has confirmed, so it must learn when a
    // list first served from the cache is confirmed, which changes only the metadata.
    { includeMetadataChanges: true },
    (snap) => {
      const templates = snap.docs.map((d) => mapRecurring(d.id, d.data()))
      onData(templates.sort(byStart), snap.metadata.fromCache)
    },
    (e) => onError?.(e),
  )
}

/** Every recurring template, read once from the server for the JSON backup (as getAllCategories), in the same order as subscribeRecurring. */
export async function getAllRecurring(): Promise<RecurringTemplate[]> {
  const snap = await getDocsFromServer(recurringCol())
  return snap.docs.map((d) => mapRecurring(d.id, d.data())).sort(byStart)
}

/** One entry of a template: written with a plain set under its month's deterministic id, so a repeat overwrites it. */
function instanceData(t: RecurringTemplate, month: IsoMonth) {
  // instanceFor sets recurringId to the template's id, which transactionData keeps.
  return { ...transactionData(instanceFor(t, month)), source: 'app', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
}

/**
 * A new template and its entry for `startMonth` in ONE batch, with lastAppliedMonth already at startMonth. As two writes,
 * a snapshot between them would show the template with lastAppliedMonth null, and this device's materialiser (or another
 * device's) would write that month again; in one batch no snapshot ever shows the template without its first entry.
 * All or nothing: the rules accept or refuse both together.
 */
export function createRecurringWithFirstInstance(input: RecurringInput): { id: string; done: Promise<void> } {
  const ref = doc(recurringCol())
  const template: RecurringTemplate = { ...input, id: ref.id, lastAppliedMonth: input.startMonth }
  const batch = writeBatch(db)
  batch.set(ref, { ...input, lastAppliedMonth: input.startMonth, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  batch.set(doc(db, 'transactions', instanceId(ref.id, input.startMonth)), instanceData(template, input.startMonth))
  return { id: ref.id, done: batch.commit() }
}

export function updateRecurring(id: string, patch: Partial<RecurringInput>): Promise<void> {
  return updateDoc(doc(db, 'recurring', id), { ...patch, updatedAt: serverTimestamp() })
}

export function deleteRecurring(id: string): Promise<void> {
  return deleteDoc(doc(db, 'recurring', id))
}

/**
 * Undo of a template delete: writes it back under its own id as it was read, `createdAt` the stored Timestamp itself;
 * only `updatedAt` is new. Its entries were never touched, and `lastAppliedMonth` comes back with it, so nothing is
 * written twice.
 */
export function restoreRecurring(t: RecurringTemplate): Promise<void> {
  return setDoc(doc(db, 'recurring', t.id), {
    kind: t.kind,
    amount: t.amount,
    categoryId: t.categoryId,
    note: t.note,
    dayOfMonth: t.dayOfMonth,
    startMonth: t.startMonth,
    // Both written even when null: the rules want the fields present (null or a month), not left out.
    endMonth: t.endMonth,
    lastAppliedMonth: t.lastAppliedMonth,
    // Absent when there was none to read, such as the template's own server timestamp still pending: a fresh one then.
    createdAt: t.createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

/**
 * Turns the given months of a template (ascending, at most MAX_MONTHS_PER_RUN, as monthsToMaterialise returns them)
 * into ordinary entries, in one batch with the template's `lastAppliedMonth` moved to the last of them. Each entry has
 * the deterministic id of its month and is a plain set, so a second device materialising the same month overwrites the
 * same document instead of adding one. Never awaited by the UI.
 */
export function materialiseRecurring(t: RecurringTemplate, months: IsoMonth[]): Promise<void> {
  const last = months.at(-1)
  if (last === undefined) return Promise.resolve()
  const batch = writeBatch(db)
  for (const month of months) batch.set(doc(db, 'transactions', instanceId(t.id, month)), instanceData(t, month))
  batch.update(doc(db, 'recurring', t.id), { lastAppliedMonth: last, updatedAt: serverTimestamp() })
  return batch.commit()
}

// ---- settings ----

export function subscribeSettings(onData: (settings: Settings | null, fromCache: boolean) => void, onError?: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    settingsDoc(),
    // includeMetadataChanges: the first-run gate must learn when a cached "no settings" result is confirmed by the server.
    { includeMetadataChanges: true },
    (snap) => onData(snap.exists() ? mapSettings(snap.data()) : null, snap.metadata.fromCache),
    (e) => onError?.(e),
  )
}

export function saveSettings(settings: Settings): Promise<void> {
  return setDoc(settingsDoc(), { ...settings, updatedAt: serverTimestamp() }, { merge: true })
}
