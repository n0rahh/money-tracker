import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../context/ToastContext'
import { CATEGORY_COLORS, COLOR_KEYS, type ColorKey } from '../lib/categoryColors'
import { FALLBACK_ICON, type IconKey } from '../lib/categoryIcons'
import { createCategory, setBudget, swapCategoryOrder, updateCategory } from '../lib/firestore'
import type { Category, Kind } from '../lib/types'
import { BudgetField } from './BudgetField'
import { Button } from './Button'
import { CategoryChip } from './CategoryChip'
import { ColorPicker } from './ColorPicker'
import { IconPicker } from './IconPicker'
import { Sheet } from './Sheet'

type Props = {
  open: boolean
  kind: Kind
  editing: Category | null
  /** Active categories of `kind`, sorted by `order` (used for Move up/down). */
  siblings: Category[]
  /** One past the highest `order` of `kind`, archived included: where new and unarchived categories go. */
  nextOrder: number
  /** The edited category's monthly limit in minor units, or null for none (always null for a new category). */
  budget: number | null
  currency: string
  locale: string | null
  onClose: () => void
}

export function CategoryEditSheet({ open, kind, editing, siblings, nextOrder, budget, currency, locale, onClose }: Props) {
  const { showToast } = useToast()
  const [name, setName] = useState(editing?.name ?? '')
  const [icon, setIcon] = useState<IconKey>(editing?.icon ?? FALLBACK_ICON)
  const [color, setColor] = useState<ColorKey>(editing?.color ?? COLOR_KEYS[0])
  // undefined until the budget field is edited, so an untouched field writes nothing, even when the stored limit loads
  // after the sheet opened; NaN while its text is not an amount.
  const [budgetDraft, setBudgetDraft] = useState<number | null | undefined>(undefined)

  const trimmed = name.trim()
  const canSave = trimmed.length > 0 && trimmed.length <= 40 && !Number.isNaN(budgetDraft)
  // Budgets are spending limits (spec §9): income categories have none.
  const offersBudget = (editing?.kind ?? kind) === 'expense'
  const preview: Category = { id: editing?.id ?? 'preview', name: trimmed || 'Preview', icon, color, kind, order: 0, archived: false }
  const current = editing ? (siblings.find((c) => c.id === editing.id) ?? editing) : null
  const index = current ? siblings.findIndex((c) => c.id === current.id) : -1
  const fail = (e: unknown) => showToast(e instanceof Error ? `Could not save: ${e.message}` : 'Could not save')

  function save() {
    if (!canSave) return
    const budgetChanged = budgetDraft !== undefined && budgetDraft !== budget
    if (editing) {
      updateCategory(editing.id, { name: trimmed, icon, color }).catch(fail)
      if (budgetChanged) setBudget(editing.id, budgetDraft).catch(fail)
    } else {
      const created = createCategory({ name: trimmed, icon, color, kind, order: nextOrder, archived: false })
      created.done.catch(fail)
      // The new id is known at once, so the budget goes out alongside the category instead of after its write.
      if (budgetChanged) setBudget(created.id, budgetDraft).catch(fail)
    }
    onClose()
  }

  function move(delta: -1 | 1) {
    const neighbor = siblings[index + delta]
    if (!current || !neighbor) return
    swapCategoryOrder(current, neighbor).catch(fail)
  }

  function toggleArchived() {
    if (!editing) return
    // Product choice: an unarchived category reappears at the bottom with a fresh unique order (its old slot is not restored).
    updateCategory(editing.id, editing.archived ? { archived: false, order: nextOrder } : { archived: true }).catch(fail)
    onClose()
  }

  return (
    <Sheet
      open={open}
      title={editing ? 'Edit category' : 'New category'}
      onClose={onClose}
      footer={
        <Button className="w-full" disabled={!canSave} onClick={save}>
          {editing ? 'Save' : 'Create'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex justify-center">
          <CategoryChip category={preview} selected />
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="Name"
          aria-label="Name"
          className="min-h-11 rounded-chip border border-border bg-surface-2 px-3 text-text placeholder:text-muted"
        />
        {offersBudget ? <BudgetField value={budget} currency={currency} locale={locale} onChange={setBudgetDraft} /> : null}
        <ColorPicker value={color} onChange={setColor} />
        <IconPicker value={icon} onChange={setIcon} color={CATEGORY_COLORS[color]} />
        {editing ? (
          <>
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" aria-label="Move up" disabled={index <= 0} onClick={() => move(-1)}>Up</Button>
              <Button variant="ghost" className="flex-1" aria-label="Move down" disabled={index < 0 || index >= siblings.length - 1} onClick={() => move(1)}>Down</Button>
              <Button variant={editing.archived ? 'ghost' : 'danger'} className="flex-1" onClick={toggleArchived}>
                {editing.archived ? 'Unarchive' : 'Archive'}
              </Button>
            </div>
            {/* The category's page (12 months, its entries) from the Categories tab; its Back returns here. Styled as a ghost Button. */}
            <Link
              to={`/category/${editing.id}`}
              className="inline-flex min-h-11 items-center justify-center rounded-chip bg-surface-2 px-4 text-[15px] text-text transition hover:bg-border active:scale-[0.97]"
            >
              History
            </Link>
          </>
        ) : null}
      </div>
    </Sheet>
  )
}
