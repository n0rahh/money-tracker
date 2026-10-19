import { CURRENCIES } from './currencies'
import { daysInMonth } from './dates'
import { parseMinor } from './money'
import type { Category, CategoryInput, IsoDate, Kind } from './types'

// ---- CSV text (RFC 4180) ----

/**
 * CSV text to records of fields (RFC 4180). Fields are separated by commas, or by semicolons when the header line has
 * more of them outside quotes (Excel in a European locale writes those); records end with CRLF, LF or a lone CR. A quoted
 * field may hold separators and line breaks, with `""` for a quote. A leading BOM is dropped, and so is the line end
 * after the last record: a blank line elsewhere is a record with one empty field. Lenient where hand-edited files are
 * not strict: a quote inside an unquoted field is kept, text after a closing quote is appended, and an unclosed quote
 * runs to the end of the text.
 */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith('\uFEFF') ? text.slice(1) : text
  const separator = separatorOf(src)
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  // Whether anything of the current record has been read: the line end after the last record starts none.
  let started = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c !== '"') field += c
      else if (src[i + 1] === '"') {
        field += '"'
        i++
      } else quoted = false
      continue
    }
    started = true
    if (c === '"' && field === '') quoted = true
    else if (c === separator) {
      record.push(field)
      field = ''
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && src[i + 1] === '\n') i++
      record.push(field)
      records.push(record)
      record = []
      field = ''
      started = false
    } else field += c
  }
  if (started) {
    record.push(field)
    records.push(record)
  }
  return records
}

/** `;` when the first line has more semicolons than commas outside quotes, `,` otherwise. */
function separatorOf(text: string): ',' | ';' {
  let commas = 0
  let semicolons = 0
  let quoted = false
  for (const c of text) {
    if (c === '"') quoted = !quoted
    else if (!quoted && (c === '\n' || c === '\r')) break
    else if (!quoted && c === ',') commas++
    else if (!quoted && c === ';') semicolons++
  }
  return semicolons > commas ? ';' : ','
}

/**
 * Records to CSV text: a BOM first (so Excel reads it as UTF-8), CRLF after every record, and a field in quotes, its own
 * quotes doubled, when it holds a comma, a semicolon, a quote, a line break or a space at either end. Semicolons are
 * quoted although the separator is a comma: parseCsv reads `;` as the separator when the first line has more of them
 * outside quotes, so quoting them keeps every file this writes readable back as written. `scripts/mmbak-dump.mjs` has a
 * copy of these lines, which a test keeps identical.
 */
export function toCsv(rows: string[][]): string {
  return `\uFEFF${rows.map((row) => `${row.map(csvField).join(',')}\r\n`).join('')}`
}

