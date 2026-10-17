import type { IsoDate, IsoMonth } from './types'

const pad = (n: number) => String(n).padStart(2, '0')

export function toIsoDate(d: Date): IsoDate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function todayIso(now: Date = new Date()): IsoDate {
  return toIsoDate(now)
}

/** Local noon of the given day: immune to DST shifts when adding/subtracting days. */
export function parseIsoDate(date: IsoDate): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0, 0)
}

export function monthOf(date: IsoDate): IsoMonth {
  return date.slice(0, 7)
}

export function currentMonth(now: Date = new Date()): IsoMonth {
  return monthOf(toIsoDate(now))
}

export function daysInMonth(month: IsoMonth): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

export function monthRange(month: IsoMonth): { from: IsoDate; to: IsoDate } {
  return { from: `${month}-01`, to: `${month}-${pad(daysInMonth(month))}` }
}

export function addMonths(month: IsoMonth, delta: number): IsoMonth {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export function addDays(date: IsoDate, delta: number): IsoDate {
  const d = parseIsoDate(date)
  d.setDate(d.getDate() + delta)
  return toIsoDate(d)
}

export function monthLabel(month: IsoMonth, locale?: string | null): string {
  const [y, m] = month.split('-').map(Number)
  return new Intl.DateTimeFormat(locale ?? undefined, { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1))
}

export function dayLabel(date: IsoDate, today: IsoDate, locale?: string | null): string {
  if (date === today) return 'Today'
  if (date === addDays(today, -1)) return 'Yesterday'
  return new Intl.DateTimeFormat(locale ?? undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(parseIsoDate(date))
}

/** `count` months ending at `end`, oldest first. */
export function lastMonths(end: IsoMonth, count: number): IsoMonth[] {
  return Array.from({ length: count }, (_, i) => addMonths(end, i - (count - 1)))
}

/** Inclusive ascending list of months; empty when `from` is after `to` or either month cannot be parsed. */
export function monthsBetween(from: IsoMonth, to: IsoMonth): IsoMonth[] {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  const count = (ty - fy) * 12 + (tm - fm) + 1
  if (!Number.isFinite(count) || count <= 0) return []
  return Array.from({ length: count }, (_, i) => addMonths(from, i))
}

export function yearToDateMonths(now: Date = new Date()): IsoMonth[] {
  return monthsBetween(`${now.getFullYear()}-01`, currentMonth(now))
}

/** "Oct" in the current year, "Oct 25" otherwise. */
export function monthShortLabel(month: IsoMonth, locale?: string | null, now: Date = new Date()): string {
  const [y, m] = month.split('-').map(Number)
  const label = new Intl.DateTimeFormat(locale ?? undefined, { month: 'short' }).format(new Date(y, m - 1, 1))
  return y === now.getFullYear() ? label : `${label} ${String(y).slice(-2)}`
}
