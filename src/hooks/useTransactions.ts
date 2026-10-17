import { useEffect, useState } from 'react'
import { subscribeTransactionsInRange } from '../lib/firestore'
import type { IsoDate, Transaction } from '../lib/types'

/** The rows of a range not reset for yet. One shared array, frozen so that no caller can mutate it. */
const NO_ROWS = Object.freeze<Transaction[]>([]) as Transaction[]

export function useTransactions(from: IsoDate, to: IsoDate) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  /** The visible rows include local writes the server has not acknowledged yet (offline, or still in flight). */
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  /** The range the state above was last reset for: in the render where `from`/`to` change it is still the previous one. */
  const [resetFor, setResetFor] = useState({ from, to })

  useEffect(() => {
    // A new range starts clean: the previous range's rows, sync state and error must not show under it.
    setResetFor({ from, to })
    setTransactions([])
    setPending(false)
    setError(null)
    setLoading(true)
    return subscribeTransactionsInRange(
      from,
      to,
      (t, hasPendingWrites) => {
        setTransactions(t)
        setPending(hasPendingWrites)
        setLoading(false)
      },
      (e) => {
        // The listener is gone after an error, so nothing would ever clear the flag.
        setPending(false)
        setError(e)
        setLoading(false)
      },
    )
  }, [from, to])

  // Until that reset has run the state belongs to the previous range: not a single render may show it under the new one.
  if (resetFor.from !== from || resetFor.to !== to) return { transactions: NO_ROWS, loading: true, pending: false, error: null }
  return { transactions, loading, pending, error }
}
