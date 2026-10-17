import { formatMoney } from '../lib/money'
import type { Pace } from '../lib/stats'
import { DeltaBadge } from './DeltaBadge'

type Props = { pace: Pace; currency: string; locale: string | null }

/** Spec §7: "€1,240 by day 14 · last month by day 14: €1,410", then the change as a badge. */
export function PaceLine({ pace, currency, locale }: Props) {
  const { spentToDate, previousToDate, dayOfMonth, deltaPct } = pace
  const money = (minor: number) => formatMoney(minor, currency, locale)
  const lastMonth = previousToDate === 0 ? 'no data for last month' : `last month by day ${dayOfMonth}: ${money(previousToDate)}`
  return (
    <p className="tnum mt-3 text-sm text-muted">
      {`${money(spentToDate)} by day ${dayOfMonth} · ${lastMonth}`}
      {deltaPct !== null ? (
        <>
          {' '}
          <DeltaBadge deltaPct={deltaPct} previous={previousToDate} />
        </>
      ) : null}
    </p>
  )
}
