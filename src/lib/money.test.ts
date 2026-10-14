import { describe, expect, it } from 'vitest'
import { formatMoney, minorToDecimalString, minorUnitDigits, parseMinor } from './money'

describe('minorUnitDigits', () => {
  it('knows 2-digit and 0-digit currencies and falls back to 2', () => {
    expect(minorUnitDigits('EUR')).toBe(2)
    expect(minorUnitDigits('JPY')).toBe(0)
    expect(minorUnitDigits('NOPE')).toBe(2)
  })
  it('uses the ISO 4217 scale, not the runtime ICU data', () => {
    expect(minorUnitDigits('HUF')).toBe(2)
    expect(minorUnitDigits('COP')).toBe(2)
    expect(minorUnitDigits('IQD')).toBe(3)
    expect(minorUnitDigits('KWD')).toBe(3)
    expect(minorUnitDigits('CLF')).toBe(4)
  })
  it('falls back to 2 for unknown codes and tolerates case and whitespace', () => {
    expect(minorUnitDigits('XYZ')).toBe(2)
    expect(minorUnitDigits('jpy')).toBe(0)
    expect(minorUnitDigits(' pln ')).toBe(2)
    expect(minorUnitDigits(' jpy ')).toBe(0)
  })
})

describe('formatMoney', () => {
  it('formats minor units with the currency symbol', () => {
    expect(formatMoney(123456, 'EUR', 'en')).toBe('€1,234.56')
    expect(formatMoney(500, 'JPY', 'en')).toBe('¥500')
    expect(formatMoney(5, 'USD', 'en')).toBe('$0.05')
  })
  it('shows an explicit sign when asked, except for zero', () => {
    expect(formatMoney(250, 'USD', 'en', { signed: true })).toBe('+$2.50')
    expect(formatMoney(-250, 'USD', 'en', { signed: true })).toBe('-$2.50')
    expect(formatMoney(0, 'USD', 'en', { signed: true })).toBe('$0.00')
  })
  it('pins ISO digits regardless of ICU data', () => {
    expect(formatMoney(150000, 'HUF', 'en')).toMatch(/1,500\.00$/)
    expect(formatMoney(1234567, 'KWD', 'en')).toMatch(/1,234\.567$/)
  })
})

describe('parseMinor', () => {
  it('parses decimal strings exactly', () => {
    expect(parseMinor('12.5', 2)).toBe(1250)
    expect(parseMinor('12', 2)).toBe(1200)
    expect(parseMinor('.5', 2)).toBe(50)
    expect(parseMinor('0.07', 2)).toBe(7)
    expect(parseMinor('5', 0)).toBe(5)
  })
  it('rejects too many decimals, empty and junk', () => {
    expect(parseMinor('12.345', 2)).toBeNull()
    expect(parseMinor('5.0', 0)).toBeNull()
    expect(parseMinor('', 2)).toBeNull()
    expect(parseMinor('1,5', 2)).toBeNull()
    expect(parseMinor('abc', 2)).toBeNull()
  })
  it('rejects results beyond the safe integer range', () => {
    expect(parseMinor('9007199254740993', 0)).toBeNull()
    expect(parseMinor('90071992547409.93', 2)).toBeNull()
  })
})

describe('minorToDecimalString', () => {
  it('renders minor units as a plain decimal', () => {
    expect(minorToDecimalString(1550, 2)).toBe('15.50')
    expect(minorToDecimalString(5, 2)).toBe('0.05')
    expect(minorToDecimalString(500, 0)).toBe('500')
    expect(minorToDecimalString(-1550, 2)).toBe('-15.50')
  })
})
