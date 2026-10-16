import { Share } from 'lucide-react'
import { isStandalone } from '../lib/platform'

export function InstallHint() {
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent)
  if (!isIos || isStandalone()) return null
  return (
    <section className="mb-4 rounded-card border border-accent/30 bg-accent/10 p-4 text-sm">
      <p className="font-semibold text-accent">Install as an app</p>
      <p className="mt-1 text-muted">
        Tap <Share size={14} className="inline align-[-2px]" /> Share in Safari, then “Add to Home Screen”. The app then opens full-screen, keeps you signed in and works offline.
      </p>
    </section>
  )
}
