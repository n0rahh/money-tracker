import { Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../components/Button'
import { CategoryIcon } from '../components/CategoryChip'
import { CategoryEditSheet } from '../components/CategoryEditSheet'
import { SegmentedControl } from '../components/SegmentedControl'
import { useBudgets } from '../hooks/useBudgets'
import { useCategories } from '../hooks/useCategories'
import { useSettings } from '../hooks/useSettings'
import type { Category, Kind } from '../lib/types'

type SheetState = { open: boolean; editing: Category | null; nonce: number }

export function CategoriesPage() {
  const { categories, loading } = useCategories()
  const { budgets } = useBudgets()
  const { settings } = useSettings()
  const [kind, setKind] = useState<Kind>('expense')
  const [sheet, setSheet] = useState<SheetState>({ open: false, editing: null, nonce: 0 })

  const active = categories.filter((c) => c.kind === kind && !c.archived).sort((a, b) => a.order - b.order)
  const archived = categories.filter((c) => c.kind === kind && c.archived)
  // Archived ones count too, so a new or unarchived category never shares an order (a swap of equal orders does nothing).
  const nextOrder = categories.reduce((max, c) => (c.kind === kind ? Math.max(max, c.order) : max), -1) + 1
  const open = (editing: Category | null) => setSheet((s) => ({ open: true, editing, nonce: s.nonce + 1 }))
  const close = () => setSheet((s) => ({ ...s, open: false }))

  const row = (c: Category) => (
    <li key={c.id}>
      <button type="button" onClick={() => open(c)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-surface-2">
        <CategoryIcon category={c} />
        <span className="flex-1 truncate text-[15px]">{c.name}</span>
      </button>
    </li>
  )

  return (
    <>
      <div className="flex items-center justify-between py-3">
        <h1 className="text-lg font-semibold">Categories</h1>
        {/* Disabled until the first snapshot: nextOrder computed from an empty list would reuse order 0. */}
        <Button variant="ghost" disabled={loading} onClick={() => open(null)}>
          <Plus size={18} /> New
        </Button>
      </div>
      <SegmentedControl ariaLabel="Kind" value={kind} onChange={setKind} options={[{ value: 'expense', label: 'Expenses' }, { value: 'income', label: 'Income' }]} />
      {loading ? <p className="mt-6 text-center text-sm text-muted">Loading…</p> : null}
      <ul className="mt-4 overflow-hidden rounded-card bg-surface">{active.map(row)}</ul>
      {archived.length > 0 ? (
        <details className="mt-4">
          <summary className="flex min-h-11 cursor-pointer items-center px-1 text-xs font-semibold uppercase tracking-wider text-muted">Archived ({archived.length})</summary>
          <ul className="mt-2 overflow-hidden rounded-card bg-surface opacity-70">{archived.map(row)}</ul>
        </details>
      ) : null}
      <CategoryEditSheet
        key={`${sheet.editing?.id ?? 'new'}-${sheet.nonce}`}
        open={sheet.open}
        kind={kind}
        editing={sheet.editing}
        siblings={active}
        nextOrder={nextOrder}
        budget={sheet.editing ? (budgets.get(sheet.editing.id) ?? null) : null}
        // The fallback only applies to a genuinely missing settings document (first run), as on every page.
        currency={settings?.currency ?? 'USD'}
        locale={settings?.locale ?? null}
        onClose={close}
      />
    </>
  )
}
