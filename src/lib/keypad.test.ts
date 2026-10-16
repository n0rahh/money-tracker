import { describe, expect, it } from 'vitest'
import { EMPTY_KEYPAD, hasOperator, keypadFromMinor, keypadMinor, pressKey, type KeypadKey } from './keypad'

const press = (keys: string, digits = 2) =>
  keys.split('').reduce((s, k) => pressKey(s, k as KeypadKey, digits), EMPTY_KEYPAD)

describe('pressKey', () => {
  it('types digits and a decimal point', () => expect(press('12.5').expr).toBe('12.5'))
  it('ignores a second decimal point in the same term', () => expect(press('1.2.3').expr).toBe('1.23'))
  it('caps decimals at the currency digits', () => {
    expect(press('1.234').expr).toBe('1.23')
    expect(press('1.5', 0).expr).toBe('15')
  })
  it('replaces a leading zero', () => expect(press('07').expr).toBe('7'))
  it('starts a decimal with 0.', () => expect(press('.5').expr).toBe('0.5'))
  it('cannot start with an operator', () => expect(press('+5').expr).toBe('5'))
  it('replaces an operator with another operator', () => expect(press('5+-3').expr).toBe('5-3'))
  it('drops a dangling decimal point before an operator', () => expect(press('5.+3').expr).toBe('5+3'))
  it('caps integer digits at 9', () => expect(press('1234567890').expr).toBe('123456789'))
  it('backspace removes the last character', () => expect(pressKey(press('12+'), 'back').expr).toBe('12'))
  it('clear empties the expression', () => expect(pressKey(press('12'), 'clear')).toEqual(EMPTY_KEYPAD))
  it('equals collapses the expression to its value', () => {
    expect(pressKey(press('12.5+3'), 'equals').expr).toBe('15.5')
    expect(pressKey(press('10-15'), 'equals').expr).toBe('')
  })
})

describe('keypadMinor', () => {
  it('evaluates sums in minor units without floats', () => {
    expect(keypadMinor(press('12.5+3'))).toBe(1550)
    expect(keypadMinor(press('0.1+0.2'))).toBe(30)
    expect(keypadMinor(press('10-2.25'))).toBe(775)
  })
  it('ignores a trailing operator and empty input', () => {
    expect(keypadMinor(press('5+'))).toBe(500)
    expect(keypadMinor(EMPTY_KEYPAD)).toBe(0)
  })
  it('clamps negative results to zero', () => expect(keypadMinor(press('10-15'))).toBe(0))
  it('caps the evaluated amount at 99,999,999,999', () => expect(keypadMinor(press('999999999+999999999'))).toBe(99_999_999_999))
})

describe('helpers', () => {
  it('hasOperator', () => {
    expect(hasOperator(press('12'))).toBe(false)
    expect(hasOperator(press('12+3'))).toBe(true)
    expect(hasOperator(press('5-1'))).toBe(true)
  })
  it('keypadFromMinor prefills for editing without trailing zeros', () => {
    expect(keypadFromMinor(1250, 2).expr).toBe('12.5')
    expect(keypadFromMinor(1200, 2).expr).toBe('12')
    expect(keypadFromMinor(500, 0).expr).toBe('500')
  })
})
