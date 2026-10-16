import { Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useAddSheet } from '../context/AddSheetContext'
import { useToast } from '../context/ToastContext'
import { useCategories } from '../hooks/useCategories'
import { useSettings } from '../hooks/useSettings'
import { useTransactions } from '../hooks/useTransactions'
import { currentMonth, monthRange, todayIso } from '../lib/dates'
import { createTransaction, deleteTransaction, updateTransaction } from '../lib/firestore'
import { EMPTY_KEYPAD, keypadFromMinor, keypadMinor, pressKey, type KeypadState } from '../lib/keypad'
import { formatMoney, minorUnitDigits } from '../lib/money'
import { orderCategoriesByRecency } from '../lib/stats'
import type { IsoDate, Kind, Transaction } from '../lib/types'
import { AmountDisplay } from './AmountDisplay'
import { Button } from './Button'
import { CategoryChip } from './CategoryChip'
import { DateChips } from './DateChips'
import { Keypad } from './Keypad'
import { SegmentedControl } from './SegmentedControl'
import { Sheet } from './Sheet'

/** Kind of the last saved entry; a new entry starts with it for the rest of the session (spec §7). */
let lastKind: Kind = 'expense'

export function AddTransactionSheet() {
  const { state, close } = useAddSheet()
  if (!state.open) return null
  // key resets all form state for every open
  return <AddTransactionForm key={state.editing?.id ?? 'new'} editing={state.editing} onClose={close} />
}

function AddTransactionForm({ editing, onClose }: { editing: Transaction | null; onClose: () => void }) {
  const { showToast } = useToast()
  const { categories } = useCategories()
  const { settings } = useSettings()
  const { from, to } = monthRange(currentMonth())
  const { transactions: recent } = useTransactions(from, to)

  const currency = settings?.currency ?? 'USD'
  const locale = settings?.locale ?? null
  const digits = minorUnitDigits(currency)

  const [kind, setKind] = useState<Kind>(editing?.kind ?? lastKind)
  const [keypad, setKeypad] = useState<KeypadState>(() => (editing ? keypadFromMinor(editing.amount, digits) : EMPTY_KEYPAD))
  const [categoryId, setCategoryId] = useState<string | null>(editing?.categoryId ?? null)
  const [date, setDate] = useState<IsoDate>(editing?.date ?? todayIso())
  const [note, setNote] = useState(editing?.note ?? '')

  const ordered = useMemo(() => orderCategoriesByRecency(categories, recent, kind), [categories, recent, kind])
  const selected = categories.find((c) => c.id === categoryId)
  const amount = keypadMinor(keypad, digits)
  const canSave = amount > 0 && selected !== undefined && selected.kind === kind

  useEffect(() => {
    if (selected && selected.kind !== kind) setCategoryId(null)
  }, [kind, selected])

  const fail = (what: string) => (e: unknown) => showToast(e instanceof Error ? `${what}: ${e.message}` : what)

  function save() {
    if (!canSave || !selected) return
    const input = { kind, amount, categoryId: selected.id, note: note.trim(), date }
    const pending = editing
      ? updateTransaction(editing.id, { ...input, at: editing.date === date ? editing.at.toDate() : undefined })
      : createTransaction(input).done
    pending.catch(fail('Could not save'))
    lastKind = kind
    onClose() // never wait for the server: the local cache already applied the write
  }

  function remove() {
    if (!editing || !window.confirm('Delete this transaction?')) return
    deleteTransaction(editing.id).catch(fail('Could not delete'))
    onClose()
  }

  const saveLabel = canSave && selected
    ? `${editing ? 'Save' : 'Add'} ${formatMoney(amount, currency, locale)} · ${selected.name}`
    : 'Enter amount and pick a category'

  return (
    <Sheet
      open
      full
      title={editing ? 'Edit' : 'Add'}
      onClose={onClose}
      // sticky amount block (162 px) + 8 px, so a focused field is never scrolled in behind it; no block to clear once it is static
      bodyClassName="scroll-pt-[170px] short:scroll-pt-0"
      headerRight={
        editing ? (
          <button type="button" aria-label="Delete" onClick={remove} className="flex size-11 items-center justify-center rounded-full bg-danger/15 text-danger">
            <Trash2 size={18} />
          </button>
        ) : null
      }
      footer={
        <div className="flex flex-col gap-3">
          <Keypad onPress={(k) => setKeypad((s) => pressKey(s, k, digits))} disableDecimal={digits === 0} />
          <Button className="w-full" disabled={!canSave} onClick={save}>
            {saveLabel}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Stays in view while the date, note and categories scroll beneath it; below 700 px of height it scrolls with them so the chips stay reachable. */}
        <div className="sticky top-0 z-10 -mx-4 bg-surface px-4 pb-2 flex flex-col gap-3 short:static">
          <SegmentedControl ariaLabel="Kind" value={kind} onChange={setKind} options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }]} />
          <AmountDisplay state={keypad} currency={currency} locale={locale} kind={kind} />
        </div>
        <DateChips value={date} onChange={setDate} />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          placeholder="Note (optional)"
          aria-label="Note"
          className="min-h-11 rounded-chip border border-border bg-surface-2 px-3 text-text placeholder:text-muted"
        />
        <div className="-mx-4 overflow-x-auto px-4" aria-label="Category">
          <div className="grid grid-flow-col grid-rows-2 gap-2">
            {ordered.map((c) => (
              <CategoryChip key={c.id} category={c} selected={c.id === categoryId} onClick={() => setCategoryId(c.id)} />
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  )
}
