import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../context/ToastContext'
import { useCategories } from '../hooks/useCategories'
import {
  applyMapping,
  categoryKey,
  distinctKindValues,
  guessColumns,
  importRowIds,
  kindOfValue,
  parseCsv,
  parseDate,
  planCategories,
  slashDateOrderOf,
  type ColumnGuess,
  type ColumnMapping,
  type DateOrder,
  type ImportRow,
  type KindValue,
} from '../lib/csv'
import { currentMonth, monthOf, parseIsoDate } from '../lib/dates'
import { createCategory, importTransactions } from '../lib/firestore'
import { formatMoney, minorUnitDigits } from '../lib/money'
import { readErrorText } from '../lib/readError'
import { Button } from './Button'
import { Sheet } from './Sheet'
import { AMOUNT, CELL, HEAD } from './tableStyles'

type Props = {
  currency: string
  locale: string | null
  onClose: () => void
}

type Field = keyof ColumnGuess
const FIELDS: { field: Field; label: string; required: boolean }[] = [
  { field: 'date', label: 'Date', required: true },
  { field: 'amount', label: 'Amount', required: true },
  { field: 'kind', label: 'Kind', required: false },
  { field: 'category', label: 'Category', required: true },
  { field: 'note', label: 'Note', required: false },
]
const PREVIEW_ROWS = 5
const LISTED_ERRORS = 5
/** A column with more different values than this is no kind column: its values are not offered one by one. */
const MAX_KIND_VALUES = 8
const SELECT = 'min-h-11 min-w-0 max-w-[65%] rounded-chip border border-border bg-surface-2 px-3 text-text disabled:opacity-40'
const SECTION_LABEL = 'text-xs font-semibold uppercase tracking-wider text-muted'
const NO_COLUMNS: ColumnGuess = { date: null, amount: null, kind: null, category: null, note: null, id: null }

type Loaded = { header: string[]; rows: string[][]; garbled: boolean }

/** Option labels for the header's columns: the header text, "Column N" without one, and the position when a name repeats. */
function columnLabels(header: string[]): string[] {
  const names = header.map((h) => h.trim())
  return names.map((name, i) => {
    if (name === '') return `Column ${i + 1}`
    const repeated = names.filter((n) => n.toLowerCase() === name.toLowerCase()).length > 1
    return repeated ? `${name} (column ${i + 1})` : name
  })
}

/**
 * Settings → Import CSV: a file, then its columns matched to the entry fields (guessed from the header, so a Money
 * Manager export needs no changes), a preview, and the import itself. Missing categories are created first; the entries
 * get ids derived from their content, or the ids of this app's own export, so importing a file again overwrites instead
 * of doubling. Mounted only while open.
 */
