import { useEffect, useState } from 'react'
import { subscribeRecurring } from '../lib/firestore'
import type { RecurringTemplate } from '../lib/types'

export function useRecurring() {
  const [templates, setTemplates] = useState<RecurringTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(
    () =>
      subscribeRecurring(
        (t) => {
          setTemplates(t)
          setLoading(false)
        },
        (e) => {
          setError(e)
          setLoading(false)
        },
      ),
    [],
  )

  return { templates, loading, error }
}