function csvField(value: string): string {
  return /[",;\r\n]|^\s|\s$/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

// ---- guessing the columns from the header ----

/**
 * For each field, the column it is read from (an index into the header row), or null for none. `id` is the column of
 * this app's own entry ids, which its CSV export writes first; no control in the sheet shows it.
 */
export type ColumnGuess = { date: number | null; amount: number | null; kind: number | null; category: number | null; note: number | null; id: number | null }

/** What a value of the kind column means: either kind, or a row that is not imported. */
export type KindValue = Kind | 'skip'

export type ColumnMapping = {
  date: number
  amount: number
  kind: number | null
  category: number
  note: number | null
  /** The column of this app's own entry ids (its CSV export has one): a row that carries one keeps it as its document id. */
  id?: number | null
  /** How a slash date such as 03/04/2026 reads. When unset, as the file's own dates prove, else day first (slashDateOrderOf). */
  dateOrder?: DateOrder
  /** Without a kind column: negative amounts are expenses and positive ones income; when false every row is an expense. */
  signMeansExpense: boolean
  /** What some values of the kind column mean, by their trimmed lower-case text; any other value follows `kindOfValue`. */
  kindValues?: ReadonlyMap<string, KindValue>
}

/** Header names per field, in order of preference, compared trimmed, in lower case, with single spaces and no spaces around "/". */
const HEADERS: Record<Exclude<keyof ColumnGuess, 'amount'>, string[]> = {
  date: ['date', 'data', 'datum', 'period', 'transaction date', 'booking date'],
  kind: ['kind', 'type', 'income/expense', 'expense/income', 'inout', 'in/out', 'transaction type', 'typ'],
  category: ['category', 'categorie', 'kategoria', 'category name', 'categories'],
  note: ['note', 'notes', 'description', 'memo', 'title', 'comment', 'opis', 'notatka'],
  id: ['id'],
}
const AMOUNT_HEADERS = ['amount', 'sum', 'value', 'kwota']
/** "Amount (PLN)", "amount [eur]", "Amount USD". */
const AMOUNT_IN_CURRENCY = /^amount ?[([]? ?[a-z]{3} ?[)\]]?$/

let currencyCodes: Set<string> | undefined
/** Every ISO 4217 code the browser knows, in lower case; the app's own list where it knows none. */
function isCurrencyCode(name: string): boolean {
  if (!currencyCodes) {
    let codes: string[] = CURRENCIES.map((c) => c.code)
    try {
      codes = Intl.supportedValuesOf('currency')
    } catch {
      // An older engine without Intl.supportedValuesOf: the app's list stays.
    }
    currencyCodes = new Set(codes.map((c) => c.toLowerCase()))
  }
  return /^[a-z]{3}$/.test(name) && currencyCodes.has(name)
}

const normalHeader = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ').replace(/ ?\/ ?/g, '/')

/**
 * The columns a header row names, ignoring case and spacing. Each field takes the first column matching its most
 * preferred name; a column serves one field only. The amount prefers a column literally named "Amount" (or sum, value),
 * then "Amount (XXX)", then a column named after a currency code: a Money Manager export has both "PLN" and "Amount".
 */
export function guessColumns(header: string[]): ColumnGuess {
  const names = header.map(normalHeader)
  const taken = new Set<number>()
  const find = (match: (name: string) => boolean): number | null => {
    const i = names.findIndex((name, index) => !taken.has(index) && match(name))
    if (i === -1) return null
    taken.add(i)
    return i
  }
  const byName = (synonyms: string[]) => {
    for (const synonym of synonyms) {
      const i = find((name) => name === synonym)
      if (i !== null) return i
    }
    return null
  }
  const date = byName(HEADERS.date)
  const amount = byName(AMOUNT_HEADERS) ?? find((name) => AMOUNT_IN_CURRENCY.test(name)) ?? find(isCurrencyCode)
  const kind = byName(HEADERS.kind)
  const category = byName(HEADERS.category)
  const note = byName(HEADERS.note)
  const id = byName(HEADERS.id)
  return { date, amount, kind, category, note, id }
}

/** The whole mapping of a header row, or null when it names no date, amount or category column. */
export function guessMapping(header: string[]): ColumnMapping | null {
  const { date, amount, kind, category, note, id } = guessColumns(header)
  if (date === null || amount === null || category === null) return null
  return { date, amount, kind, category, note, id, signMeansExpense: kind === null }
}

// ---- reading the cells ----

const INCOME_VALUES = new Set(['income', 'in', 'earning', 'earnings', 'revenue'])

/** What a value of the kind column means unless the mapping says otherwise: income words, a transfer (skipped), or an expense. */
export function kindOfValue(value: string): KindValue {
  const key = value.trim().toLowerCase()
  if (INCOME_VALUES.has(key)) return 'income'
  // A transfer between two accounts is neither: the app has no accounts.
  if (key.includes('transfer')) return 'skip'
  return 'expense'
}

const isBlank = (row: string[]) => row.every((cell) => cell.trim() === '')

/** The values of a column, each once (by its trimmed lower-case text, as first written) with its count; blank rows left out. */
export function distinctKindValues(rows: string[][], column: number): { key: string; value: string; count: number }[] {
  const seen = new Map<string, { key: string; value: string; count: number }>()
  for (const row of rows) {
    if (isBlank(row)) continue
    const value = (row[column] ?? '').trim()
    const key = value.toLowerCase()
    const entry = seen.get(key)
    if (entry) entry.count++
    else seen.set(key, { key, value, count: 1 })
  }
  return [...seen.values()]
}

/** A cell quoted for a reason, cut to 40 characters. */
const quote = (text: string) => `"${text.length > 40 ? `${text.slice(0, 40)}…` : text}"`
const pad = (n: number) => String(n).padStart(2, '0')

/** Whether `2/3/2026` is the 2nd of March (day first) or the 3rd of February (month first). */
export type DateOrder = 'dmy' | 'mdy'
/** A time after the date ("13:22", "T13:22:05.123Z", " 9:05 PM"), ignored. */
const TIME = /(?:\s+|T)\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:\s*[ap]m)?(?:z|[+-]\d{2}:?\d{2})?$/i
const SLASH_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/

/**
 * A date cell to `YYYY-MM-DD`, or null. Reads `YYYY-MM-DD` (also with `/` or `.`), `DD.MM.YYYY` and `DD-MM-YYYY`, and
 * `DD/MM/YYYY` or `MM/DD/YYYY` as `order` says; one-digit days and months too, and a time after the date is ignored.
 * The day must exist in its month.
 */
export function parseDate(text: string, order: DateOrder): IsoDate | null {
  const s = text.trim().replace(TIME, '')
  let parts: [string, string, string] | null = null // year, month, day
  let m: RegExpExecArray | null
  if ((m = /^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})$/.exec(s))) parts = [m[1], m[3], m[4]]
  else if ((m = /^(\d{1,2})([.-])(\d{1,2})\2(\d{4})$/.exec(s))) parts = [m[4], m[3], m[1]]
  else if ((m = SLASH_DATE.exec(s))) parts = order === 'mdy' ? [m[3], m[1], m[2]] : [m[3], m[2], m[1]]
  if (!parts) return null
  const [, month, day] = parts.map(Number)
  if (month < 1 || month > 12) return null
  const iso = `${parts[0]}-${pad(month)}`
  if (day < 1 || day > daysInMonth(iso)) return null
  return `${iso}-${pad(day)}`
}

