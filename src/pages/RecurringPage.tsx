import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../components/Button'
import { CategoryIcon } from '../components/CategoryChip'
import { useToast } from '../context/ToastContext'
import { useCategories } from '../hooks/useCategories'
import { useRecurring } from '../hooks/useRecurring'
import { useSettings } from '../hooks/useSettings'
import { currentMonth, monthLabel } from '../lib/dates'
import { deleteRecurring, restoreRecurring, updateRecurring } from '../lib/firestore'
import { formatMoney } from '../lib/money'
import { readErrorText } from '../lib/readError'
import { isMaterialisable } from '../lib/recurring'
import type { RecurringTemplate } from '../lib/types'

/** Settings → Recurring: every template, with Stop and Delete. The entries a template has made are never touched here. */
export function RecurringPage() {
  const { templates, loading, error } = useRecurring()
  const { byId, loading: categoriesLoading, error: categoriesError } = useCategories()
  const { settings, loading: settingsLoading } = useSettings()
  const { showToast } = useToast()
  const location = useLocation()
  const navigate = useNavigate()
  const thisMonth = currentMonth()

  // The fallback only applies to a genuinely missing settings document (first run), never while it loads.
  const currency = settings?.currency ?? 'USD'
  const locale = settings?.locale ?? null
  const fail = (what: string) => (e: unknown) => showToast(e instanceof Error ? `${what}: ${readErrorText(e)}` : what)

  // Ends the template with this month: this month's entry stays, and no later month gets one.
  function stop(t: RecurringTemplate) {
    updateRecurring(t.id, { endMonth: thisMonth }).catch(fail('Could not stop'))
  }

  // No confirmation, as for entries: the toast's Undo writes the template back. Neither write is waited for.
  function remove(t: RecurringTemplate) {
    deleteRecurring(t.id).catch(fail('Could not delete'))
    if (!isMaterialisable(t)) {
      // The rules would refuse the template as it reads, so an Undo could only fail.
      showToast('Template deleted')
      return
    }
    showToast('Template deleted', {
      actionLabel: 'Undo',
      onAction: () => {
        restoreRecurring(t).catch(fail('Could not undo'))
      },
    })
  }

  const backClass = 'flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text'
  // Opened from Settings, Back returns there through history instead of stacking another Settings; opened cold from a
  // link, there is nothing in the app to return to, so it links to Settings.
  const back =
    location.key !== 'default' ? (
      <button type="button" aria-label="Back" onClick={() => navigate(-1)} className={backClass}>
        <ChevronLeft size={20} />
      </button>
    ) : (
      <Link to="/settings" aria-label="Back to Settings" className={backClass}>
        <ChevronLeft size={20} />
      </Link>
    )

  const listError = error ?? categoriesError
  let body: ReactNode
  if (loading || categoriesLoading || settingsLoading) {
    // No amounts until the currency is known, no "Uncategorized" before the categories, no empty state before the list.
    body = <p className="mt-6 text-center text-sm text-muted">Loading…</p>
  } else if (listError) {
    body = <p className="mt-4 text-center text-sm text-danger">{readErrorText(listError)}</p>
  } else if (templates.length === 0) {
    body = <p className="mt-6 text-center text-sm text-muted">Nothing repeats yet. Turn on 'Repeat every month' when adding an entry.</p>
  } else {
    body = (
      <ul className="mt-2 overflow-hidden rounded-card bg-surface">
        {templates.map((t) => {
          const category = byId.get(t.categoryId)
          const valid = isMaterialisable(t)
          // Running past this month: stopping it now changes something.
          const canStop = valid && (t.endMonth === null || t.endMonth > thisMonth)
          const schedule = `Every month on day ${t.dayOfMonth} · since ${monthLabel(t.startMonth, locale)}${
            t.endMonth === null ? '' : ` · until ${monthLabel(t.endMonth, locale)}`
          }`
          return (
            <li key={t.id} className="border-t border-border px-3 py-3 first:border-t-0">
              <div className="flex items-center gap-3">
                <CategoryIcon category={category} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px]">{category?.name ?? 'Uncategorized'}</span>
                  {t.note ? <span className="block truncate text-xs text-muted">{t.note}</span> : null}
                </span>
                <span className={`tnum text-[15px] font-medium ${t.kind === 'income' ? 'text-accent' : 'text-text'}`}>
                  {t.kind === 'income' ? '+' : ''}
                  {formatMoney(t.amount, currency, locale)}
                </span>
              </div>
              <p className="mt-1 pl-12 text-xs text-muted">{valid ? schedule : 'Invalid template'}</p>
              <div className="mt-2 flex justify-end gap-2">
                {canStop ? (
                  <Button variant="ghost" onClick={() => stop(t)}>
                    Stop
                  </Button>
                ) : null}
                <Button variant="danger" onClick={() => remove(t)}>
                  Delete
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <>
      <header className="flex items-center gap-3 py-3">
        {back}
        <h1 className="text-lg font-semibold">Recurring</h1>
      </header>
      {body}
    </>
  )
}
