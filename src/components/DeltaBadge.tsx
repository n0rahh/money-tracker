type Props = {
  /** Whole-percent change vs. `previous` (as computed in `lib/stats`); null when there is nothing to compare with. */
  deltaPct: number | null
  /** The amount compared against, in minor units. */
  previous: number
}

const BADGE = 'tnum rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap'

/**
 * "+12 %", "−5 %" (a true minus), "0 %" or "new". More spending reads in the expense colour, less in the accent.
 * A null `deltaPct` reads "new" only when `previous` is 0; with `previous > 0` the badge renders nothing.
 * When the current and the previous amounts are both 0 there is nothing to compare: callers should render no badge.
 */
export function DeltaBadge({ deltaPct, previous }: Props) {
  if (deltaPct === null) return previous === 0 ? <span className={`${BADGE} text-muted`}>new</span> : null
  if (deltaPct > 0) return <span className={`${BADGE} text-expense`}>{`+${deltaPct} %`}</span>
  if (deltaPct < 0) return <span className={`${BADGE} text-accent`}>{`−${Math.abs(deltaPct)} %`}</span>
  return <span className={`${BADGE} text-muted`}>0 %</span>
}