/**
 * What the slash dates of a column say about their order, which is one for the whole file, so 03/04 is not read one way
 * in one row and the other way in the next. `proven`: month first when some date cannot be read day first (its second
 * number is above 12) and none needs day first, day first the other way round, null when no date proves either or both
 * appear. `ambiguous`: the first date that reads differently day first and month first (03/04/2026, not 05/05/2026), so
 * the sheet can ask, or null.
 */
export function slashDateOrderOf(cells: string[]): { proven: DateOrder | null; ambiguous: string | null } {
  let dayFirst = false
  let monthFirst = false
  let ambiguous: string | null = null
  for (const cell of cells) {
    const text = cell.trim().replace(TIME, '')
    const m = SLASH_DATE.exec(text)
    if (!m) continue
    const first = Number(m[1])
    const second = Number(m[2])
    if (first > 12) dayFirst = true
    if (second > 12) monthFirst = true
    if (ambiguous === null && first !== second && first >= 1 && second >= 1 && first <= 12 && second <= 12) ambiguous = text
  }
  return { proven: dayFirst === monthFirst ? null : dayFirst ? 'dmy' : 'mdy', ambiguous }
}

type Separator = '.' | ','
export type AmountResult = { ok: true; minor: number; negative: boolean } | { ok: false; reason: string }
/** The rules' cap on an amount in minor units (exclusive). */
const MAX_AMOUNT = 100_000_000_000

const countOf = (s: string, c: string) => s.split(c).length - 1
/** Leading and trailing characters that are not part of a number: a currency symbol or code. */
const stripSymbols = (s: string) => s.replace(/^[^\d.,()+\-\u2212]+|[^\d.,()+\-\u2212]+$/g, '')

/** One separator with exactly three digits after it and one to three before ("1,234"): thousands in a currency without three decimals. */
function looksLikeThousands(s: string, separator: Separator, digits: number): boolean {
  const [before, after] = s.split(separator)
  return digits !== 3 && after.length === 3 && /^[1-9]\d{0,2}$/.test(before)
}

/** Digits grouped by `separator` in threes after a first group of one to three ("1,234,567"), or no separator at all. */
function validGrouping(int: string, separator: Separator): boolean {
  if (!int.includes(separator)) return true
  const [first, ...groups] = int.split(separator)
  return /^[1-9]\d{0,2}$/.test(first) && groups.every((g) => /^\d{3}$/.test(g))
}

