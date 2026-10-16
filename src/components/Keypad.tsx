import { Delete } from 'lucide-react'
import type { KeypadKey } from '../lib/keypad'

const KEYS: KeypadKey[] = ['1', '2', '3', 'back', '4', '5', '6', '+', '7', '8', '9', '-', 'clear', '0', '.', 'equals']
const LABELS: Partial<Record<KeypadKey, string>> = { '+': '+', '-': '−', equals: '=', clear: 'C' }
const ARIA: Partial<Record<KeypadKey, string>> = { back: 'Backspace', '+': 'Plus', '-': 'Minus', equals: 'Equals', clear: 'Clear', '.': 'Decimal point' }
const OPERATORS = new Set<KeypadKey>(['back', '+', '-', 'clear', 'equals'])

type Props = { onPress: (key: KeypadKey) => void; disableDecimal?: boolean }

export function Keypad({ onPress, disableDecimal = false }: Props) {
  return (
    <div className="grid grid-cols-4 gap-2" role="group" aria-label="Keypad">
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          aria-label={ARIA[key] ?? key}
          disabled={key === '.' && disableDecimal}
          onClick={() => onPress(key)}
          className={`tnum flex h-14 items-center justify-center rounded-chip text-xl font-medium transition active:scale-95 disabled:opacity-30 ${
            key === 'equals' ? 'bg-accent/15 text-accent' : OPERATORS.has(key) ? 'bg-surface text-muted' : 'bg-surface-2 text-text'
          }`}
        >
          {key === 'back' ? <Delete size={22} /> : (LABELS[key] ?? key)}
        </button>
      ))}
    </div>
  )
}
