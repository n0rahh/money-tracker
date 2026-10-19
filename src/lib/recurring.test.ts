import { describe, expect, it } from 'vitest'
import { MAX_MONTHS_PER_RUN, instanceFor, instanceId, isMaterialisable, monthsToMaterialise, templateFrom } from './recurring'
import type { RecurringTemplate } from './types'

/** Rent on the 1st since January 2026, with no end, never turned into an entry yet. */
const RENT: RecurringTemplate = {
  id: 'r1', kind: 'expense', amount: 120_000, categoryId: 'rent', note: 'Flat', dayOfMonth: 1, startMonth: '2026-01', endMonth: null, lastAppliedMonth: null,
}
const template = (patch: Partial<RecurringTemplate>): RecurringTemplate => ({ ...RENT, ...patch })

describe('instanceId', () => {
  it('is rec_<template id>_<month>, so every device writes the same document for a month', () => {
    expect(instanceId('Xy12abc', '2026-10')).toBe('rec_Xy12abc_2026-10')
  })
})

describe('monthsToMaterialise', () => {
  const NOW = '2026-10'

  it('never applied: every month from the start through now, oldest first', () => {
    expect(monthsToMaterialise(template({ startMonth: '2026-08' }), NOW)).toEqual(['2026-08', '2026-09', '2026-10'])
  })

  it('applied last month: this month only', () => {
    expect(monthsToMaterialise(template({ lastAppliedMonth: '2026-09' }), NOW)).toEqual(['2026-10'])
  })

  it('applied this month: nothing', () => {
    expect(monthsToMaterialise(template({ lastAppliedMonth: '2026-10' }), NOW)).toEqual([])
  })

  it('started this month: this month', () => {
    expect(monthsToMaterialise(template({ startMonth: '2026-10' }), NOW)).toEqual(['2026-10'])
  })

  it('catches up across a year boundary after months offline', () => {
    expect(monthsToMaterialise(template({ startMonth: '2025-06', lastAppliedMonth: '2025-11' }), '2026-02')).toEqual(['2025-12', '2026-01', '2026-02'])
  })

  it('ended in the past: up to the end month and no further', () => {
    const ended = template({ startMonth: '2026-05', endMonth: '2026-07' })
    expect(monthsToMaterialise(ended, NOW)).toEqual(['2026-05', '2026-06', '2026-07'])
    expect(monthsToMaterialise({ ...ended, lastAppliedMonth: '2026-06' }, NOW)).toEqual(['2026-07'])
    expect(monthsToMaterialise({ ...ended, lastAppliedMonth: '2026-07' }, NOW)).toEqual([])
  })

  it('ending this month or later: through now, never ahead of it', () => {
    expect(monthsToMaterialise(template({ startMonth: '2026-09', endMonth: '2026-10' }), NOW)).toEqual(['2026-09', '2026-10'])
    expect(monthsToMaterialise(template({ startMonth: '2026-09', endMonth: '2027-03' }), NOW)).toEqual(['2026-09', '2026-10'])
  })

  it('starting in a later month: nothing yet, also once that month has its first entry', () => {
    expect(monthsToMaterialise(template({ startMonth: '2026-11' }), NOW)).toEqual([])
    expect(monthsToMaterialise(template({ startMonth: '2026-11', lastAppliedMonth: '2026-11' }), NOW)).toEqual([])
  })

  it('never reaches back before the start month, whatever lastAppliedMonth says', () => {
    expect(monthsToMaterialise(template({ startMonth: '2026-08', lastAppliedMonth: '2026-03' }), NOW)).toEqual(['2026-08', '2026-09', '2026-10'])
  })

  it(`returns at most ${MAX_MONTHS_PER_RUN} months, oldest first; the rest follow once lastAppliedMonth has advanced`, () => {
    // May 2024 through October 2026: 30 months owed.
    const behind = template({ startMonth: '2024-05' })
    const first = monthsToMaterialise(behind, NOW)
    expect(MAX_MONTHS_PER_RUN).toBe(24)
    expect(first).toHaveLength(24)
    expect(first[0]).toBe('2024-05')
    expect(first.at(-1)).toBe('2026-04')
    expect(monthsToMaterialise({ ...behind, lastAppliedMonth: '2026-04' }, NOW)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
  })

  it('takes a smaller cap', () => {
    expect(monthsToMaterialise(template({ startMonth: '2026-08' }), NOW, 2)).toEqual(['2026-08', '2026-09'])
  })
})

describe('instanceFor', () => {
  it("copies the template into an entry on its day of the month, at local noon, linked to the template", () => {
    expect(instanceFor(template({ dayOfMonth: 15 }), '2026-10')).toEqual({
      kind: 'expense',
      amount: 120_000,
      categoryId: 'rent',
      note: 'Flat',
      date: '2026-10-15',
      at: new Date(2026, 9, 15, 12, 0, 0, 0),
      recurringId: 'r1',
    })
  })

  it('takes the kind and the note of an income template', () => {
    const pay = template({ id: 'r2', kind: 'income', amount: 500_000, categoryId: 'salary', note: '', dayOfMonth: 25 })
    expect(instanceFor(pay, '2026-03')).toEqual({
      kind: 'income', amount: 500_000, categoryId: 'salary', note: '', date: '2026-03-25', at: new Date(2026, 2, 25, 12), recurringId: 'r2',
    })
  })

  it.each([
    { day: 1, month: '2026-10', date: '2026-10-01' },
    { day: 31, month: '2026-10', date: '2026-10-31' },
    { day: 31, month: '2026-04', date: '2026-04-30' },
    { day: 31, month: '2026-02', date: '2026-02-28' }, // 2026 is not a leap year
    { day: 31, month: '2028-02', date: '2028-02-29' }, // 2028 is
    { day: 29, month: '2026-02', date: '2026-02-28' },
    { day: 29, month: '2028-02', date: '2028-02-29' },
    { day: 30, month: '2026-11', date: '2026-11-30' },
  ])('puts day $day of $month on $date: a shorter month gets the entry on its last day', ({ day, month, date }) => {
    const entry = instanceFor(template({ dayOfMonth: day }), month)
    expect(entry.date).toBe(date)
    const [y, m, d] = date.split('-').map(Number)
    expect(entry.at).toEqual(new Date(y, m - 1, d, 12, 0, 0, 0))
  })
})

describe('templateFrom', () => {
  it("repeats an entry every month from the entry's own month, on its day, with no end", () => {
    expect(templateFrom({ kind: 'expense', amount: 120_000, categoryId: 'rent', note: 'Flat', date: '2026-01-31' })).toEqual({
      kind: 'expense', amount: 120_000, categoryId: 'rent', note: 'Flat', dayOfMonth: 31, startMonth: '2026-01', endMonth: null,
    })
    expect(templateFrom({ kind: 'income', amount: 500_000, categoryId: 'salary', note: '', date: '2026-10-05' })).toEqual({
      kind: 'income', amount: 500_000, categoryId: 'salary', note: '', dayOfMonth: 5, startMonth: '2026-10', endMonth: null,
    })
  })
})

describe('isMaterialisable', () => {
  it('accepts a well-formed template, running, ended or already applied', () => {
    expect(isMaterialisable(RENT)).toBe(true)
    expect(isMaterialisable(template({ endMonth: '2026-12', lastAppliedMonth: '2026-09' }))).toBe(true)
  })

  it('accepts the limits the rules accept', () => {
    expect(isMaterialisable(template({ amount: 1, dayOfMonth: 31 }))).toBe(true)
    expect(isMaterialisable(template({ amount: 99_999_999_999, dayOfMonth: 1 }))).toBe(true)
    expect(isMaterialisable(template({ note: 'x'.repeat(200), id: 'x'.repeat(64) }))).toBe(true)
  })

  // Each of these would make the all-or-nothing batch fail on every launch, forever.
  it.each([
    { what: 'amount 0', patch: { amount: 0 } },
    { what: 'a negative amount', patch: { amount: -500 } },
    { what: 'a fractional amount', patch: { amount: 12.5 } },
    { what: 'an amount at the 10^11 cap', patch: { amount: 100_000_000_000 } },
    { what: 'an amount that is not a number', patch: { amount: Number.NaN } },
    { what: 'no category', patch: { categoryId: '' } },
    { what: 'a note over 200 characters', patch: { note: 'x'.repeat(201) } },
    { what: 'day 0', patch: { dayOfMonth: 0 } },
    { what: 'day 32', patch: { dayOfMonth: 32 } },
    { what: 'a fractional day', patch: { dayOfMonth: 1.5 } },
    { what: 'start month 13', patch: { startMonth: '2026-13' } },
    { what: 'a start month with a two-digit year', patch: { startMonth: '26-10' } },
    { what: 'an end month with a slash', patch: { endMonth: '2026/10' } },
    { what: 'a last applied month 00', patch: { lastAppliedMonth: '2026-00' } },
    { what: 'an id over 64 characters, too long for the entries it links', patch: { id: 'x'.repeat(65) } },
  ])('rejects $what', ({ patch }) => {
    expect(isMaterialisable(template(patch))).toBe(false)
  })
})
