import { hasOperator, keypadMinor, type KeypadState } from '../lib/keypad'
import { formatMoney, minorUnitDigits } from '../lib/money'
import type { Kind } from '../lib/types'

type Props = { state: KeypadState; currency: string; locale: string | null; kind: Kind }

// Tailwind only emits classes it can see as whole strings, so each size is spelled out in full.
const SIZE_CLASS = { lg: 'text-[40px]', md: 'text-[28px]', sm: 'text-[22px]' }

export function AmountDisplay({ state, currency, locale, kind }: Props) {
  const digits = minorUnitDigits(currency)
  const minor = keypadMinor(state, digits)
  const expr = state.expr === '' ? '0' : state.expr.replace(/\+/g, ' + ').replace(/-/g, ' − ')
  // Steps down by displayed length (operator spaces included); several operators in a 24-character expression can still overflow, and that is clipped.
  const size = expr.length > 18 ? 'sm' : expr.length > 11 ? 'md' : 'lg'
  return (
    <div className="py-2 text-center">
      {/* Fixed at the lg line height (50px) so stepping the size never moves what is below. */}
      <div className="flex h-[50px] items-center justify-center">
        <div
          data-testid="amount-expr"
          data-size={size}
          aria-live="polite"
          className={`tnum overflow-hidden whitespace-nowrap font-semibold leading-tight ${SIZE_CLASS[size]} ${kind === 'income' ? 'text-accent' : 'text-text'}`}
        >
          {expr}
        </div>
      </div>
      <div data-testid="amount-total" className="tnum mt-1 text-sm text-muted">
        {hasOperator(state) ? '= ' : ''}
        {formatMoney(minor, currency, locale)}
      </div>
    </div>
  )
}
