import { useEffect, useState } from 'react'

/** A counter that goes up each time the app comes back to the foreground (the page turns visible, or the window regains focus). */
export function useVisibilityTick(): number {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const bump = () => setTick((t) => t + 1)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') bump()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', bump)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', bump)
    }
  }, [])

  return tick
}
