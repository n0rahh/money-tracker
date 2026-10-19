import { Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useAddSheet } from '../context/AddSheetContext'
import { ACTION_DURATION_MS, useToast } from '../context/ToastContext'
import { useCategories } from '../hooks/useCategories'
import { useSettings } from '../hooks/useSettings'
import { useTransactions } from '../hooks/useTransactions'
import { addDays, parseIsoDate, todayIso } from '../lib/dates'
import { createRecurringWithFirstInstance, createTransaction, deleteTransaction, restoreTransaction, updateTransaction } from '../lib/firestore'
import { EMPTY_KEYPAD, keypadFromMinor, keypadMinor, pressKey, type KeypadState } from '../lib/keypad'
import { formatMoney, minorUnitDigits } from '../lib/money'
import { readErrorText } from '../lib/readError'
import { templateFrom } from '../lib/recurring'
import { orderCategoriesByRecency, suggestions, type Suggestion } from '../lib/stats'
import type { IsoDate, Kind, Settings, Transaction } from '../lib/types'
import { AmountDisplay } from './AmountDisplay'
import { Button } from './Button'
import { CategoryChip } from './CategoryChip'
import { DateChips } from './DateChips'
import { Keypad } from './Keypad'
import { RecurringToggle } from './RecurringToggle'
import { SegmentedControl } from './SegmentedControl'
import { Sheet } from './Sheet'
import { SuggestionChips } from './SuggestionChips'

export function AddTransactionSheet() {
  const { state, close, lastKind, rememberKind } = useAddSheet()
  // Read before the early return and waited for: the currency fixes the keypad's decimal digits when an edit is seeded.
  const { settings, loading } = useSettings()
  if (!state.open || loading) return null
  // key resets all form state for every open
  return (
    <AddTransactionForm
      key={state.editing?.id ?? 'new'}
      editing={state.editing}
      settings={settings}
      lastKind={lastKind}
      rememberKind={rememberKind}
      onClose={close}
    />
  )
}

type FormProps = {
  editing: Transaction | null
  /** null only while no settings document exists yet (first run). */
  settings: Settings | null
  lastKind: Kind
  rememberKind: (kind: Kind) => void
  onClose: () => void
}

