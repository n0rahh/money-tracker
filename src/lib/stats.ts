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
 * The pace rule: the rows of the month before `today`'s, up to the same day of month (day ≤ min(today's day, that
 * month's length)). Rows of any other month are dropped, so callers may pass wider lists.
 */
export function previousMonthToDate(previous: Transaction[], today: IsoDate): Transaction[] {
  const previousMonth = addMonths(monthOf(today), -1)
  const cutoff = Math.min(Number(today.slice(8, 10)), daysInMonth(previousMonth))
  return previous.filter((t) => monthOf(t.date) === previousMonth && Number(t.date.slice(8, 10)) <= cutoff)
}

/**
 * Spend so far this month against the same days of the previous month. Both arrays are filtered to
 * their own month (`today`'s and the one before it), so callers may pass wider lists.
 */
export function paceComparison(current: Transaction[], previous: Transaction[], today: IsoDate): Pace {
  const dayOfMonth = Number(today.slice(8, 10))
  const month = monthOf(today)
  let spentToDate = 0
  for (const t of current) {
    if (t.kind === 'expense' && monthOf(t.date) === month && t.date <= today) spentToDate += t.amount
  }
  let previousToDate = 0
  for (const t of previousMonthToDate(previous, today)) {
    if (t.kind === 'expense') previousToDate += t.amount
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

// ---- budgets: spec §9, a monthly limit per category; progress = the category's month total ÷ its limit ----

/**
 * The limits that count, by category id, in category order: those of active expense categories. That an archived
 * category's limit rests (no empty row, nothing in the total) is the app's rule, not §9's; income categories and ones
 * removed by hand have none.
 */
export function activeExpenseBudgets(categories: Iterable<Category>, budgets: Map<string, number>): Map<string, number> {
  const counted = new Map<string, number>()
  for (const c of categories) {
    const budget = budgets.get(c.id)
    if (budget !== undefined && c.kind === 'expense' && !c.archived) counted.set(c.id, budget)
  }
  return counted
}

/** Where a month's spending stands against its limit: below it, exactly at it, or past it. */
export type BudgetState = 'under' | 'at' | 'over'

/**
 * The bar's fill (full from 100 % on), where the spending stands, and by how much it is past the limit, in minor units. The
 * plan colours the bar from 100 % itself, so `at` and `over` both reach the limit; only `over` has an overage, 0 otherwise.
 * `budget` is above 0: subscribeBudgets delivers no other limit.
 */
export function budgetProgress(spent: number, budget: number): { ratio: number; state: BudgetState; overage: number } {
  return {
    ratio: Math.min(spent / budget, 1),
    state: spent > budget ? 'over' : spent === budget ? 'at' : 'under',
    overage: Math.max(spent - budget, 0),
  }
}

/** The rows plus an empty one for each budgeted category with nothing spent, after the others, in the order of `budgets`. */
export function withBudgetRows(rows: CategoryTotal[], budgets: Map<string, number>): CategoryTotal[] {
  const listed = new Set(rows.map((r) => r.categoryId))
  const empty = [...budgets.keys()].filter((id) => !listed.has(id)).map((categoryId) => ({ categoryId, total: 0, count: 0, share: 0 }))
  return [...rows, ...empty]
}

/** The rows' spending in the budgeted categories against the sum of every limit in `budgets`; null when there is none. */
export function budgetSummary(rows: CategoryTotal[], budgets: Map<string, number>): { spent: number; budget: number } | null {
  if (budgets.size === 0) return null
  let spent = 0
  let budget = 0
  for (const r of rows) if (budgets.has(r.categoryId)) spent += r.total
  for (const limit of budgets.values()) budget += limit
  return { spent, budget }
}
