import { formatMoney } from '../lib/money'
import type { KindTotals } from '../lib/stats'

type Props = {
  totals: KindTotals
  currency: string
  locale: string | null
  /** The month holds writes the server has not acknowledged yet (offline, or still in flight). */
  syncing?: boolean
  /** "Budgets: <spent> of <limit>" for the budgeted categories, muted under the hero; none without a budget. */
  budgetLine?: string
}

export function SummaryCard({ totals, currency, locale, syncing = false, budgetLine }: Props) {
  return (
    <section className="relative rounded-card border border-border bg-surface p-5">
      {/* Spec §11. Positioned, so it moves nothing, and next to the totals it qualifies. */}
      {syncing ? (
        <span role="status" className="absolute right-4 top-4 inline-flex min-h-7 items-center rounded-full bg-surface-2 px-3 text-xs text-muted">Syncing…</span>
      ) : null}
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">Spent</p>
      <p className="tnum mt-1 truncate text-[40px] font-semibold leading-none">{formatMoney(totals.expense, currency, locale)}</p>
      {budgetLine ? <p className="tnum mt-2 text-sm text-muted">{budgetLine}</p> : null}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Income</p>
          <p className="tnum mt-0.5 text-lg font-medium text-accent">{formatMoney(totals.income, currency, locale)}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Net</p>
          <p className={`tnum mt-0.5 text-lg font-medium ${totals.net < 0 ? 'text-expense' : 'text-text'}`}>{formatMoney(totals.net, currency, locale, { signed: true })}</p>
        </div>
      </div>
    </section>
  )
}