function AddTransactionForm({ editing, settings, lastKind, rememberKind, onClose }: FormProps) {
  const { showToast } = useToast()
  const { categories, byId, loading: categoriesLoading } = useCategories()
  // The last 60 days feed both the quick-add chips and the category order. Fixed for the whole open, so passing midnight never resubscribes.
  const [{ from, to }] = useState(() => {
    const today = todayIso()
    return { from: addDays(today, -60), to: today }
  })
  const { transactions: recent } = useTransactions(from, to)
  // Only the entries the owner made: one a template wrote would put its category first on its day, and offer in quick add
  // a bill the app already adds each month.
  const logged = useMemo(() => recent.filter((t) => t.recurringId === undefined), [recent])

  const currency = settings?.currency ?? 'USD'
  const locale = settings?.locale ?? null
  const digits = minorUnitDigits(currency)

  const [kind, setKind] = useState<Kind>(editing?.kind ?? lastKind)
  const [keypad, setKeypad] = useState<KeypadState>(() => (editing ? keypadFromMinor(editing.amount, digits) : EMPTY_KEYPAD))
  const [categoryId, setCategoryId] = useState<string | null>(editing?.categoryId ?? null)
  const [date, setDate] = useState<IsoDate>(editing?.date ?? todayIso())
  const [note, setNote] = useState(editing?.note ?? '')
  // New entries only: an entry made from a template is edited like any other, and its template is managed in Settings.
  const [repeat, setRepeat] = useState(false)

  // An edit keeps its archived category on offer, first and marked; pickers otherwise hide archived ones (spec §6), so new entries never see it.
  const archivedOriginal = editing ? categories.find((c) => c.id === editing.categoryId && c.archived) : undefined
  const ordered = useMemo(() => {
    const active = orderCategoriesByRecency(categories, logged, kind)
    return archivedOriginal?.kind === kind ? [archivedOriginal, ...active] : active
  }, [categories, logged, kind, archivedOriginal])
  // New entries only, and only once the categories are known: like the category row, quick add offers only active categories,
  // never an archived one or one removed by hand (filtered before ranking, so neither takes a slot).
  const quickAdd = useMemo(
    () => (editing || categoriesLoading ? [] : suggestions(logged.filter((t) => byId.get(t.categoryId)?.archived === false), to)),
    [editing, categoriesLoading, logged, byId, to],
  )
  // Only until the first digit or category: from then on the row would just push the second row of categories below the fold.
  const offerQuickAdd = keypad.expr === '' && categoryId === null
  const selected = categories.find((c) => c.id === categoryId)
  const amount = keypadMinor(keypad, digits)
  const canSave = amount > 0 && selected !== undefined && selected.kind === kind

  useEffect(() => {
    if (selected && selected.kind !== kind) setCategoryId(null)
  }, [kind, selected])

  const fail = (what: string, durationMs?: number) => (e: unknown) =>
    showToast(e instanceof Error ? `${what}: ${readErrorText(e)}` : what, { durationMs })

  function pick(s: Suggestion) {
    setKind(s.kind)
    setKeypad(keypadFromMinor(s.amount, digits))
    setCategoryId(s.categoryId)
    setNote(s.note)
  }

  function save() {
    if (!canSave || !selected) return
    const input = { kind, amount, categoryId: selected.id, note: note.trim(), date }
    let pending: Promise<unknown>
    if (editing) pending = updateTransaction(editing.id, { ...input, at: editing.date === date ? editing.at.toDate() : undefined })
    // No createTransaction: the entry is the template's own, under its month's fixed id. One batch for both, since a template
    // written first and alone reached the listener with no month applied, and the materialiser then wrote that month again.
    else if (repeat) pending = createRecurringWithFirstInstance(templateFrom(input)).done
    else pending = createTransaction(input).done
    pending.catch(fail('Could not save'))
    rememberKind(kind)
    onClose() // never wait for the server: the local cache already applied the write
  }

  // No confirmation: the toast's Undo writes the entry back under its own id. Neither write is waited for.
  function remove() {
    if (!editing) return
    const deleted = editing
    deleteTransaction(deleted.id).catch(fail('Could not delete'))
    showToast('Deleted', {
      actionLabel: 'Undo',
      onAction: () => {
        // As long as the Undo it answers: the entry stays deleted, so this one must not be missed.
        restoreTransaction(deleted).catch(fail('Could not undo', ACTION_DURATION_MS))
      },
    })
    onClose()
  }

  const saveLabel = canSave && selected
    ? `${editing ? 'Save' : 'Add'} ${formatMoney(amount, currency, locale)} · ${selected.name}`
    : 'Enter amount and pick a category'

  return (
    <Sheet
      // Mounted per open with the form, so the Sheet takes a pending Undo toast off the keypad's bottom row on every open.
      open
      full
      title={editing ? 'Edit' : 'Add'}
      onClose={onClose}
      // sticky amount block (162 px) + 8 px = 10.625rem, so a focused field is never scrolled in behind it; no block to clear once it is static
      bodyClassName="scroll-pt-[10.625rem] short:scroll-pt-0"
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
        {/* Stays in view while the quick-add chips, date, note and categories scroll beneath it; below 700 px of height it scrolls with them so the chips stay reachable. */}
        <div className="sticky top-0 z-10 -mx-4 bg-surface px-4 pb-2 flex flex-col gap-3 short:static">
          <SegmentedControl ariaLabel="Kind" value={kind} onChange={setKind} options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }]} />
          <AmountDisplay state={keypad} currency={currency} locale={locale} kind={kind} />
        </div>
        {offerQuickAdd ? <SuggestionChips items={quickAdd} byId={byId} currency={currency} locale={locale} onPick={pick} /> : null}
        <DateChips value={date} onChange={setDate} />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          placeholder="Note (optional)"
          aria-label="Note"
          className="min-h-11 rounded-chip border border-border bg-surface-2 px-3 text-text placeholder:text-muted"
        />
        <div role="group" className="-mx-4 overflow-x-auto px-4" aria-label="Category">
          <div className="grid grid-flow-col grid-rows-2 gap-2">
            {ordered.map((c) => (
              <CategoryChip
                key={c.id}
                category={c}
                label={c.archived ? `${c.name} (archived)` : undefined}
                selected={c.id === categoryId}
                onClick={() => setCategoryId(c.id)}
              />
            ))}
          </div>
        </div>
        {/* Last, so the rows of the fast path (digits, category, Save) stay where they were. */}
        {editing ? null : <RecurringToggle checked={repeat} onChange={setRepeat} dayOfMonth={parseIsoDate(date).getDate()} />}
      </div>
    </Sheet>
  )
}
