import { useEffect, useState } from 'react'
import { subscribeRecurring } from '../lib/firestore'
import type { RecurringTemplate } from '../lib/types'

export function useRecurring() {
  const [templates, setTemplates] = useState<RecurringTemplate[]>([])
  const [loading, setLoading] = useState(true)
  // True until the server has confirmed the list: the materialiser writes nothing from a list it may not know in full.
  const [fromCache, setFromCache] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(
    () =>
      subscribeRecurring(
        (t, cached) => {
          setTemplates(t)
          setFromCache(cached)
          setLoading(false)
        },
        (e) => {
          setError(e)
          setLoading(false)
        },
      ),
    [],
  )

  return { templates, loading, fromCache, error }
}
