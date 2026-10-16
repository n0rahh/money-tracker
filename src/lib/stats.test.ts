import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import { groupByDay, orderCategoriesByRecency, totalsByCategory, totalsByDay, totalsByKind } from './stats'
import type { Category, Transaction } from './types'

let seq = 0
const tx = (p: Partial<Transaction> & { amount: number }): Transaction => ({
  id: `t${++seq}`,
  kind: 'expense',
  categoryId: 'c1',
  note: '',
  date: '2026-10-14',
  at: Timestamp.fromDate(new Date(2026, 9, 14, 10, 0)),
  source: 'app',
  ...p,
})
const cat = (id: string, order: number, p: Partial<Category> = {}): Category => ({
  id, name: id, icon: 'Coffee', color: 'amber', kind: 'expense', order, archived: false, ...p,
})

describe('totalsByKind', () => {
  it('sums expenses and income and computes net', () => {
    const t = totalsByKind([tx({ amount: 1250 }), tx({ amount: 300 }), tx({ amount: 10000, kind: 'income' })])
    expect(t).toEqual({ expense: 1550, income: 10000, net: 8450 })
  })
})

describe('totalsByCategory', () => {
  it('groups by category for one kind, sorted by total, with shares', () => {
    const rows = totalsByCategory(
      [tx({ amount: 100, categoryId: 'a' }), tx({ amount: 300, categoryId: 'b' }), tx({ amount: 100, categoryId: 'b' }), tx({ amount: 999, kind: 'income', categoryId: 'z' })],
      'expense',
    )
    expect(rows).toEqual([
      { categoryId: 'b', total: 400, count: 2, share: 0.8 },
      { categoryId: 'a', total: 100, count: 1, share: 0.2 },
    ])
  })
  it('breaks total ties by categoryId', () => {
    const rows = totalsByCategory([tx({ amount: 100, categoryId: 'b' }), tx({ amount: 100, categoryId: 'a' })], 'expense')
    expect(rows.map((r) => r.categoryId)).toEqual(['a', 'b'])
  })
  it('returns an empty list when nothing matches', () => expect(totalsByCategory([], 'income')).toEqual([]))
})

describe('totalsByDay', () => {
  it('returns one bucket per day of the month', () => {
    const days = totalsByDay([tx({ amount: 100, date: '2026-10-14' }), tx({ amount: 50, date: '2026-10-14' }), tx({ amount: 7, date: '2026-10-01' }), tx({ amount: 1, date: '2026-09-30' })], '2026-10', 'expense')
    expect(days).toHaveLength(31)
    expect(days[0]).toBe(7)
    expect(days[13]).toBe(150)
    expect(days[29]).toBe(0) // the 2026-09-30 fixture must be excluded: it would land at index 29 if the month filter were missing
    expect(days[30]).toBe(0)
  })
})

describe('groupByDay', () => {
  it('groups newest day first and newest entry first within a day', () => {
    const early = tx({ amount: 1, date: '2026-10-13', at: Timestamp.fromDate(new Date(2026, 9, 13, 8)) })
    const late = tx({ amount: 2, date: '2026-10-13', at: Timestamp.fromDate(new Date(2026, 9, 13, 20)) })
    const today = tx({ amount: 3, date: '2026-10-14', kind: 'income' })
    const groups = groupByDay([early, today, late])
    expect(groups.map((g) => g.date)).toEqual(['2026-10-14', '2026-10-13'])
    expect(groups[1].items.map((t) => t.amount)).toEqual([2, 1])
    expect(groups[0].totals).toEqual({ expense: 0, income: 3, net: 3 })
    expect(groups[1].totals).toEqual({ expense: 3, income: 0, net: -3 })
  })
})

describe('orderCategoriesByRecency', () => {
  it('puts recently used first, then by order; excludes archived and other kinds', () => {
    // 'd' is listed before 'a' on purpose: the two unused categories must fall back to `order` (a: 0, d: 4), not to input order
    const cats = [cat('d', 4), cat('a', 0), cat('b', 1), cat('c', 2), cat('old', 3, { archived: true }), cat('inc', 0, { kind: 'income' })]
    const txs = [
      tx({ amount: 1, categoryId: 'c', at: Timestamp.fromDate(new Date(2026, 9, 14, 9)) }),
      tx({ amount: 1, categoryId: 'b', at: Timestamp.fromDate(new Date(2026, 9, 14, 11)) }),
      tx({ amount: 1, categoryId: 'old', at: Timestamp.fromDate(new Date(2026, 9, 14, 12)) }),
    ]
    expect(orderCategoriesByRecency(cats, txs, 'expense').map((c) => c.id)).toEqual(['b', 'c', 'a', 'd'])
    expect(orderCategoriesByRecency(cats, [], 'income').map((c) => c.id)).toEqual(['inc'])
  })
})
