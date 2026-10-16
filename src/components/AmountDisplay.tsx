import { hasOperator, keypadMinor, type KeypadState } from '../lib/keypad'
import { formatMoney, minorUnitDigits } from '../lib/money'
import type { Kind } from '../lib/types'

type Props = { state: KeypadState; currency: string; locale: string | null; kind: Kind }

export function AmountDisplay({ state, currency, locale, kind }: Props) {
  const digits = minorUnitDigits(currency)
  const minor = keypadMinor(state, digits)
  const expr = state.expr === '' ? '0' : state.expr.replace(/\+/g, ' + ').replace(/-/g, ' − ')
  return (
    <div className="py-2 text-center">
      <div data-testid="amount-expr" aria-live="polite" className={`tnum truncate text-[40px] font-semibold leading-tight ${kind === 'income' ? 'text-accent' : 'text-text'}`}>
        {expr}
      </div>
      <div data-testid="amount-total" className="tnum mt-1 text-sm text-muted">
        {hasOperator(state) ? '= ' : ''}
        {formatMoney(minor, currency, locale)}
      </div>
    </div>
  )
}
