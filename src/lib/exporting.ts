import { Timestamp } from 'firebase/firestore'
import { toCsv } from './csv'
import { toIsoDate } from './dates'
import { minorToDecimalString, minorUnitDigits } from './money'
import type { Budget, Category, RecurringTemplate, Transaction } from './types'

/** The CSV export's columns, in order (plan, Global Constraints). */
const CSV_COLUMNS = ['id', 'date', 'kind', 'amount', 'currency', 'category', 'note', 'source']

const descending = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0)

/** Newest first, as the app lists entries: by date, then by the exact moment in the day, then by id (Firestore's own tie-break). */
function newestFirst(a: Transaction, b: Transaction): number {
  return descending(a.date, b.date) || b.at.seconds - a.at.seconds || b.at.nanoseconds - a.at.nanoseconds || descending(a.id, b.id)
}

/**
 * Every entry as CSV, newest first: `id,date,kind,amount,currency,category,note,source`. The amount is a plain decimal in
 * the scale of `currency` (12.50, ¥1250); the category is its name, archived ones included, or "Uncategorized" for one
 * removed by hand. UTF-8 with a BOM, CRLF and RFC 4180 quoting (toCsv).
 */
export function buildCsvExport(txs: Transaction[], byId: Map<string, Category>, currency: string): string {
  const digits = minorUnitDigits(currency)
  const rows = [...txs]
    .sort(newestFirst)
    .map((t) => [t.id, t.date, t.kind, minorToDecimalString(t.amount, digits), currency, byId.get(t.categoryId)?.name ?? 'Uncategorized', t.note, t.source])
  return toCsv([CSV_COLUMNS, ...rows])
}

export type Backup = {
  transactions: Transaction[]
  categories: Category[]
  budgets: Budget[]
  recurring: RecurringTemplate[]
  currency: string
}

/** A copy of the record with each Timestamp as an ISO string; a timestamp that was never read stays out. */
function withIsoTimestamps(record: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value instanceof Timestamp ? value.toDate().toISOString() : value]))
}

/**
 * The JSON backup: `{ exportedAt, currency, categories, budgets, recurring, transactions }`, entries newest first and
 * last (the long part), every document as read with its timestamps as ISO strings. Amounts stay integer minor units of
 * `currency`, as stored.
 */
export function buildJsonExport({ transactions, categories, budgets, recurring, currency }: Backup, now: Date = new Date()): string {
  const backup = {
    exportedAt: now.toISOString(),
    currency,
    categories: categories.map(withIsoTimestamps),
    budgets: budgets.map(withIsoTimestamps),
    recurring: recurring.map(withIsoTimestamps),
    transactions: [...transactions].sort(newestFirst).map(withIsoTimestamps),
  }
  return `${JSON.stringify(backup, null, 2)}\n`
}

/** `money-tracker-2026-10-19.csv`: the app and the local date. */
export function exportFileName(extension: 'csv' | 'json', now: Date = new Date()): string {
  return `money-tracker-${toIsoDate(now)}.${extension}`
}

/** How long a download's object URL lives: some browsers read it only after the click has returned (FileSaver.js waits as long). */
const REVOKE_AFTER_MS = 40_000

/**
 * Hands a file to the user: the share sheet where the browser can share files (on iOS that is the way to save one to
 * Files), otherwise a download through a temporary link. A dismissed share sheet rejects with an AbortError, and a share
 * that comes too long after the tap with a NotAllowedError (iOS); both are passed on, and nothing is downloaded instead.
 */
export async function shareOrDownload(filename: string, mime: string, content: string): Promise<'shared' | 'downloaded'> {
  const file = new File([content], filename, { type: mime })
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file] })
    return 'shared'
  }
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS)
  return 'downloaded'
}
