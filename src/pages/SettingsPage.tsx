import { useState } from 'react'
import { Button } from '../components/Button'
import { CurrencySheet } from '../components/CurrencySheet'
import { InstallHint } from '../components/InstallHint'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useSettings } from '../hooks/useSettings'
import { saveSettings } from '../lib/firestore'

export function SettingsPage() {
  const { user, logOut } = useAuth()
  const { settings } = useSettings()
  const { showToast } = useToast()
  const [currencyOpen, setCurrencyOpen] = useState(false)

  return (
    <>
      <h1 className="py-3 text-lg font-semibold">Settings</h1>
      <InstallHint />
      <section className="overflow-hidden rounded-card bg-surface">
        <button type="button" onClick={() => setCurrencyOpen(true)} className="flex min-h-12 w-full items-center justify-between px-4 text-left active:bg-surface-2">
          <span>Currency</span>
          <span className="tnum text-muted">{settings?.currency ?? '—'}</span>
        </button>
        <div className="flex min-h-12 items-center justify-between border-t border-border px-4">
          <span>Signed in as</span>
          <span className="truncate pl-4 text-sm text-muted">{user?.email}</span>
        </div>
      </section>
      <Button variant="ghost" className="mt-4 w-full" onClick={() => void logOut()}>
        Sign out
      </Button>
      <p className="mt-6 text-center text-xs text-muted">Money Tracker v{__APP_VERSION__}</p>
      <CurrencySheet
        open={currencyOpen}
        current={settings?.currency ?? null}
        title="Currency"
        note="Changing the currency only changes the symbol and formatting. Existing amounts are not converted."
        onClose={() => setCurrencyOpen(false)}
        onSelect={(code) => {
          saveSettings({ currency: code, locale: settings?.locale ?? null }).catch((e: unknown) => showToast(e instanceof Error ? e.message : 'Could not save'))
          setCurrencyOpen(false)
        }}
      />
    </>
  )
}
