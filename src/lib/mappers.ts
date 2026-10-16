import { Timestamp } from 'firebase/firestore'
import { isColorKey } from './categoryColors'
import { FALLBACK_ICON, isIconKey } from './categoryIcons'
import { parseIsoDate, todayIso } from './dates'
import type { Category, IsoDate, Kind, Settings, Transaction } from './types'

type Data = Record<string, unknown>

const asKind = (v: unknown): Kind => (v === 'income' ? 'income' : 'expense')
const asTimestamp = (v: unknown): Timestamp | undefined => (v instanceof Timestamp ? v : undefined)

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
    amount: typeof data.amount === 'number' ? Math.round(data.amount) : 0,
    categoryId: typeof data.categoryId === 'string' ? data.categoryId : '',
    note: typeof data.note === 'string' ? data.note : '',
    date,
    at: asTimestamp(data.at) ?? Timestamp.fromDate(parseIsoDate(date)),
    source,
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
