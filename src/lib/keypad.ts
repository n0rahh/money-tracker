import { minorToDecimalString, parseMinor } from './money'

export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | '+' | '-' | 'back' | 'clear' | 'equals'
export type KeypadState = { expr: string }

export const EMPTY_KEYPAD: KeypadState = { expr: '' }
const MAX_INT_DIGITS = 9
const MAX_EXPR_LENGTH = 24 // longest expression the keypad accepts
const MAX_MINOR = 99_999_999_999 // rules require amount < 100000000000

function currentTerm(expr: string): string {
  const lastOp = Math.max(expr.lastIndexOf('+'), expr.lastIndexOf('-'))
  return expr.slice(lastOp + 1)
}

function trimZeros(decimal: string): string {
  return decimal.includes('.') ? decimal.replace(/0+$/, '').replace(/\.$/, '') : decimal
}

export function pressKey(state: KeypadState, key: KeypadKey, digits = 2): KeypadState {
  const { expr } = state
  if (key === 'clear') return EMPTY_KEYPAD
  if (key === 'back') return { expr: expr.slice(0, -1) }
  if (key === 'equals') {
    const minor = keypadMinor(state, digits)
    return { expr: minor === 0 ? '' : trimZeros(minorToDecimalString(minor, digits)) }
  }
  if (expr.length >= MAX_EXPR_LENGTH) return state

  const term = currentTerm(expr)
  if (key === '+' || key === '-') {
    if (expr === '') return state
    if (term === '' || term.endsWith('.')) return { expr: expr.slice(0, -1) + key }
    return { expr: expr + key }
  }
  if (key === '.') {
    if (digits === 0 || term.includes('.')) return state
    return { expr: expr + (term === '' ? '0.' : '.') }
  }

  const [intPart, fracPart] = term.split('.')
  if (fracPart !== undefined) {
    if (fracPart.length >= digits) return state
    return { expr: expr + key }
  }
  if (intPart === '0') return { expr: expr.slice(0, -1) + key }
  if (intPart.length >= MAX_INT_DIGITS) return state
  return { expr: expr + key }
}

/** Evaluates the expression exactly in minor units; never below 0, never above MAX_MINOR. */
export function keypadMinor(state: KeypadState, digits = 2): number {
  let total = 0
  let sign = 1
  let term = ''
  const flush = () => {
    const value = parseMinor(term, digits)
    if (value !== null) total += sign * value
    term = ''
  }
  for (const ch of state.expr) {
    if (ch === '+' || ch === '-') {
      flush()
      sign = ch === '+' ? 1 : -1
    } else {
      term += ch
    }
  }
  flush()
  return Math.min(Math.max(0, total), MAX_MINOR)
}

export function hasOperator(state: KeypadState): boolean {
  return /[+-]/.test(state.expr)
}

export function keypadFromMinor(minor: number, digits: number): KeypadState {
  return { expr: trimZeros(minorToDecimalString(minor, digits)) }
}
