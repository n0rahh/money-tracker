import { addMonths, currentMonth, daysInMonth, lastMonths, monthOf, yearToDateMonths } from './dates'
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

export type RangeKey = '3M' | '6M' | '12M' | 'YTD'

export function rangeMonths(range: RangeKey, now: Date = new Date()): IsoMonth[] {
  if (range === 'YTD') return yearToDateMonths(now)
  const count = range === '3M' ? 3 : range === '6M' ? 6 : 12
  return lastMonths(currentMonth(now), count)
}

export type MonthTotals = { month: IsoMonth; expense: number; income: number; net: number }

export function monthlyTotals(txs: Transaction[], months: IsoMonth[]): MonthTotals[] {
  const index = new Map(months.map((m, i) => [m, i]))
  const rows = months.map((month) => ({ month, expense: 0, income: 0, net: 0 }))
  for (const t of txs) {
    const i = index.get(monthOf(t.date))
    if (i === undefined) continue
    if (t.kind === 'expense') rows[i].expense += t.amount
    else rows[i].income += t.amount
  }
  for (const r of rows) r.net = r.income - r.expense
  return rows
}

export type Pace = { spentToDate: number; previousToDate: number; dayOfMonth: number; deltaPct: number | null }

/** Integer percent change; null when there is nothing to compare with. One division keeps exact ties exact (14.5 rounds to 15); `|| 0` turns -0 into 0. */
export function percentChange(current: number, previous: number): number | null {
  return previous === 0 ? null : Math.round(((current - previous) * 100) / previous) || 0
}

/**
 * Spend so far this month against the same days of the previous month. Both arrays are filtered to
 * their own month (`today`'s and the one before it), so callers may pass wider lists.
 */
export function paceComparison(current: Transaction[], previous: Transaction[], today: IsoDate): Pace {
  const dayOfMonth = Number(today.slice(8, 10))
  const month = monthOf(today)
  const previousMonth = addMonths(month, -1)
  const cutoff = Math.min(dayOfMonth, daysInMonth(previousMonth))
  let spentToDate = 0
  for (const t of current) {
    if (t.kind === 'expense' && monthOf(t.date) === month && t.date <= today) spentToDate += t.amount
  }
  let previousToDate = 0
  for (const t of previous) {
    if (t.kind !== 'expense' || monthOf(t.date) !== previousMonth) continue
    if (Number(t.date.slice(8, 10)) <= cutoff) previousToDate += t.amount
  }
  return { spentToDate, previousToDate, dayOfMonth, deltaPct: percentChange(spentToDate, previousToDate) }
}

export type CategoryDelta = { categoryId: string; current: number; previous: number; delta: number; deltaPct: number | null }

export function categoryDeltas(current: Transaction[], previous: Transaction[], kind: Kind): CategoryDelta[] {
  const sum = (txs: Transaction[]) => {
    const m = new Map<string, number>()
    for (const t of txs) if (t.kind === kind) m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + t.amount)
    return m
  }
  const a = sum(current)
  const b = sum(previous)
  const ids = new Set([...a.keys(), ...b.keys()])
  return [...ids]
    .map((categoryId) => {
      const cur = a.get(categoryId) ?? 0
      const prev = b.get(categoryId) ?? 0
      return { categoryId, current: cur, previous: prev, delta: cur - prev, deltaPct: cur === 0 && prev > 0 ? -100 : percentChange(cur, prev) }
    })
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || x.categoryId.localeCompare(y.categoryId))
}

export type Suggestion = { kind: Kind; categoryId: string; amount: number; note: string; count: number; lastAt: number }

export function suggestions(txs: Transaction[], today: IsoDate, limit = 4): Suggestion[] {
  const groups = new Map<string, Suggestion & { usedToday: boolean }>()
  for (const t of txs) {
    const key = `${t.kind}|${t.categoryId}|${t.amount}|${t.note}`
    const g = groups.get(key) ?? { kind: t.kind, categoryId: t.categoryId, amount: t.amount, note: t.note, count: 0, lastAt: 0, usedToday: false }
    g.count += 1
    g.lastAt = Math.max(g.lastAt, t.at.toMillis())
    if (t.date === today) g.usedToday = true
    groups.set(key, g)
  }
  return [...groups.values()]
    .filter((g) => !g.usedToday)
    .sort((x, y) => y.count - x.count || y.lastAt - x.lastAt)
    .slice(0, limit)
    .map(({ usedToday: _usedToday, ...s }) => s)
}

export function categoryMonthlyTotals(txs: Transaction[], categoryId: string, months: IsoMonth[]): number[] {
  const index = new Map(months.map((m, i) => [m, i]))
  const out = months.map(() => 0)
  for (const t of txs) {
    if (t.categoryId !== categoryId) continue
    const i = index.get(monthOf(t.date))
    if (i !== undefined) out[i] += t.amount
  }
  return out
}
