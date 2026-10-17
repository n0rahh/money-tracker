import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import {
  categoryDeltas, categoryMonthlyTotals, groupByDay, monthlyTotals, orderCategoriesByRecency,
  paceComparison, rangeMonths, suggestions, totalsByCategory, totalsByDay, totalsByKind,
} from './stats'
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

describe('rangeMonths', () => {
  const now = new Date(2026, 9, 17)
  it('ends with the current month and counts back', () => {
    expect(rangeMonths('3M', now)).toEqual(['2026-08', '2026-09', '2026-10'])
    expect(rangeMonths('6M', now)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
    expect(rangeMonths('12M', now)).toHaveLength(12)
    expect(rangeMonths('12M', now)[0]).toBe('2025-11')
    expect(rangeMonths('YTD', now)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
  })
})

describe('monthlyTotals', () => {
  it('returns one entry per month with zeros for empty months and ignores others', () => {
    const rows = monthlyTotals(
      [tx({ amount: 100, date: '2026-09-03' }), tx({ amount: 50, date: '2026-09-20', kind: 'income' }), tx({ amount: 7, date: '2026-07-01' })],
      ['2026-08', '2026-09'],
    )
    expect(rows).toEqual([
      { month: '2026-08', expense: 0, income: 0, net: 0 },
      { month: '2026-09', expense: 100, income: 50, net: -50 },
    ])
  })
})

describe('paceComparison', () => {
  it('compares spend to date with the previous month over the same number of days', () => {
    const current = [tx({ amount: 1000, date: '2026-10-02' }), tx({ amount: 500, date: '2026-10-14' }), tx({ amount: 999, date: '2026-10-20' })]
    const previous = [tx({ amount: 800, date: '2026-09-05' }), tx({ amount: 600, date: '2026-09-14' }), tx({ amount: 400, date: '2026-09-15' })]
    expect(paceComparison(current, previous, '2026-10-14')).toEqual({ spentToDate: 1500, previousToDate: 1400, dayOfMonth: 14, deltaPct: 7 })
  })
  it('clamps the day to the previous month length and ignores income', () => {
    const current = [tx({ amount: 300, date: '2026-03-31' }), tx({ amount: 1, date: '2026-03-31', kind: 'income' })]
    const previous = [tx({ amount: 200, date: '2026-02-28' })]
    expect(paceComparison(current, previous, '2026-03-31')).toEqual({ spentToDate: 300, previousToDate: 200, dayOfMonth: 31, deltaPct: 50 })
  })
  it('returns a null delta when there was nothing to compare with', () => {
    expect(paceComparison([tx({ amount: 5, date: '2026-10-01' })], [], '2026-10-01').deltaPct).toBeNull()
    expect(paceComparison([], [], '2026-10-01')).toEqual({ spentToDate: 0, previousToDate: 0, dayOfMonth: 1, deltaPct: null })
  })
})

describe('categoryDeltas', () => {
  it('unions categories, marks new and vanished ones, sorts by absolute delta', () => {
    const current = [tx({ amount: 500, categoryId: 'food' }), tx({ amount: 300, categoryId: 'taxi' }), tx({ amount: 90, categoryId: 'inc', kind: 'income' })]
    const previous = [tx({ amount: 200, categoryId: 'food', date: '2026-09-10' }), tx({ amount: 250, categoryId: 'gym', date: '2026-09-11' })]
    expect(categoryDeltas(current, previous, 'expense')).toEqual([
      { categoryId: 'food', current: 500, previous: 200, delta: 300, deltaPct: 150 },
      { categoryId: 'taxi', current: 300, previous: 0, delta: 300, deltaPct: null },
      { categoryId: 'gym', current: 0, previous: 250, delta: -250, deltaPct: -100 },
    ])
  })
  it('breaks equal absolute deltas by categoryId', () => {
    const rows = categoryDeltas([tx({ amount: 100, categoryId: 'b' }), tx({ amount: 100, categoryId: 'a' })], [], 'expense')
    expect(rows.map((r) => r.categoryId)).toEqual(['a', 'b'])
  })
})

describe('suggestions', () => {
  const at = (d: number, h: number) => Timestamp.fromDate(new Date(2026, 9, d, h))
  it('ranks repeated combos by count then recency and excludes ones used today', () => {
    const txs = [
      tx({ amount: 350, categoryId: 'coffee', note: '', date: '2026-10-01', at: at(1, 9) }),
      tx({ amount: 350, categoryId: 'coffee', note: '', date: '2026-10-05', at: at(5, 9) }),
      tx({ amount: 350, categoryId: 'coffee', note: '', date: '2026-10-09', at: at(9, 9) }),
      tx({ amount: 1200, categoryId: 'lunch', note: 'canteen', date: '2026-10-02', at: at(2, 13) }),
      tx({ amount: 1200, categoryId: 'lunch', note: 'canteen', date: '2026-10-12', at: at(12, 13) }),
      tx({ amount: 4000, categoryId: 'fuel', note: '', date: '2026-10-11', at: at(11, 18) }),
      tx({ amount: 4000, categoryId: 'fuel', note: '', date: '2026-10-03', at: at(3, 18) }),
      tx({ amount: 999, categoryId: 'gift', note: 'mom', date: '2026-10-14', at: at(14, 10) }),
      tx({ amount: 999, categoryId: 'gift', note: 'mom', date: '2026-10-07', at: at(7, 10) }),
    ]
    const rows = suggestions(txs, '2026-10-14')
    expect(rows.map((s) => s.categoryId)).toEqual(['coffee', 'lunch', 'fuel'])
    expect(rows[0]).toEqual({ kind: 'expense', categoryId: 'coffee', amount: 350, note: '', count: 3, lastAt: at(9, 9).toMillis() })
  })
  it('respects the limit and treats a different note as a different combo', () => {
    const txs = [
      tx({ amount: 100, categoryId: 'a', note: 'x', date: '2026-10-01' }),
      tx({ amount: 100, categoryId: 'a', note: 'y', date: '2026-10-02' }),
      tx({ amount: 100, categoryId: 'a', note: 'z', date: '2026-10-03' }),
    ]
    expect(suggestions(txs, '2026-10-20', 2)).toHaveLength(2)
    expect(suggestions(txs, '2026-10-20')).toHaveLength(3)
  })
})

describe('categoryMonthlyTotals', () => {
  it('sums one category per month, any kind', () => {
    const txs = [tx({ amount: 100, categoryId: 'c', date: '2026-09-01' }), tx({ amount: 20, categoryId: 'c', date: '2026-09-30' }), tx({ amount: 5, categoryId: 'other', date: '2026-09-02' }), tx({ amount: 7, categoryId: 'c', date: '2026-10-01' })]
    expect(categoryMonthlyTotals(txs, 'c', ['2026-08', '2026-09', '2026-10'])).toEqual([0, 120, 7])
  })
})
