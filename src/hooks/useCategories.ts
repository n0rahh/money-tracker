import { useEffect, useMemo, useState } from 'react'
import { subscribeCategories } from '../lib/firestore'
import type { Category } from '../lib/types'

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(
    () =>
      subscribeCategories(
        (c) => {
          setCategories(c)
          setLoading(false)
        },
        setError,
      ),
    [],
  )

  // Includes archived categories on purpose: old transactions still need their names.
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  return { categories, byId, loading, error }
}
