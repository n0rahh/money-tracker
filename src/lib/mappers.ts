import { Timestamp } from 'firebase/firestore'
import { isColorKey } from './categoryColors'
import { FALLBACK_ICON, isIconKey } from './categoryIcons'
import { currentMonth, isIsoMonth, parseIsoDate, todayIso } from './dates'
import type { Budget, Category, IsoDate, IsoMonth, Kind, RecurringTemplate, Settings, Transaction } from './types'

type Data = Record<string, unknown>

const asKind = (v: unknown): Kind => (v === 'income' ? 'income' : 'expense')
const asTimestamp = (v: unknown): Timestamp | undefined => (v instanceof Timestamp ? v : undefined)
const asMinorUnits = (v: unknown): number => (typeof v === 'number' ? Math.round(v) : 0)
const asMonth = (v: unknown): IsoMonth | null => (typeof v === 'string' && isIsoMonth(v) ? v : null)
const asDayOfMonth = (v: unknown): number => (typeof v === 'number' && !Number.isNaN(v) ? Math.min(31, Math.max(1, Math.round(v))) : 1)

export function mapCategory(id: string, data: Data): Category {
  return {
    id,
    name: typeof data.name === 'string' ? data.name : 'Unnamed',
    icon: isIconKey(data.icon) ? data.icon : FALLBACK_ICON,
    color: isColorKey(data.color) ? data.color : 'slate',
    kind: asKind(data.kind),
    order: typeof data.order === 'number' ? data.order : 0,
    archived: data.archived === true,
    createdAt: asTimestamp(data.createdAt),
    updatedAt: asTimestamp(data.updatedAt),
  }
}

export function mapTransaction(id: string, data: Data): Transaction {
  const date = typeof data.date === 'string' ? data.date : '1970-01-01'
  const source = data.source === 'shortcut' || data.source === 'import' ? data.source : 'app'
  return {
    id,
    kind: asKind(data.kind),
    amount: asMinorUnits(data.amount),
    categoryId: typeof data.categoryId === 'string' ? data.categoryId : '',
    note: typeof data.note === 'string' ? data.note : '',
    date,
    at: asTimestamp(data.at) ?? Timestamp.fromDate(parseIsoDate(date)),
    source,
    ...(typeof data.recurringId === 'string' && data.recurringId !== '' ? { recurringId: data.recurringId } : {}),
    createdAt: asTimestamp(data.createdAt),
    updatedAt: asTimestamp(data.updatedAt),
  }
}

/** A limit that is missing or not a number comes out as 0, which no budget can be: callers treat it as "no budget". */
export function mapBudget(categoryId: string, data: Data): Budget {
  return { categoryId, monthly: asMinorUnits(data.monthly) }
}

export function mapRecurring(id: string, data: Data): RecurringTemplate {
  return {
    id,
    kind: asKind(data.kind),
    amount: asMinorUnits(data.amount),
    categoryId: typeof data.categoryId === 'string' ? data.categoryId : '',
    note: typeof data.note === 'string' ? data.note : '',
    dayOfMonth: asDayOfMonth(data.dayOfMonth),
    startMonth: asMonth(data.startMonth) ?? currentMonth(),
    endMonth: asMonth(data.endMonth),
    lastAppliedMonth: asMonth(data.lastAppliedMonth),
    createdAt: asTimestamp(data.createdAt),
    updatedAt: asTimestamp(data.updatedAt),
  }
}

export function mapSettings(data: Data): Settings {
  return {
    currency: typeof data.currency === 'string' && /^[A-Z]{3}$/.test(data.currency) ? data.currency : 'USD',
    locale: typeof data.locale === 'string' ? data.locale : null,
  }
}

/** The moment a transaction is ordered by inside its day. */
export function transactionAt(input: { date: IsoDate; at?: Date }, now: Date = new Date()): Timestamp {
  if (input.at) return Timestamp.fromDate(input.at)
  if (input.date === todayIso(now)) return Timestamp.fromDate(now)
  return Timestamp.fromDate(parseIsoDate(input.date))
}
