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
}

export type Settings = {
  currency: string
  locale: string | null
}
