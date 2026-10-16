import { useRef } from 'react'
import { useToast } from '../context/ToastContext'
import { useSettings } from '../hooks/useSettings'
import { saveSettings, seedDefaultCategories } from '../lib/firestore'
import { CurrencySheet } from './CurrencySheet'

/** Shown once: no settings document on the server yet. Cached "nothing" (fromCache) does not count. */
export function FirstRunGate() {
  const { settings, loading, fromCache } = useSettings()
  const { showToast } = useToast()
  // The sheet only goes away once the settings snapshot arrives; a second tap before that must not seed twice.
  const chosen = useRef(false)
  if (loading || fromCache || settings !== null) return null
  return (
    <CurrencySheet
      open
      dismissible={false}
      current="PLN"
      title="Welcome! Pick your currency"
      note="All amounts are shown in this currency. You can change it later in Settings."
      onSelect={(code) => {
        if (chosen.current) return
        chosen.current = true
        saveSettings({ currency: code, locale: null }).catch((e: unknown) => showToast(e instanceof Error ? e.message : 'Could not save settings'))
        seedDefaultCategories()
          .then((n) => {
            if (n > 0) showToast(`Added ${n} default categories`)
          })
          .catch((e: unknown) => showToast(e instanceof Error ? e.message : 'Could not seed categories'))
      }}
    />
  )
}
