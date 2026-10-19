import { useEffect, useRef } from 'react'
import { useToast } from '../context/ToastContext'
import { currentMonth } from '../lib/dates'
import { materialiseRecurring } from '../lib/firestore'
import { readErrorText } from '../lib/readError'
import { isMaterialisable, monthsToMaterialise } from '../lib/recurring'
import { useRecurring } from './useRecurring'
import { useVisibilityTick } from './useVisibilityTick'

/**
 * Turns the months each template still owes into ordinary entries (spec §9): at launch, whenever the template list
 * changes, and on each return to the foreground, which catches a month that has turned meanwhile. Mounted once, in the
 * app shell. Writes go out only from a list the server has confirmed: an offline launch materialises nothing, and the
 * next confirmed snapshot catches up.
 */
export function useRecurringMaterialiser(): void {
  const { templates, loading, fromCache, error } = useRecurring()
  const { showToast } = useToast()
  // Re-renders on each return to the foreground, so the month below is read afresh then.
  useVisibilityTick()
  const month = currentMonth()
  // Work already issued in this session, by template and last month: the same batch is not sent again while its
  // lastAppliedMonth is on its way to the snapshot, nor after it failed (that waits for the next launch, not every tick).
  const issued = useRef(new Set<string>())

  useEffect(() => {
    if (loading || error || fromCache) return
    for (const t of templates) {
      if (!isMaterialisable(t)) continue
      const months = monthsToMaterialise(t, month)
      const last = months.at(-1)
      if (last === undefined) continue
      const key = `${t.id}|${last}`
      if (issued.current.has(key)) continue
      issued.current.add(key)
      // Never awaited: the local cache applies the batch at once, and its snapshot moves lastAppliedMonth on.
      materialiseRecurring(t, months).catch((e: unknown) =>
        showToast(e instanceof Error ? `Could not add the repeating entries: ${readErrorText(e)}` : 'Could not add the repeating entries'),
      )
    }
  }, [templates, loading, fromCache, error, month, showToast])
}
