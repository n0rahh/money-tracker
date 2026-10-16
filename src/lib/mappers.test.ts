import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import { mapCategory, mapSettings, mapTransaction, transactionAt } from './mappers'

describe('mapCategory', () => {
  it('maps a well-formed document', () => {
    const c = mapCategory('c1', { name: 'Coffee', icon: 'Coffee', color: 'amber', kind: 'expense', order: 2, archived: false })
    expect(c).toMatchObject({ id: 'c1', name: 'Coffee', icon: 'Coffee', color: 'amber', kind: 'expense', order: 2, archived: false })
  })
  it('falls back for unknown icon/color and missing fields', () => {
    const c = mapCategory('c2', { name: 'X', icon: 'NotAnIcon', color: 'magenta', kind: 'income' })
    expect(c).toMatchObject({ icon: 'CircleEllipsis', color: 'slate', kind: 'income', order: 0, archived: false })
  })
})

describe('mapTransaction', () => {
  it('maps a well-formed document and keeps an unknown categoryId', () => {
    const at = Timestamp.fromDate(new Date(2026, 9, 14, 10))
    const t = mapTransaction('t1', { kind: 'income', amount: 1250, categoryId: 'gone', note: 'n', date: '2026-10-14', at, source: 'shortcut' })
    expect(t).toMatchObject({ id: 't1', kind: 'income', amount: 1250, categoryId: 'gone', note: 'n', date: '2026-10-14', source: 'shortcut' })
    expect(t.at.isEqual(at)).toBe(true)
  })
  it('derives `at` from the date when missing and defaults the rest', () => {
    const t = mapTransaction('t2', { amount: 5, date: '2026-10-01' })
    expect(t).toMatchObject({ kind: 'expense', categoryId: '', note: '', source: 'app' })
    expect(t.at.toDate().getDate()).toBe(1)
    expect(t.at.toDate().getHours()).toBe(12)
  })
})

describe('mapSettings', () => {
  it('validates the currency code and locale', () => {
    expect(mapSettings({ currency: 'EUR', locale: 'uk-UA' })).toEqual({ currency: 'EUR', locale: 'uk-UA' })
    expect(mapSettings({ currency: 'nope', locale: 7 })).toEqual({ currency: 'USD', locale: null })
  })
})

describe('transactionAt', () => {
  const now = new Date(2026, 9, 14, 15, 30)
  it('uses the explicit moment when given', () => {
    const at = new Date(2026, 9, 10, 9, 0)
    expect(transactionAt({ date: '2026-10-10', at }, now).toMillis()).toBe(at.getTime())
  })
  it('uses "now" for today and local noon for other days', () => {
    expect(transactionAt({ date: '2026-10-14' }, now).toMillis()).toBe(now.getTime())
    const d = transactionAt({ date: '2026-10-02' }, now).toDate()
    expect([d.getDate(), d.getHours()]).toEqual([2, 12])
  })
})
