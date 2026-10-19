import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { CurrencySheet } from '../components/CurrencySheet'
import { InstallHint } from '../components/InstallHint'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useRecurring } from '../hooks/useRecurring'
import { useSettings } from '../hooks/useSettings'
import { currentMonth } from '../lib/dates'
import { saveSettings } from '../lib/firestore'
import { minorUnitDigits } from '../lib/money'

const DECIMALS_WARNING =
  'Switching between currencies with a different number of decimals changes how stored amounts are read (for example 12.50 becomes ¥1,250). Continue?'

export function SettingsPage() {
  const { user, logOut } = useAuth()
  const { settings } = useSettings()
  const { templates, loading: recurringLoading, error: recurringError } = useRecurring()
  const { showToast } = useToast()
  const [currencyOpen, setCurrencyOpen] = useState(false)
  const thisMonth = currentMonth()
  // Templates that still run: no end, or an end this month or later.
  const running = templates.filter((t) => t.endMonth === null || t.endMonth >= thisMonth).length

  function chooseCurrency(code: string) {
    const current = settings?.currency
    // Amounts are stored in minor units of whatever currency is set, so a different scale re-reads every stored amount.
    if (current && minorUnitDigits(current) !== minorUnitDigits(code) && !window.confirm(DECIMALS_WARNING)) return
    saveSettings({ currency: code, locale: settings?.locale ?? null }).catch((e: unknown) => showToast(e instanceof Error ? e.message : 'Could not save'))
    setCurrencyOpen(false)
  }

  return (
    <>
      <h1 className="py-3 text-lg font-semibold">Settings</h1>
      <InstallHint />
      <section className="overflow-hidden rounded-card bg-surface">
        <button type="button" onClick={() => setCurrencyOpen(true)} className="flex min-h-12 w-full items-center justify-between px-4 text-left active:bg-surface-2">
          <span>Currency</span>
          <span className="tnum text-muted">{settings?.currency ?? '—'}</span>
        </button>
        <Link to="/recurring" className="flex min-h-12 w-full items-center justify-between border-t border-border px-4 active:bg-surface-2">
          <span>Recurring</span>
          <span className="flex items-center gap-1 text-muted">
            <span className="tnum">{recurringLoading || recurringError ? '—' : running}</span>
            <ChevronRight size={18} aria-hidden />
          </span>
        </Link>
        <div className="flex min-h-12 items-center justify-between border-t border-border px-4">
          <span className="shrink-0">Signed in as</span>
          <span className="truncate pl-4 text-xs text-muted">{user?.email}</span>
        </div>
      </section>
      <Button variant="ghost" className="mt-4 w-full" onClick={() => logOut().catch((e: unknown) => showToast(e instanceof Error ? e.message : 'Could not sign out'))}>
        Sign out
      </Button>
      <p className="mt-6 text-center text-xs text-muted">Money Tracker v{__APP_VERSION__}</p>
      {/* Mounted only while open, so every visit starts with an empty search. */}
      {currencyOpen ? (
        <CurrencySheet
          open
          current={settings?.currency ?? null}
          title="Currency"
          note="Changing the currency changes the symbol and formatting. Amounts are not converted."
          onClose={() => setCurrencyOpen(false)}
          onSelect={chooseCurrency}
        />
      ) : null}
    </>
  )
}
