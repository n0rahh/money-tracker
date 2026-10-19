import type { Timestamp } from 'firebase/firestore'
import type { ColorKey } from './categoryColors'
import type { IconKey } from './categoryIcons'

export type Kind = 'expense' | 'income'
export const KINDS: Kind[] = ['expense', 'income']

/** 'YYYY-MM-DD' in the device's local time zone. */
export type IsoDate = string
/** 'YYYY-MM'. */
export type IsoMonth = string

export type Category = {
  id: string
  name: string
  icon: IconKey
  color: ColorKey
  kind: Kind
  order: number
  archived: boolean
  createdAt?: Timestamp
  updatedAt?: Timestamp
}
export type CategoryInput = Omit<Category, 'id' | 'createdAt' | 'updatedAt'>

export type Transaction = {
  id: string
  kind: Kind
  /** Integer minor units (cents). Always > 0; the sign is implied by `kind`. */
  amount: number
  categoryId: string
  note: string
  date: IsoDate
  at: Timestamp
  source: 'app' | 'shortcut' | 'import'
  /** The recurring template this entry was created from; absent for entries added by hand. */
  recurringId?: string
  createdAt?: Timestamp
  updatedAt?: Timestamp
}
export type TransactionInput = {
  kind: Kind
  amount: number
  categoryId: string
  note: string
  date: IsoDate
  /** Explicit moment within the day; when omitted the data layer derives it from `date`. */
  at?: Date
  /** Set on entries created from a recurring template. */
  recurringId?: string
}

/** A monthly spending limit for one category; its document id is the category id. */
export type Budget = {
  categoryId: string
  /** Integer minor units (cents). Always > 0. */
  monthly: number
}

/** An entry that repeats every month by itself: each month from `startMonth` on becomes an ordinary transaction. */
export type RecurringTemplate = {
  id: string
  kind: Kind
  /** Integer minor units (cents). Always > 0. */
  amount: number
  categoryId: string
  note: string
  /** 1 to 31; a month that is shorter gets the entry on its last day. */
  dayOfMonth: number
  /** The first month the template applies to. */
  startMonth: IsoMonth
  /** The last month it applies to; null while it has no end. */
  endMonth: IsoMonth | null
  /** The latest month already turned into a transaction; null while none has been. */
  lastAppliedMonth: IsoMonth | null
  createdAt?: Timestamp
  updatedAt?: Timestamp
}
export type RecurringInput = Omit<RecurringTemplate, 'id' | 'createdAt' | 'updatedAt' | 'lastAppliedMonth'>

export type Settings = {
  currency: string
  locale: string | null
}
