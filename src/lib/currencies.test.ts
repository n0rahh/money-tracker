import { describe, expect, it } from 'vitest'
import { CURRENCIES, filterCurrencies } from './currencies'

describe('currencies', () => {
  it('lists unique ISO codes with names', () => {
    expect(CURRENCIES.length).toBeGreaterThanOrEqual(25)
    expect(new Set(CURRENCIES.map((c) => c.code)).size).toBe(CURRENCIES.length)
    for (const c of CURRENCIES) expect(c.code).toMatch(/^[A-Z]{3}$/)
  })
  it('filters by code or name, case-insensitively', () => {
    expect(filterCurrencies('hryv').map((c) => c.code)).toEqual(['UAH'])
    expect(filterCurrencies('usd').map((c) => c.code)).toEqual(['USD'])
    expect(filterCurrencies('')).toEqual(CURRENCIES)
    expect(filterCurrencies('zzz')).toEqual([])
  })
})
