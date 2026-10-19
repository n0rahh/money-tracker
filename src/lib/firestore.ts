import {
  collection,
  deleteDoc,
  doc,
  getDocs,
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
import type { Category, CategoryInput, IsoDate, RecurringInput, RecurringTemplate, Settings, Transaction, TransactionInput } from './types'

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

/** Sets the monthly limit of a category (whole minor units above 0), or removes it when `monthly` is null. */
export function setBudget(categoryId: string, monthly: number | null): Promise<void> {
  const ref = doc(db, 'budgets', categoryId)
  return monthly === null ? deleteDoc(ref) : setDoc(ref, { monthly, updatedAt: serverTimestamp() })
}

// ---- recurring ----

/** Sorted here, by start month and then day, rather than by the query: ordering by two fields would need a new index. */
export function subscribeRecurring(onData: (templates: RecurringTemplate[]) => void, onError?: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    recurringCol(),
    (snap) => {
      const templates = snap.docs.map((d) => mapRecurring(d.id, d.data()))
      onData(templates.sort((a, b) => a.startMonth.localeCompare(b.startMonth) || a.dayOfMonth - b.dayOfMonth))
    },
    (e) => onError?.(e),
  )
}

export function createRecurring(input: RecurringInput): { id: string; done: Promise<void> } {
  const ref = doc(recurringCol())
  const done = setDoc(ref, { ...input, lastAppliedMonth: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
  return { id: ref.id, done }
}

export function updateRecurring(id: string, patch: Partial<RecurringInput>): Promise<void> {
  return updateDoc(doc(db, 'recurring', id), { ...patch, updatedAt: serverTimestamp() })
}

export function deleteRecurring(id: string): Promise<void> {
  return deleteDoc(doc(db, 'recurring', id))
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
