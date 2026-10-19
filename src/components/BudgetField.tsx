import { useId, useState } from 'react'
import { formatMoney, minorToDecimalString, minorUnitDigits, parseMinor } from '../lib/money'
import { Button } from './Button'

/** The rules take a limit below 10^11 minor units, as for transaction amounts. */
const MAX_BUDGET = 99_999_999_999

type Props = {
  /** The stored limit in minor units, or null for none. Shown until the field is edited, also when it arrives after opening. */
  value: number | null
  currency: string
  locale: string | null
  /**
   * Called on every edit with the limit the text now stands for: minor units above 0, null for an empty field (no budget),
   * or NaN while the text is not an amount, as an input's `valueAsNumber` would be. The form cannot be saved meanwhile.
   */
  onChange: (minor: number | null) => void
}

export function BudgetField({ value, currency, locale, onChange }: Props) {
  const inputId = useId()
  const noteId = useId()
  const digits = minorUnitDigits(currency)
  // null until the field is edited: until then it shows the stored limit, which may load after the sheet opened.
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? (value === null ? '' : asText(value, digits))
  const { minor, problem } = readBudget(shown, digits)
  const invalid = problem !== null
  // Under the field: what to type instead, or how the limit will read in the app.
  const note = problem ?? (minor === null ? null : `${formatMoney(minor, currency, locale)} a month`)

  function edit(next: string) {
    setText(next)
    onChange(readBudget(next, digits).minor)
  }

  return (
    <div>
      <label htmlFor={inputId} className="mb-2 block px-1 text-xs font-semibold uppercase tracking-wider text-muted">
        Monthly budget
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          value={shown}
          onChange={(e) => edit(e.target.value)}
          inputMode="decimal"
          autoComplete="off"
          placeholder="e.g. 500"
          aria-invalid={invalid}
          aria-describedby={note === null ? undefined : noteId}
          className={`tnum min-h-11 min-w-0 flex-1 rounded-chip border bg-surface-2 px-3 text-text placeholder:text-muted ${invalid ? 'border-danger' : 'border-border'}`}
        />
        {/* Never disabled: it would drop the focus out of the sheet the moment it cleared the field. */}
        <Button variant="ghost" onClick={() => edit('')}>
          No budget
        </Button>
      </div>
      {/* Two elements, so that the hint is a new alert when it appears (read out while typing) and the read-back is never one. */}
      {note === null ? null : invalid ? (
        <p key="problem" id={noteId} role="alert" className="tnum mt-1 px-1 text-xs text-danger">
          {note}
        </p>
      ) : (
        <p key="read-back" id={noteId} className="tnum mt-1 px-1 text-xs text-muted">
          {note}
        </p>
      )}
    </div>
  )
}

/** The stored limit as one would type it: "500" for a whole amount, "499.90" otherwise. */
function asText(minor: number, digits: number): string {
  return minorToDecimalString(minor, digits).replace(/\.0+$/, '')
}

/**
 * What the text stands for: empty text is no budget (null); anything but an amount above 0 in the currency's digits is
 * NaN, with the problem to show. A decimal comma counts as the point: the decimal keypad shows the comma in regions that
 * write one.
 */
function readBudget(text: string, digits: number): { minor: number | null; problem: string | null } {
  const trimmed = text.trim()
  if (trimmed === '') return { minor: null, problem: null }
  const minor = parseMinor(trimmed.replace(',', '.'), digits)
  if (minor === 0) return { minor: NaN, problem: 'Enter an amount above 0, or tap No budget' }
  if (minor === null || minor > MAX_BUDGET) {
    return { minor: NaN, problem: digits === 0 ? 'Enter a whole number like 500' : `Enter a number like 500 or 499.${'9'.repeat(digits)}` }
  }
  return { minor, problem: null }
}