export function ImportSheet({ currency, locale, onClose }: Props) {
  const { categories, loading: categoriesLoading, error: categoriesError } = useCategories()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const id = useId()
  const digits = minorUnitDigits(currency)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [columns, setColumns] = useState<ColumnGuess>(NO_COLUMNS)
  const [signMeansExpense, setSignMeansExpense] = useState(true)
  // Only the values whose meaning was changed by hand; the others follow kindOfValue.
  const [kindValues, setKindValues] = useState<ReadonlyMap<string, KindValue>>(new Map())
  // Only when chosen by hand; otherwise the file's own dates decide, or day first.
  const [dateOrder, setDateOrder] = useState<DateOrder | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  // The latest file chosen: a slower read of an earlier choice must not replace it.
  const reading = useRef(0)
  // False once the sheet is closed: an import still running then only toasts, it does not move the page.
  const open = useRef(true)
  useEffect(() => {
    open.current = true
    return () => {
      open.current = false
    }
  }, [])

  const mapping = useMemo<ColumnMapping | null>(() => {
    const { date, amount, kind, category, note } = columns
    if (date === null || amount === null || category === null) return null
    return { date, amount, kind, category, note, id: columns.id, signMeansExpense, kindValues, ...(dateOrder ? { dateOrder } : {}) }
  }, [columns, signMeansExpense, kindValues, dateOrder])
  const result = useMemo(() => (loaded && mapping ? applyMapping(loaded.rows, mapping, digits) : null), [loaded, mapping, digits])
  const values = useMemo(() => (loaded && columns.kind !== null ? distinctKindValues(loaded.rows, columns.kind) : []), [loaded, columns.kind])
  const slashDates = useMemo(() => {
    const column = columns.date
    return loaded && column !== null ? slashDateOrderOf(loaded.rows.map((row) => row[column] ?? '')) : null
  }, [loaded, columns.date])
  const order: DateOrder = dateOrder ?? slashDates?.proven ?? 'dmy'
  const importing = progress !== null
  const ready = result?.ok ?? []
  const canImport = ready.length > 0 && !importing && !categoriesLoading && !categoriesError

  const numbers = new Intl.NumberFormat(locale ?? undefined)
  const count = (n: number) => numbers.format(n)
  const entries = (n: number) => `${count(n)} ${n === 1 ? 'entry' : 'entries'}`

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const token = ++reading.current
    try {
      const text = await file.text()
      if (token !== reading.current) return
      const records = parseCsv(text)
      setLoaded(null)
      if (records.length < 2) {
        setNotice(records.length === 0 ? 'The file is empty.' : 'The file has a header row only.')
        return
      }
      const [header, ...rows] = records
      const guess = guessColumns(header)
      setNotice(null)
      setLoaded({ header, rows, garbled: text.includes('\uFFFD') })
      setColumns(guess)
      setSignMeansExpense(guess.kind === null)
      setKindValues(new Map())
      setDateOrder(null)
    } catch (e) {
      if (token !== reading.current) return
      setLoaded(null)
      setNotice(`Could not read the file: ${e instanceof Error ? e.message : 'unknown error'}`)
    }
  }

  function pick(field: Field, value: string) {
    setColumns((c) => ({ ...c, [field]: value === '' ? null : Number(value) }))
    if (field === 'kind') {
      // Another kind column has other values; with none, the sign is read again, as when no kind column was found.
      setKindValues(new Map())
      if (value === '') setSignMeansExpense(true)
    }
    // Another date column has other dates.
    if (field === 'date') setDateOrder(null)
  }

  function mean(key: string, meaning: KindValue) {
    setKindValues((current) => new Map(current).set(key, meaning))
  }

  async function runImport() {
    if (!canImport) return
    const rows = ready
    const total = rows.length
    let done = 0
    setProgress({ done: 0, total })
    try {
      const plan = planCategories(rows, categories)
      const ids = await importRowIds(rows)
      // From here on every write is sent and listened to at once: none can fail unheard.
      const categoryIds = new Map(plan.matched)
      const created = Promise.allSettled(
        plan.create.map(({ key, input }) => {
          const category = createCategory(input)
          categoryIds.set(key, category.id)
          return category.done
        }),
      )
      const categoryOf = (r: ImportRow) => {
        const categoryId = categoryIds.get(categoryKey(r.kind, r.categoryName))
        // planCategories gives every row's key a category, matched or created; an empty id would fail a whole batch.
        if (categoryId === undefined) throw new Error(`no category for "${r.categoryName}"`)
        return categoryId
      }
      const docs = rows.map((r, i) => ({
        id: ids[i],
        input: { kind: r.kind, amount: r.amount, categoryId: categoryOf(r), note: r.note, date: r.date, source: 'import' as const },
      }))
      let entriesError: unknown = null
      const written = await importTransactions(docs, (n) => {
        done = n
        if (open.current) setProgress({ done: n, total })
      }).catch((e: unknown) => {
        entriesError = e
        return done
      })
      const categoryFailure = (await created).find((outcome) => outcome.status === 'rejected')
      const reasonOf = (e: unknown) => (e instanceof Error ? `: ${readErrorText(e)}` : '')
      if (entriesError !== null) {
        // Every batch was sent at once, so the others may be in: say how many, and that choosing the file again is safe.
        showToast(written > 0 ? `Imported ${count(written)} of ${entries(total)}; the rest failed${reasonOf(entriesError)}` : `Could not import${reasonOf(entriesError)}`)
        if (open.current) setProgress(null)
        return
      }
      if (categoryFailure) {
        showToast(`Imported ${entries(written)}, but a new category could not be saved${reasonOf(categoryFailure.reason)}`)
        if (open.current) setProgress(null)
        return
      }
      const newCategories = plan.create.length
      showToast(`Imported ${entries(written)}${newCategories > 0 ? ` · ${count(newCategories)} new ${newCategories === 1 ? 'category' : 'categories'}` : ''}`)
      if (!open.current) return
      onClose()
      // Home on the latest month imported, where the entries are.
      const latest = monthOf(rows.reduce((max, r) => (r.date > max ? r.date : max), rows[0].date))
      navigate(latest === currentMonth() ? '/' : `/?month=${latest}`)
    } catch (e) {
      showToast(e instanceof Error ? `Could not import: ${readErrorText(e)}` : 'Could not import')
      if (open.current) setProgress(null)
    }
  }

  const dateFormat = new Intl.DateTimeFormat(locale ?? undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  const labels = loaded ? columnLabels(loaded.header) : []
  const orderExample = slashDates?.ambiguous ? parseDate(slashDates.ambiguous, order) : null
  // Rows that carry this app's own ids (its CSV export): each id once, as importRowIds keeps it.
  const ownIds = new Set(ready.flatMap((r) => (r.id === undefined ? [] : [r.id]))).size
  let status = ''
  if (progress) status = `${count(progress.done)} of ${count(progress.total)} written`
  else if (categoriesError) status = readErrorText(categoriesError)
  else if (categoriesLoading) status = 'Loading categories…'

  const footer = loaded ? (
    <>
      <Button className="w-full" disabled={!canImport} onClick={() => void runImport()}>
        {importing ? 'Importing…' : `Import ${entries(ready.length)}`}
      </Button>
      <p aria-live="polite" className={`mt-2 min-h-4 text-center text-xs ${categoriesError && !progress ? 'text-danger' : 'text-muted'}`}>
        {status}
      </p>
    </>
  ) : undefined

  return (
    <Sheet open title="Import CSV" onClose={onClose} footer={footer}>
      <p className="text-sm text-muted">
        Choose a CSV file with a header row, then match its columns. Importing the same file again replaces its entries instead of adding them twice.
      </p>
      <label className="mt-3 block">
        <span className="mb-1 block text-sm">CSV file</span>
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          disabled={importing}
          onChange={(e) => void choose(e)}
          className="block w-full text-sm text-muted file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-chip file:border-0 file:bg-surface-2 file:px-4 file:text-[15px] file:text-text"
        />
      </label>
      {notice ? <p className="mt-3 text-sm text-danger">{notice}</p> : null}
      {loaded ? (
        <>
          {loaded.garbled ? <p className="mt-3 text-sm text-danger">Some characters could not be read. Save the file as UTF-8 and choose it again.</p> : null}
          <fieldset className="mt-4" disabled={importing}>
            <legend className={SECTION_LABEL}>Columns</legend>
            {FIELDS.map(({ field, label, required }) => (
              <div key={field} className="flex min-h-12 items-center justify-between gap-3 border-t border-border first-of-type:border-t-0">
                <label htmlFor={`${id}-${field}`}>{label}</label>
                <select id={`${id}-${field}`} value={columns[field] ?? ''} onChange={(e) => pick(field, e.target.value)} className={SELECT}>
                  <option value="">{required ? 'Choose a column' : 'None'}</option>
                  {labels.map((name, i) => (
                    <option key={i} value={i}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            {slashDates?.ambiguous ? (
              <>
                <div className="flex min-h-12 items-center justify-between gap-3 border-t border-border">
                  <label htmlFor={`${id}-order`}>Slash dates</label>
                  <select id={`${id}-order`} value={order} onChange={(e) => setDateOrder(e.target.value as DateOrder)} className={SELECT}>
                    <option value="dmy">Day first (DD/MM)</option>
                    <option value="mdy">Month first (MM/DD)</option>
                  </select>
                </div>
                {orderExample ? <p className="text-xs text-muted">{`${slashDates.ambiguous} reads as ${dateFormat.format(parseIsoDate(orderExample))}.`}</p> : null}
              </>
            ) : null}
            {columns.kind === null ? (
              <>
                <label className="flex min-h-12 items-center gap-3 border-t border-border">
                  <input type="checkbox" checked={signMeansExpense} onChange={(e) => setSignMeansExpense(e.target.checked)} className="size-5 shrink-0 accent-accent" />
                  <span>Negative amounts are expenses</span>
                </label>
                <p className="text-xs text-muted">{signMeansExpense ? 'Positive amounts are imported as income.' : 'Every row is imported as an expense.'}</p>
              </>
            ) : values.length > MAX_KIND_VALUES ? (
              <p className="mt-2 text-xs text-muted">
                {`This column has ${values.length} different values, too many for a kind column. Choose the column that says income or expense, or None.`}
              </p>
            ) : (
              <div role="group" aria-label="Kind values" className="mt-4">
                <p className={SECTION_LABEL}>Kind values</p>
                {values.map((v) => (
                  <div key={v.key} className="flex min-h-12 items-center justify-between gap-3 border-t border-border first-of-type:border-t-0">
                    <span className="min-w-0 truncate">
                      <span>{v.value || '(empty)'}</span>
                      <span className="text-muted"> · {v.count}</span>
                    </span>
                    <select
                      aria-label={`Rows with ${v.value ? `"${v.value}"` : 'no kind'}`}
                      value={kindValues.get(v.key) ?? kindOfValue(v.value)}
                      onChange={(e) => mean(v.key, e.target.value as KindValue)}
                      className={SELECT}
                    >
                      <option value="expense">Expense</option>
                      <option value="income">Income</option>
                      <option value="skip">Skip</option>
                    </select>
                  </div>
                ))}
              </div>
            )}
          </fieldset>
          {result ? (
            <>
              <p className="mt-4 text-sm">{`${count(ready.length)} of ${count(ready.length + result.errors.length)} rows ready to import.`}</p>
              {ownIds > 0 ? (
                // Says "existing": true also when those entries are gone, such as a restore into an empty account.
                <p className="mt-1 text-xs text-muted">
                  {ownIds === 1
                    ? "1 row keeps this app's own id (an existing entry with that id is replaced)."
                    : `${count(ownIds)} rows keep this app's own ids (existing entries with those ids are replaced).`}
                </p>
              ) : null}
              {result.shortened.notes > 0 ? (
                <p className="mt-1 text-xs text-muted">{`${count(result.shortened.notes)} ${result.shortened.notes === 1 ? 'note is' : 'notes are'} shortened to 200 characters.`}</p>
              ) : null}
              {result.shortened.names > 0 ? (
                <p className="mt-1 text-xs text-muted">{`${count(result.shortened.names)} category ${result.shortened.names === 1 ? 'name is' : 'names are'} shortened to 40 characters.`}</p>
              ) : null}
              {ready.length > 0 ? (
                <>
                  <p className={`mt-4 ${SECTION_LABEL}`}>Preview</p>
                  <table className="mt-1 w-full text-[13px]">
                    <caption className="sr-only">The first rows as they will be imported</caption>
                    <thead>
                      <tr>
                        <th scope="col" className={`${HEAD} text-left`}>Date</th>
                        <th scope="col" className={`${HEAD} text-left`}>Category</th>
                        <th scope="col" className={`${HEAD} text-right`}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ready.slice(0, PREVIEW_ROWS).map((r, i) => (
                        <tr key={i} className="border-t border-border align-top">
                          <td className={`${CELL} whitespace-nowrap`}>{dateFormat.format(parseIsoDate(r.date))}</td>
                          <td className={`${CELL} w-full max-w-0`}>
                            <span className="block truncate">{r.categoryName}</span>
                            <span className="block truncate text-xs text-muted">{`${r.kind === 'income' ? 'Income' : 'Expense'}${r.note ? ` · ${r.note}` : ''}`}</span>
                          </td>
                          <td className={`${AMOUNT} tnum ${r.kind === 'income' ? 'text-accent' : ''}`}>
                            {`${r.kind === 'income' ? '+' : ''}${formatMoney(r.amount, currency, locale)}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : null}
              {result.errors.length > 0 ? (
                <div className="mt-4">
                  <p className="text-sm text-danger">{`${count(result.errors.length)} ${result.errors.length === 1 ? 'row' : 'rows'} can't be imported:`}</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted">
                    {result.errors.slice(0, LISTED_ERRORS).map((e) => (
                      <li key={e.line}>{`Line ${e.line}: ${e.reason}`}</li>
                    ))}
                  </ul>
                  {result.errors.length > LISTED_ERRORS ? <p className="mt-0.5 text-xs text-muted">{`…and ${count(result.errors.length - LISTED_ERRORS)} more`}</p> : null}
                </div>
              ) : null}
            </>
          ) : (
            <p className="mt-4 text-sm text-muted">Choose the date, amount and category columns.</p>
          )}
        </>
      ) : null}
    </Sheet>
  )
}