/** Digits and separators to `1234.56`, `1234` or null; `decimal` is the column's decimal separator when it is known. */
function normalizeNumber(s: string, digits: number, decimal?: Separator): string | null {
  const dots = countOf(s, '.')
  const commas = countOf(s, ',')
  let point: Separator | null = null
  if (dots && commas) point = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ','
  else if (dots || commas) {
    const separator: Separator = dots ? '.' : ','
    if (decimal) point = decimal === separator ? separator : null
    else point = dots + commas > 1 || looksLikeThousands(s, separator, digits) ? null : separator
  }
  const thousands: Separator = point === '.' ? ',' : point === ',' ? '.' : dots ? '.' : ','
  const [int, frac, ...rest] = point ? s.split(point) : [s]
  if (rest.length > 0 || !validGrouping(int, thousands)) return null
  const whole = int.replaceAll(thousands, '')
  return frac === undefined ? whole : `${whole}.${frac}`
}

/**
 * An amount cell to whole minor units of a currency with `digits` decimals. Accepts `1 234,56`, `1,234.56`, `1.234,56`,
 * `1'234.56`, a currency symbol or code around the number, and a sign: `-12.50`, `12,50` after a Unicode minus (U+2212), `12.50-` and `(12.50)` are
 * negative. A lone separator before exactly three digits ("1,234") is a thousands separator, unless `decimal` (the
 * column's decimal separator, from its other amounts) says it is the decimal one. Trailing zeros past the currency's
 * decimals are dropped; any other extra decimal is refused rather than rounded.
 */
