import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

type Props = {
  /** The view's rows are on screen but come from the local cache only: the server has not confirmed them yet. */
  show: boolean
  className?: string
}

/**
 * Sits in a view's heading row (spec §11): "Updating…" while online, since the server's answer is on its way; offline,
 * a warning that months this device never opened are not in its cache. Placed beside the heading rather than under it,
 * so the brief "Updating…" of a cached view never moves the page.
 */
export function CacheHint({ show, className = '' }: Props) {
  // Follows the connection as it changes: a cached view gets no new snapshot when the network drops.
  const online = useSyncExternalStore(subscribe, () => navigator.onLine)
  if (!show) return null
  return <p className={`min-w-0 text-right text-xs text-muted ${className}`}>{online ? 'Updating…' : "Offline — months you haven't opened may be missing"}</p>
}
