import { Timestamp } from 'firebase/firestore'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mapBudget, mapCategory, mapRecurring, mapSettings, mapTransaction, transactionAt } from './mappers'

describe('mapCategory', () => {
  it('maps a well-formed document', () => {
    const c = mapCategory('c1', { name: 'Coffee', icon: 'Coffee', color: 'amber', kind: 'expense', order: 2, archived: false })
    expect(c).toMatchObject({ id: 'c1', name: 'Coffee', icon: 'Coffee', color: 'amber', kind: 'expense', order: 2, archived: false })
  })
  it('falls back for unknown icon/color and missing fields', () => {
    const c = mapCategory('c2', { name: 'X', icon: 'NotAnIcon', color: 'magenta', kind: 'income' })
    expect(c).toMatchObject({ icon: 'CircleEllipsis', color: 'slate', kind: 'income', order: 0, archived: false })
  })
  it('keeps archived: true', () => {
    expect(mapCategory('c3', { name: 'Old', archived: true }).archived).toBe(true)
  })
  it('drops a createdAt that is not a Timestamp', () => {
    expect(mapCategory('c4', { name: 'X', createdAt: '2026-10-14' }).createdAt).toBeUndefined()
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
  it('rounds a fractional amount to whole minor units', () => {
    expect(mapTransaction('t3', { amount: 12.6, date: '2026-10-01' }).amount).toBe(13)
  })
  it('defaults a missing amount to 0 and a missing date to 1970-01-01', () => {
    expect(mapTransaction('t4', {})).toMatchObject({ amount: 0, date: '1970-01-01' })
  })
  it('keeps the "import" source', () => {
    expect(mapTransaction('t5', { amount: 5, date: '2026-10-01', source: 'import' }).source).toBe('import')
  })
  it('falls back to local noon of the date when `at` is not a Timestamp', () => {
    const t = mapTransaction('t6', { amount: 5, date: '2026-10-01', at: '2026-10-01T10:00:00Z' })
    expect(t.at.toMillis()).toBe(new Date(2026, 9, 1, 12).getTime())
  })
  it('passes a recurringId through', () => {
    expect(mapTransaction('t7', { amount: 5, date: '2026-10-01', recurringId: 'rec_a_2026-10' }).recurringId).toBe('rec_a_2026-10')
  })
  it.each([
    { name: 'missing', data: {} },
    { name: 'empty', data: { recurringId: '' } },
    { name: 'a number', data: { recurringId: 7 } },
    { name: 'null', data: { recurringId: null } },
  ])('leaves recurringId out altogether when it is $name', ({ data }) => {
    expect(mapTransaction('t8', { amount: 5, date: '2026-10-01', ...data })).not.toHaveProperty('recurringId')
  })
})

describe('mapBudget', () => {
  it('maps a well-formed document to the category id and the monthly limit', () => {
    expect(mapBudget('c1', { monthly: 50000, updatedAt: Timestamp.now() })).toEqual({ categoryId: 'c1', monthly: 50000 })
  })
  it('rounds a fractional limit to whole minor units', () => {
    expect(mapBudget('c1', { monthly: 12.6 }).monthly).toBe(13)
  })
  it('turns a missing or non-numeric limit into 0, which means "no usable limit"', () => {
    expect(mapBudget('c1', {}).monthly).toBe(0)
    expect(mapBudget('c1', { monthly: '500' }).monthly).toBe(0)
    expect(mapBudget('c1', { monthly: null }).monthly).toBe(0)
  })
})

describe('mapRecurring', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 17, 12, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('maps a well-formed document', () => {
    const createdAt = Timestamp.fromDate(new Date(2026, 0, 1, 9))
    const updatedAt = Timestamp.fromDate(new Date(2026, 8, 25, 9))
    const t = mapRecurring('r1', {
      kind: 'income', amount: 500000, categoryId: 'salary', note: 'Pay', dayOfMonth: 25,
      startMonth: '2026-01', endMonth: '2026-12', lastAppliedMonth: '2026-09', createdAt, updatedAt,
    })
    expect(t).toEqual({
      id: 'r1', kind: 'income', amount: 500000, categoryId: 'salary', note: 'Pay', dayOfMonth: 25,
      startMonth: '2026-01', endMonth: '2026-12', lastAppliedMonth: '2026-09', createdAt, updatedAt,
    })
  })
  it('keeps "no end" and "never applied" as null', () => {
    const t = mapRecurring('r2', { kind: 'expense', amount: 1, categoryId: 'c', note: '', dayOfMonth: 1, startMonth: '2026-10', endMonth: null, lastAppliedMonth: null })
    expect([t.endMonth, t.lastAppliedMonth]).toEqual([null, null])
  })
  it('defaults an empty document: an expense of 0 on day 1, starting this month, without an end, never applied', () => {
    expect(mapRecurring('r3', {})).toEqual({
      id: 'r3', kind: 'expense', amount: 0, categoryId: '', note: '', dayOfMonth: 1, startMonth: '2026-10', endMonth: null, lastAppliedMonth: null,
    })
  })
  it.each([
    { given: 1, day: 1 },
    { given: 31, day: 31 },
    { given: 0, day: 1 },
    { given: -3, day: 1 },
    { given: 32, day: 31 },
    { given: 45, day: 31 },
    { given: 15.4, day: 15 },
    { given: 15.6, day: 16 },
    { given: Infinity, day: 31 },
    { given: -Infinity, day: 1 },
    { given: NaN, day: 1 },
    { given: '15', day: 1 },
    { given: null, day: 1 },
  ])('turns a dayOfMonth of $given into $day', ({ given, day }) => {
    expect(mapRecurring('r4', { dayOfMonth: given }).dayOfMonth).toBe(day)
  })
  it.each(['2026-13', '2026-00', '2026-1', '2026-10-01', 'x', '', 202610, null])(
    'replaces the invalid month %j: this month for startMonth, null for endMonth and lastAppliedMonth',
    (bad) => {
      expect(mapRecurring('r5', { startMonth: bad, endMonth: bad, lastAppliedMonth: bad })).toMatchObject({
        startMonth: '2026-10', endMonth: null, lastAppliedMonth: null,
      })
    },
  )
  it('treats an unknown kind as an expense and keeps income', () => {
    expect(mapRecurring('r6', { kind: 'transfer' }).kind).toBe('expense')
    expect(mapRecurring('r7', { kind: 'income' }).kind).toBe('income')
  })
  it('rounds a fractional amount and defaults a non-numeric one to 0', () => {
    expect(mapRecurring('r8', { amount: 12.6 }).amount).toBe(13)
    expect(mapRecurring('r9', { amount: '12' }).amount).toBe(0)
  })
  it('drops createdAt and updatedAt that are not Timestamps', () => {
    const t = mapRecurring('r10', { createdAt: '2026-10-01', updatedAt: 5 })
    expect([t.createdAt, t.updatedAt]).toEqual([undefined, undefined])
  })
})

describe('mapSettings', () => {
  it('validates the currency code and locale', () => {
    expect(mapSettings({ currency: 'EUR', locale: 'uk-UA' })).toEqual({ currency: 'EUR', locale: 'uk-UA' })
    expect(mapSettings({ currency: 'nope', locale: 7 })).toEqual({ currency: 'USD', locale: null })
  })
  it('falls back to USD for a lowercase code and keeps a valid one', () => {
    expect(mapSettings({ currency: 'eur' }).currency).toBe('USD')
    expect(mapSettings({ currency: 'PLN' }).currency).toBe('PLN')
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
  it('lets an explicit moment win even when the date is today', () => {
    const at = new Date(2026, 9, 14, 9, 0)
    expect(transactionAt({ date: '2026-10-14', at }, now).toMillis()).toBe(at.getTime())
  })
})
