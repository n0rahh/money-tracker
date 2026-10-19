import { useEffect, useState } from 'react'
import { subscribeBudgets } from '../lib/firestore'

export function useBudgets() {
  /** The monthly limit by category id; a category without an entry has no budget. */
  const [budgets, setBudgets] = useState<Map<string, number>>(() => new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(
    () =>
      subscribeBudgets(
        (b) => {
          setBudgets(b)
          setLoading(false)
        },
        (e) => {
          setError(e)
          setLoading(false)
        },
      ),
    [],
  )

  return { budgets, loading, error }
}
