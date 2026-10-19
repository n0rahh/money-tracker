import { ChevronRight } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../components/Button'
import { CurrencySheet } from '../components/CurrencySheet'
import { InstallHint } from '../components/InstallHint'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useRecurring } from '../hooks/useRecurring'
import { useSettings } from '../hooks/useSettings'
import { currentMonth } from '../lib/dates'
import { getAllBudgets, getAllCategories, getAllRecurring, getAllTransactions, saveSettings } from '../lib/firestore'
import { minorUnitDigits } from '../lib/money'
import { readErrorText } from '../lib/readError'

const DECIMALS_WARNING =
  'Switching between currencies with a different number of decimals changes how stored amounts are read (for example 12.50 becomes ¥1,250). Continue?'

// Settings is the only way in, and imports are rare: the sheet, with the CSV parser, loads on the first tap of Import CSV.
// The export code (lib/exporting) likewise loads on the first export.
const ImportSheet = lazy(() => import('../components/ImportSheet').then((m) => ({ default: m.ImportSheet })))

type ExportFormat = 'csv' | 'json'
type ExportFile = { name: string; mime: string; content: string; count: number }

const entries = (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`
const fieldOf = (e: unknown, field: 'code' | 'name') => (typeof e === 'object' && e !== null ? (e as Record<string, unknown>)[field] : undefined)
function exportErrorText(e: unknown): string {
  // Exports read from the server only (lib/firestore): offline they fail rather than export part of the data.
  if (fieldOf(e, 'code') === 'unavailable') return 'Could not export while offline'
  return e instanceof Error ? `Could not export: ${readErrorText(e)}` : 'Could not export'
}
const ROW = 'flex min-h-12 w-full items-center justify-between px-4 text-left active:bg-surface-2 disabled:active:bg-transparent'

export function SettingsPage() {
  const { user, logOut } = useAuth()
  const { settings } = useSettings()
  const { templates, loading: recurringLoading, error: recurringError } = useRecurring()
  const { showToast } = useToast()
  const [currencyOpen, setCurrencyOpen] = useState(false)
  const [exporting, setExporting] = useState<ExportFormat | null>(null)
  const [importOpen, setImportOpen] = useState(false)
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

  // Reads every entry once per tap (spec §4: one-shot reads are fine when the user asks), builds the file and hands it over.
  async function runExport(format: ExportFormat) {
    if (exporting || !settings) return
    setExporting(format)
    try {
      const { buildCsvExport, buildJsonExport, exportFileName } = await import('../lib/exporting')
      let content: string
      let count: number
      if (format === 'csv') {
        const [transactions, categories] = await Promise.all([getAllTransactions(), getAllCategories()])
        content = buildCsvExport(transactions, new Map(categories.map((c) => [c.id, c])), settings.currency)
        count = transactions.length
      } else {
        const [transactions, categories, budgets, recurring] = await Promise.all([getAllTransactions(), getAllCategories(), getAllBudgets(), getAllRecurring()])
        content = buildJsonExport({ transactions, categories, budgets, recurring, currency: settings.currency })
        count = transactions.length
      }
      await handOver({ name: exportFileName(format), mime: format === 'csv' ? 'text/csv' : 'application/json', content, count })
    } catch (e) {
      showToast(exportErrorText(e))
    } finally {
      setExporting(null)
    }
  }

  async function handOver(file: ExportFile) {
    const { shareOrDownload } = await import('../lib/exporting')
    try {
      await shareOrDownload(file.name, file.mime, file.content)
      showToast(`Exported ${entries(file.count)}`)
    } catch (e) {
      // The share sheet was dismissed: nothing to say.
      if (fieldOf(e, 'name') === 'AbortError') return
      // iOS opens the share sheet only right after a tap, and reading every entry can take longer: the file is ready,
      // and the toast's button is a fresh tap.
      if (fieldOf(e, 'name') === 'NotAllowedError') {
        showToast(`${entries(file.count)} ready to export`, {
          actionLabel: 'Share',
          durationMs: 10_000,
          onAction: () => {
            handOver(file).catch((err: unknown) => showToast(exportErrorText(err)))
          },
        })
        return
      }
      throw e
    }
  }

  const exportRow = (format: ExportFormat, label: string, first: boolean) => (
    <button
      type="button"
      disabled={!settings || exporting !== null}
      onClick={() => void runExport(format)}
      // The row that is exporting stays bright; the other one dims while it waits.
      className={`${ROW} ${first ? '' : 'border-t border-border'} ${exporting === format ? '' : 'disabled:opacity-40'}`}
    >
      <span>{label}</span>
      {exporting === format ? <span className="text-sm text-muted">Exporting…</span> : null}
    </button>
  )

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
      <h2 className="mt-6 px-1 pb-2 text-xs font-semibold uppercase tracking-wider text-muted">Data</h2>
      <section className="overflow-hidden rounded-card bg-surface">
        {exportRow('csv', 'Export CSV', true)}
        {exportRow('json', 'Export JSON', false)}
        <button type="button" disabled={!settings} onClick={() => setImportOpen(true)} className={`${ROW} border-t border-border disabled:opacity-40`}>
          <span>Import CSV</span>
        </button>
      </section>
      <p className="mt-2 px-1 text-xs text-muted">CSV opens in a spreadsheet. JSON is a full backup, with categories, budgets and recurring entries.</p>
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
      {importOpen && settings ? (
        // Nothing in its place while its code loads (precached, so a moment at most): the page stays as it is.
        <Suspense fallback={null}>
          <ImportSheet currency={settings.currency} locale={settings.locale} onClose={() => setImportOpen(false)} />
        </Suspense>
      ) : null}
    </>
  )
}
