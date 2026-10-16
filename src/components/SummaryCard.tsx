import { formatMoney } from '../lib/money'
import type { KindTotals } from '../lib/stats'

type Props = { totals: KindTotals; currency: string; locale: string | null }

export function SummaryCard({ totals, currency, locale }: Props) {
  return (
    <section className="rounded-card border border-border bg-surface p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">Spent</p>
      <p className="tnum mt-1 truncate text-[40px] font-semibold leading-none">{formatMoney(totals.expense, currency, locale)}</p>
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
