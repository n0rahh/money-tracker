import { describe, expect, it } from 'vitest'
import {
  addDays, addMonths, currentMonth, dayLabel, daysInMonth, lastMonths, monthLabel, monthOf,
  monthRange, monthShortLabel, monthsBetween, parseIsoDate, toIsoDate, todayIso, yearToDateMonths,
} from './dates'

describe('dates', () => {
  it('formats and parses local ISO dates at noon', () => {
    expect(toIsoDate(new Date(2026, 9, 14, 23, 59))).toBe('2026-10-14')
    const d = parseIsoDate('2026-10-14')
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 14, 12])
    expect(todayIso(new Date(2026, 0, 1))).toBe('2026-01-01')
    expect(monthOf('2026-10-14')).toBe('2026-10')
    expect(currentMonth(new Date(2026, 9, 14))).toBe('2026-10')
  })

  it('knows month lengths and ranges, including leap years', () => {
    expect(daysInMonth('2026-02')).toBe(28)
    expect(daysInMonth('2024-02')).toBe(29)
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(monthRange('2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' })
  })

  it('adds months across year boundaries', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-10', -12)).toBe('2025-10')
    expect(lastMonths('2026-10', 3)).toEqual(['2026-08', '2026-09', '2026-10'])
  })

  it('adds days without DST or month-boundary surprises', () => {
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30') // Europe DST switch day
    expect(addDays('2026-03-29', -1)).toBe('2026-03-28')
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26') // Europe DST end
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('labels months and days', () => {
    expect(monthLabel('2026-10', 'en')).toBe('October 2026')
    expect(dayLabel('2026-10-14', '2026-10-14', 'en')).toBe('Today')
    expect(dayLabel('2026-10-13', '2026-10-14', 'en')).toBe('Yesterday')
    expect(dayLabel('2026-10-01', '2026-10-14', 'en')).toBe('Thu, Oct 1')
  })
})

describe('insight date helpers', () => {
  it('lists months between two months inclusive', () => {
    expect(monthsBetween('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    expect(monthsBetween('2026-03', '2026-03')).toEqual(['2026-03'])
    expect(monthsBetween('2026-04', '2026-03')).toEqual([])
  })
  it('lists year-to-date months', () => {
    expect(yearToDateMonths(new Date(2026, 9, 17))).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
    expect(yearToDateMonths(new Date(2026, 0, 3))).toEqual(['2026-01'])
  })
  it('labels months short, with the year only when it differs from the current one', () => {
    const thisYear = new Date().getFullYear()
    expect(monthShortLabel(`${thisYear}-10`, 'en')).toBe('Oct')
    expect(monthShortLabel('2019-03', 'en')).toBe('Mar 19')
  })
})
