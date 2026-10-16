import { daysInMonth } from './dates'
import type { Category, IsoDate, IsoMonth, Kind, Transaction } from './types'

export type KindTotals = { expense: number; income: number; net: number }

export function totalsByKind(txs: Transaction[]): KindTotals {
  let expense = 0
  let income = 0
  for (const t of txs) {
    if (t.kind === 'expense') expense += t.amount
    else income += t.amount
  }
  return { expense, income, net: income - expense }
}

export type CategoryTotal = { categoryId: string; total: number; count: number; share: number }

export function totalsByCategory(txs: Transaction[], kind: Kind): CategoryTotal[] {
  const acc = new Map<string, { total: number; count: number }>()
  let sum = 0
  for (const t of txs) {
    if (t.kind !== kind) continue
    const entry = acc.get(t.categoryId) ?? { total: 0, count: 0 }
    entry.total += t.amount
    entry.count += 1
    acc.set(t.categoryId, entry)
    sum += t.amount
  }
  return [...acc]
    .map(([categoryId, e]) => ({ categoryId, total: e.total, count: e.count, share: sum === 0 ? 0 : e.total / sum }))
    .sort((a, b) => b.total - a.total || a.categoryId.localeCompare(b.categoryId))
}

export function totalsByDay(txs: Transaction[], month: IsoMonth, kind: Kind): number[] {
  const days = Array.from({ length: daysInMonth(month) }, () => 0)
  for (const t of txs) {
    if (t.kind !== kind || !t.date.startsWith(`${month}-`)) continue
    days[Number(t.date.slice(8, 10)) - 1] += t.amount
  }
  return days
}

export type DayGroup = { date: IsoDate; items: Transaction[]; totals: KindTotals }

export function groupByDay(txs: Transaction[]): DayGroup[] {
  const byDate = new Map<IsoDate, Transaction[]>()
  for (const t of txs) {
    const list = byDate.get(t.date)
    if (list) list.push(t)
    else byDate.set(t.date, [t])
  }
  return [...byDate]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, items]) => {
      const sorted = [...items].sort((a, b) => b.at.toMillis() - a.at.toMillis())
      return { date, items: sorted, totals: totalsByKind(sorted) }
    })
}

export function orderCategoriesByRecency(categories: Category[], txs: Transaction[], kind: Kind): Category[] {
  const lastUse = new Map<string, number>()
  for (const t of txs) {
    if (t.kind !== kind) continue
    const ms = t.at.toMillis()
    if ((lastUse.get(t.categoryId) ?? -1) < ms) lastUse.set(t.categoryId, ms)
  }
  return categories
    .filter((c) => c.kind === kind && !c.archived)
    .sort((a, b) => (lastUse.get(b.id) ?? -1) - (lastUse.get(a.id) ?? -1) || a.order - b.order)
}
