import { useEffect, useState } from 'react'
import { subscribeTransactionsInRange } from '../lib/firestore'
import type { IsoDate, Transaction } from '../lib/types'

export function useTransactions(from: IsoDate, to: IsoDate) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  /** The visible rows include local writes the server has not acknowledged yet (offline, or still in flight). */
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    // A new range starts clean: the previous range's rows, sync state and error must not show under it.
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

  return { transactions, loading, pending, error }
}