export function parseAmount(text: string, digits: number, decimal?: Separator): AmountResult {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: false, reason: 'No amount' }
  const unreadable: AmountResult = { ok: false, reason: `Unreadable amount ${quote(trimmed)}` }
  let negative = false
  // Spaces of any width and apostrophes group thousands ("1 234,56", "1'234.56").
  let s = stripSymbols(trimmed.replace(/[\s'\u2019]/g, ''))
  const parens = /^\((.*)\)$/.exec(s)
  if (parens) {
    negative = true
    s = stripSymbols(parens[1])
  }
  if (/^[-\u2212+]/.test(s)) {
    if (s[0] !== '+') negative = true
    s = stripSymbols(s.slice(1))
  } else if (/[-\u2212]$/.test(s)) {
    negative = true
    s = stripSymbols(s.slice(0, -1))
  }
  if (!/^[\d.,]*\d[\d.,]*$/.test(s)) return unreadable
  const normalized = normalizeNumber(s, digits, decimal)
  if (normalized === null) return unreadable
  const [int, rawFrac = ''] = normalized.split('.')
  const frac = rawFrac.length > digits ? rawFrac.replace(/0+$/, '') : rawFrac
  if (frac.length > digits) {
    return { ok: false, reason: digits === 0 ? `Amount ${quote(trimmed)} has decimals` : `Amount ${quote(trimmed)} has more than ${digits} decimals` }
  }
  const minor = parseMinor(frac ? `${int}.${frac}` : int, digits)
  if (minor === null || minor >= MAX_AMOUNT) return { ok: false, reason: `Amount ${quote(trimmed)} is too large` }
  return { ok: true, minor, negative }
}

/** The decimal separator a column's amounts agree on: from those that show one ("12.50", "1.234,56"), none when they disagree. */
function decimalSeparatorOf(cells: string[]): Separator | undefined {
  let dot = false
  let comma = false
  for (const cell of cells) {
    const s = cell.replace(/[^\d.,]/g, '')
    const lastDot = s.lastIndexOf('.')
    const lastComma = s.lastIndexOf(',')
    if (lastDot >= 0 && lastComma >= 0) {
      if (lastDot > lastComma) dot = true
      else comma = true
      continue
    }
    const separator = lastDot >= 0 ? '.' : lastComma >= 0 ? ',' : null
    // Two of a kind group thousands, and exactly three digits after one could be either.
    if (!separator || countOf(s, separator) > 1 || s.length - s.indexOf(separator) - 1 === 3) continue
    if (separator === '.') dot = true
    else comma = true
  }
  if (dot === comma) return undefined
  return dot ? '.' : ','
}

/** Cut to at most `max` UTF-16 code units, as the app's inputs count, without leaving half of a character behind. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut
}

/** Rules and inputs allow 40 characters for a category name and 200 for a note. */
const NAME_MAX = 40
const NOTE_MAX = 200
/** The category of a row without one: the default categories have an "Other" of each kind. */
const NO_CATEGORY = 'Other'

// ---- rows to import ----

export type ImportRow = {
  kind: Kind
  amount: number
  categoryName: string
  date: IsoDate
  note: string
  /** This app's own id for the entry, from the id column of its CSV export; absent for any other row. */
  id?: string
}
export type RowError = { line: number; reason: string }
/** What applyMapping read: the rows to import, the rows it cannot import, and how many notes and names it had to cut. */
export type MappedRows = { ok: ImportRow[]; errors: RowError[]; shortened: { notes: number; names: number } }

/**
 * The ids this app writes: a Firestore auto-id (the Add sheet, the Shortcut), an import id, and a recurring entry's id.
 * Nothing else is taken from a file's id column: another app's ids (1, 2, 3...) would overwrite the entries of an earlier
 * import, and Firestore refuses `.`, `..` and `__x__` as ids, which would fail a whole batch of 400.
 */
const OWN_ID = /^(?:[A-Za-z0-9]{20}|imp_[0-9a-f]{24}|rec_[A-Za-z0-9]{1,50}_\d{4}-(?:0[1-9]|1[0-2]))$/

/** The cell as this app's own entry id, or undefined when it is not one of the shapes the app writes. */
export function ownId(text: string): string | undefined {
  const id = text.trim()
  return OWN_ID.test(id) ? id : undefined
}

/**
 * The data rows of a file (header left out) read through a mapping into rows to import, or into errors with their line
 * as a spreadsheet numbers it (the header is line 1). Blank rows are skipped without a word. A row fails on a missing or
 * unreadable date, a missing, unreadable, zero or oversized amount, or a kind the mapping skips. The kind comes from the
 * kind column, else from the sign when `signMeansExpense`, else every row is an expense; the amount is stored without its
 * sign. Category names and notes are trimmed and cut to what the app stores (`shortened` counts the cuts, so the sheet
 * can say so), line breaks in a note become spaces (the note field holds one line), and a row without a category goes to
 * "Other". A row whose id cell holds one of this app's own ids carries it.
 */
export function applyMapping(rows: string[][], mapping: ColumnMapping, digits: number): MappedRows {
  const cell = (row: string[], column: number | null) => (column === null ? '' : (row[column] ?? '').trim())
  const data = rows.map((row, i) => ({ row, line: i + 2 })).filter(({ row }) => !isBlank(row))
  const order = mapping.dateOrder ?? slashDateOrderOf(data.map(({ row }) => cell(row, mapping.date))).proven ?? 'dmy'
  const decimal = decimalSeparatorOf(data.map(({ row }) => cell(row, mapping.amount)))
  const ok: ImportRow[] = []
  const errors: RowError[] = []
  const shortened = { notes: 0, names: 0 }
  for (const { row, line } of data) {
    const dateText = cell(row, mapping.date)
    const date = parseDate(dateText, order)
    if (date === null) {
      errors.push({ line, reason: dateText === '' ? 'No date' : `Unreadable date ${quote(dateText)}` })
      continue
    }
    const amount = parseAmount(cell(row, mapping.amount), digits, decimal)
    if (!amount.ok) {
      errors.push({ line, reason: amount.reason })
      continue
    }
    if (amount.minor === 0) {
      errors.push({ line, reason: 'Amount is zero' })
      continue
    }
    let kind: Kind
    if (mapping.kind !== null) {
      const value = cell(row, mapping.kind)
      const meaning = mapping.kindValues?.get(value.toLowerCase()) ?? kindOfValue(value)
      if (meaning === 'skip') {
        errors.push({ line, reason: `Skipped: kind ${quote(value)}` })
        continue
      }
      kind = meaning
    } else kind = mapping.signMeansExpense && !amount.negative ? 'income' : 'expense'
    const name = cell(row, mapping.category).replace(/\s+/g, ' ')
    const noteText = cell(row, mapping.note).replace(/\s*[\r\n]+\s*/g, ' ')
    if (name.length > NAME_MAX) shortened.names++
    if (noteText.length > NOTE_MAX) shortened.notes++
    const categoryName = clip(name, NAME_MAX).trim() || NO_CATEGORY
    const note = clip(noteText, NOTE_MAX).trim()
    const id = typeof mapping.id === 'number' ? ownId(cell(row, mapping.id)) : undefined
    ok.push({ kind, amount: amount.minor, categoryName, date, note, ...(id === undefined ? {} : { id }) })
  }
  return { ok, errors, shortened }
}

const rowKey = (r: ImportRow) => `${r.kind}|${r.amount}|${r.categoryName.toLowerCase()}|${r.date}|${r.note}`

/**
 * The deterministic id of an imported row: `imp_` and the first 24 hex digits of the SHA-256 of
 * `kind|amount|category name in lower case|date|note`, so importing a file again overwrites its entries instead of adding
 * them twice. `occurrence` counts the identical rows before this one in the same file (two equal coffees on one day are
 * two entries): from the second on, `<occurrence>#` goes in front of the hashed text.
 */
export async function importRowId(r: ImportRow, occurrence = 0): Promise<string> {
  const text = occurrence > 0 ? `${occurrence}#${rowKey(r)}` : rowKey(r)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return `imp_${Array.from(digest.subarray(0, 12), (b) => b.toString(16).padStart(2, '0')).join('')}`
}

/**
 * The document ids of a file's rows, in order. A row that carries this app's own id keeps it the first time the file uses
 * it, so importing the app's own CSV export puts every entry back under its own id instead of adding it again; a repeat
 * of that id in the same file would write one document twice, so it gets a content id like any other row. Content ids
 * count identical rows, so each keeps an id of its own on every import. Should a content id equal an own id of the same
 * file (a copied row of an exported import, say), the count goes on, so the copy stays an entry of its own.
 */
export async function importRowIds(rows: ImportRow[]): Promise<string[]> {
  const own = new Set<string>()
  const keepsOwn = rows.map((r) => {
    if (r.id === undefined || own.has(r.id)) return false
    own.add(r.id)
    return true
  })
  const next = new Map<string, number>()
  const occurrence = (r: ImportRow) => {
    const key = rowKey(r)
    const n = next.get(key) ?? 0
    next.set(key, n + 1)
    return n
  }
  const ids = await Promise.all(rows.map((r, i) => (keepsOwn[i] && r.id !== undefined ? Promise.resolve(r.id) : importRowId(r, occurrence(r)))))
  for (const [i, r] of rows.entries()) {
    while (!keepsOwn[i] && own.has(ids[i])) ids[i] = await importRowId(r, occurrence(r))
  }
  return ids
}

// ---- categories ----

/** Categories come in a set per kind: rows meet a category by kind and name, whatever the case. */
export const categoryKey = (kind: Kind, name: string) => `${kind}|${name.trim().toLowerCase()}`

export type CategoryPlan = {
  /** The existing category for each key the rows use, where one exists. */
  matched: Map<string, string>
  /** The categories to create, in the order the rows first use them. */
  create: { key: string; input: CategoryInput }[]
}

/**
 * Which categories an import uses and which it must create. A row's category is the existing one of its kind with its
 * name, ignoring case, archived ones included (an active one preferred); a missing one is created once, named as the
 * first row writes it, after the highest order of its kind (archived categories counted, as on the Categories page),
 * with the "Other" icon and colour.
 */
export function planCategories(rows: ImportRow[], existing: Category[]): CategoryPlan {
  const byKey = new Map<string, string>()
  for (const c of [...existing].sort((a, b) => Number(a.archived) - Number(b.archived) || a.order - b.order)) {
    const key = categoryKey(c.kind, c.name)
    if (!byKey.has(key)) byKey.set(key, c.id)
  }
  const nextOrder: Record<Kind, number> = { expense: 0, income: 0 }
  for (const c of existing) nextOrder[c.kind] = Math.max(nextOrder[c.kind], c.order + 1)
  const matched = new Map<string, string>()
  const create: CategoryPlan['create'] = []
  const planned = new Set<string>()
  for (const r of rows) {
    const key = categoryKey(r.kind, r.categoryName)
    if (planned.has(key)) continue
    planned.add(key)
    const id = byKey.get(key)
    if (id !== undefined) matched.set(key, id)
    else create.push({ key, input: { name: r.categoryName, icon: 'CircleEllipsis', color: 'slate', kind: r.kind, order: nextOrder[r.kind]++, archived: false } })
  }
  return { matched, create }
}
