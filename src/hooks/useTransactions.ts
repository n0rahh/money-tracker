import { useEffect, useState } from 'react'
import { subscribeTransactionsInRange } from '../lib/firestore'
import type { IsoDate, Transaction } from '../lib/types'

export function useTransactions(from: IsoDate, to: IsoDate) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    setLoading(true)
    return subscribeTransactionsInRange(
      from,
      to,
      (t) => {
        setTransactions(t)
        setLoading(false)
      },
      (e) => {
        setError(e)
        setLoading(false)
      },
    )
  }, [from, to])

  return { transactions, loading, error }
}
