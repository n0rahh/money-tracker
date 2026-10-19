import { addMonths, daysInMonth, isIsoMonth, monthOf, monthsBetween, parseIsoDate } from './dates'
import type { IsoMonth, RecurringInput, RecurringTemplate, TransactionInput } from './types'

/**
 * The most months one template turns into entries per run, so a device that was offline for years writes a bounded
 * batch (24 entries and the template, far below Firestore's 500 writes); the next snapshot carries on with the rest.
 */
export const MAX_MONTHS_PER_RUN = 24

/** The id of a template's entry for a month: the same on every device, so writing a month twice overwrites one document. */
export function instanceId(templateId: string, month: IsoMonth): string {
  return `rec_${templateId}_${month}`
}

/**
 * The months still owed, oldest first: the month after `lastAppliedMonth` (never before `startMonth`) through `now`, or
 * through `endMonth` when that comes first. Empty when nothing is due, and at most `max` long.
 */
export function monthsToMaterialise(t: RecurringTemplate, now: IsoMonth, max: number = MAX_MONTHS_PER_RUN): IsoMonth[] {
  const next = t.lastAppliedMonth === null ? t.startMonth : addMonths(t.lastAppliedMonth, 1)
  const from = next < t.startMonth ? t.startMonth : next
  const to = t.endMonth !== null && t.endMonth < now ? t.endMonth : now
  return monthsBetween(from, to).slice(0, max)
}

/** A template's entry for one month: on its day of the month, or the month's last day when it is shorter; at local noon. */
export function instanceFor(t: RecurringTemplate, month: IsoMonth): TransactionInput & { recurringId: string; at: Date } {
  const day = Math.min(t.dayOfMonth, daysInMonth(month))
  const date = `${month}-${String(day).padStart(2, '0')}`
  return { kind: t.kind, amount: t.amount, categoryId: t.categoryId, note: t.note, date, at: parseIsoDate(date), recurringId: t.id }
}

/** The template that repeats an entry every month from the entry's own month, on its day of the month, with no end. */
export function templateFrom(entry: Pick<TransactionInput, 'kind' | 'amount' | 'categoryId' | 'note' | 'date'>): RecurringInput {
  return {
    kind: entry.kind,
    amount: entry.amount,
    categoryId: entry.categoryId,
    note: entry.note,
    dayOfMonth: parseIsoDate(entry.date).getDate(),
    startMonth: monthOf(entry.date),
    endMonth: null,
  }
}

/**
 * Whether the rules would take this template's batch: its entries (`validTransaction`, `recurringId` up to 64
 * characters) and its own update (`validRecurring`). A batch is all or nothing, so a template that fails here (only a
 * hand edit in the console can make one) would fail on every launch, forever: the materialiser leaves it alone.
 */
export function isMaterialisable(t: RecurringTemplate): boolean {
  return (
    t.id.length <= 64
    && Number.isSafeInteger(t.amount) && t.amount > 0 && t.amount < 100_000_000_000
    && t.categoryId !== ''
    && t.note.length <= 200
    && Number.isInteger(t.dayOfMonth) && t.dayOfMonth >= 1 && t.dayOfMonth <= 31
    && isIsoMonth(t.startMonth)
    && (t.endMonth === null || isIsoMonth(t.endMonth))
    && (t.lastAppliedMonth === null || isIsoMonth(t.lastAppliedMonth))
  )
}
