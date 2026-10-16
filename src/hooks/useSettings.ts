import { useEffect, useState } from 'react'
import { subscribeSettings } from '../lib/firestore'
import type { Settings } from '../lib/types'

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [fromCache, setFromCache] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(
    () =>
      subscribeSettings(
        (s, cached) => {
          setSettings(s)
          setFromCache(cached)
          setLoading(false)
        },
        setError,
      ),
    [],
  )

  return { settings, loading, fromCache, error }
}
