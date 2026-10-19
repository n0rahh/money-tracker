import { Timestamp } from 'firebase/firestore'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseCsv } from './csv'
import { buildCsvExport, buildJsonExport, exportFileName, shareOrDownload } from './exporting'
import type { Budget, Category, RecurringTemplate, Transaction } from './types'

const BOM = '\uFEFF'
const HEADER = ['id', 'date', 'kind', 'amount', 'currency', 'category', 'note', 'source']
const at = (y: number, m: number, d: number, h: number, min = 0) => Timestamp.fromDate(new Date(y, m - 1, d, h, min))
const utc = (iso: string) => Timestamp.fromDate(new Date(iso))

const GROCERIES: Category = { id: 'groceries', name: 'Groceries', icon: 'ShoppingCart', color: 'emerald', kind: 'expense', order: 0, archived: false }
const HOBBY: Category = { id: 'hobby', name: 'Old hobby', icon: 'Palette', color: 'violet', kind: 'expense', order: 9, archived: true }
const SALARY: Category = { id: 'salary', name: 'Salary', icon: 'Banknote', color: 'emerald', kind: 'income', order: 0, archived: false }
const BY_ID = new Map([GROCERIES, HOBBY, SALARY].map((c) => [c.id, c]))

const tx = (over: Partial<Transaction> & Pick<Transaction, 'id'>): Transaction => ({
  kind: 'expense',
  amount: 100,
  categoryId: 'groceries',
  note: '',
  date: '2026-10-14',
  at: at(2026, 10, 14, 12),
  source: 'app',
  ...over,
})

describe('buildCsvExport', () => {
  const MILK = tx({ id: 'a', amount: 1250, note: 'Milk, bread', at: at(2026, 10, 14, 9) })
  const PAY = tx({ id: 'b', kind: 'income', amount: 500000, categoryId: 'salary', at: at(2026, 10, 14, 18, 30), source: 'import' })
  const GONE = tx({ id: 'c', amount: 4500, categoryId: 'removed-by-hand', note: 'Says "hi"', date: '2026-10-12', source: 'shortcut' })
  const PAINT = tx({ id: 'd', amount: 999, categoryId: 'hobby', note: ' padded ', date: '2026-10-13', recurringId: 'r1' })
  // Same day and moment as MILK: the id decides, as Firestore's own order does (descending, like the other fields).
  const TWIN = tx({ id: 'e', at: at(2026, 10, 14, 9) })

  it('writes the header, then every entry newest first: by date, then by its moment in the day', () => {
    expect(parseCsv(buildCsvExport([MILK, GONE, PAY, TWIN, PAINT], BY_ID, 'PLN'))).toEqual([
      HEADER,
      ['b', '2026-10-14', 'income', '5000.00', 'PLN', 'Salary', '', 'import'],
      ['e', '2026-10-14', 'expense', '1.00', 'PLN', 'Groceries', '', 'app'],
      ['a', '2026-10-14', 'expense', '12.50', 'PLN', 'Groceries', 'Milk, bread', 'app'],
      ['d', '2026-10-13', 'expense', '9.99', 'PLN', 'Old hobby', ' padded ', 'app'],
      ['c', '2026-10-12', 'expense', '45.00', 'PLN', 'Uncategorized', 'Says "hi"', 'shortcut'],
    ])
  })

  it('is UTF-8 text with a BOM, CRLF line ends and RFC 4180 quoting', () => {
    expect(buildCsvExport([MILK, GONE, PAINT], BY_ID, 'PLN')).toBe(
      `${BOM}id,date,kind,amount,currency,category,note,source\r\n` +
        'a,2026-10-14,expense,12.50,PLN,Groceries,"Milk, bread",app\r\n' +
        'd,2026-10-13,expense,9.99,PLN,Old hobby," padded ",app\r\n' +
        'c,2026-10-12,expense,45.00,PLN,Uncategorized,"Says ""hi""",shortcut\r\n',
    )
  })

  it('writes amounts as plain decimals in the scale of the currency', () => {
    const rows = (currency: string) => parseCsv(buildCsvExport([tx({ id: 'x', amount: 1250 })], BY_ID, currency))[1]
    expect(rows('JPY')[3]).toBe('1250')
    expect(rows('KWD')[3]).toBe('1.250')
    expect(rows('EUR')[3]).toBe('12.50')
    expect(rows('jpy')[4]).toBe('jpy')
  })

  it('orders entries of the same day by their exact moment, below a millisecond too', () => {
    // Ids against that order on purpose: were the moments equal, the larger id ("z-early") would come first.
    const early = tx({ id: 'z-early', at: new Timestamp(1_800_000_000, 400) })
    const late = tx({ id: 'a-late', at: new Timestamp(1_800_000_000, 500) })
    expect(parseCsv(buildCsvExport([early, late], BY_ID, 'PLN')).map((r) => r[0])).toEqual(['id', 'a-late', 'z-early'])
  })

  it('is the header alone without entries', () => {
    expect(buildCsvExport([], BY_ID, 'PLN')).toBe(`${BOM}id,date,kind,amount,currency,category,note,source\r\n`)
  })
})

describe('buildJsonExport', () => {
  const NOW = new Date('2026-10-19T15:30:00.000Z')
  const BUDGETS: Budget[] = [{ categoryId: 'groceries', monthly: 80_000 }]
  const RENT: RecurringTemplate = {
    id: 'r1', kind: 'expense', amount: 120_000, categoryId: 'hobby', note: 'Flat', dayOfMonth: 1, startMonth: '2026-01', endMonth: null,
    lastAppliedMonth: '2026-10', createdAt: utc('2026-01-01T10:00:00.000Z'), updatedAt: utc('2026-10-01T10:00:00.000Z'),
  }
  const SHOP = tx({
    id: 't1', amount: 1250, note: 'Milk', at: utc('2026-10-14T07:00:00.000Z'), createdAt: utc('2026-10-14T07:00:01.000Z'), updatedAt: utc('2026-10-14T07:00:02.000Z'),
  })
  const RENT_1 = tx({ id: 'rec_r1_2026-10', amount: 120_000, categoryId: 'hobby', note: 'Flat', date: '2026-10-01', at: utc('2026-10-01T10:00:00.000Z'), recurringId: 'r1' })
  const json = () =>
    JSON.parse(
      buildJsonExport(
        { transactions: [RENT_1, SHOP], categories: [{ ...GROCERIES, createdAt: utc('2026-10-01T08:00:00.000Z') }, SALARY], budgets: BUDGETS, recurring: [RENT], currency: 'PLN' },
        NOW,
      ),
    ) as Record<string, unknown>

  it('is a backup of entries, categories, budgets and recurring templates, with every timestamp an ISO string', () => {
    expect(json()).toEqual({
      exportedAt: '2026-10-19T15:30:00.000Z',
      currency: 'PLN',
      categories: [
        { id: 'groceries', name: 'Groceries', icon: 'ShoppingCart', color: 'emerald', kind: 'expense', order: 0, archived: false, createdAt: '2026-10-01T08:00:00.000Z' },
        { id: 'salary', name: 'Salary', icon: 'Banknote', color: 'emerald', kind: 'income', order: 0, archived: false },
      ],
      budgets: [{ categoryId: 'groceries', monthly: 80_000 }],
      recurring: [
        {
          id: 'r1', kind: 'expense', amount: 120_000, categoryId: 'hobby', note: 'Flat', dayOfMonth: 1, startMonth: '2026-01', endMonth: null,
          lastAppliedMonth: '2026-10', createdAt: '2026-01-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z',
        },
      ],
      // Newest first, as in the CSV; amounts stay in minor units of `currency`; a template's entry keeps its recurringId.
      transactions: [
        {
          id: 't1', kind: 'expense', amount: 1250, categoryId: 'groceries', note: 'Milk', date: '2026-10-14', at: '2026-10-14T07:00:00.000Z', source: 'app',
          createdAt: '2026-10-14T07:00:01.000Z', updatedAt: '2026-10-14T07:00:02.000Z',
        },
        {
          id: 'rec_r1_2026-10', kind: 'expense', amount: 120_000, categoryId: 'hobby', note: 'Flat', date: '2026-10-01', at: '2026-10-01T10:00:00.000Z', source: 'app',
          recurringId: 'r1',
        },
      ],
    })
  })

  it('puts the short sections first and the entries last', () => {
    expect(Object.keys(json())).toEqual(['exportedAt', 'currency', 'categories', 'budgets', 'recurring', 'transactions'])
  })

  it('is indented, readable JSON', () => {
    const text = buildJsonExport({ transactions: [], categories: [], budgets: [], recurring: [], currency: 'EUR' }, NOW)
    expect(text).toBe('{\n  "exportedAt": "2026-10-19T15:30:00.000Z",\n  "currency": "EUR",\n  "categories": [],\n  "budgets": [],\n  "recurring": [],\n  "transactions": []\n}\n')
  })
})

describe('exportFileName', () => {
  it('names the file after the app and the local date', () => {
    expect(exportFileName('csv', new Date(2026, 9, 19, 23, 59))).toBe('money-tracker-2026-10-19.csv')
    expect(exportFileName('json', new Date(2026, 0, 2, 0, 1))).toBe('money-tracker-2026-01-02.json')
  })
})

describe('shareOrDownload', () => {
  const define = (name: 'canShare' | 'share', value: unknown) => Object.defineProperty(navigator, name, { value, configurable: true, writable: true })

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'canShare')
    Reflect.deleteProperty(navigator, 'share')
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  /** Spies on the download path: the URL made, each click on a link (with the link's state at that moment), the revoke. */
  function spyDownload() {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clicks: { href: string; download: string; inDocument: boolean }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.getAttribute('href') ?? '', download: this.download, inDocument: document.body.contains(this) })
    })
    return { createObjectURL, revokeObjectURL, clicks }
  }

  it('hands the file to the share sheet when the browser can share files', async () => {
    const canShare = vi.fn(() => true)
    const share = vi.fn(async () => {})
    define('canShare', canShare)
    define('share', share)
    const { createObjectURL } = spyDownload()

    await expect(shareOrDownload('money-tracker-2026-10-19.csv', 'text/csv', 'a,b\r\n')).resolves.toBe('shared')
    expect(share).toHaveBeenCalledTimes(1)
    const shared = (share.mock.calls[0] as unknown as [{ files: File[] }])[0]
    expect(Object.keys(shared)).toEqual(['files'])
    const [file] = shared.files
    expect(file).toBeInstanceOf(File)
    expect(file.name).toBe('money-tracker-2026-10-19.csv')
    expect(file.type).toBe('text/csv')
    expect(await file.text()).toBe('a,b\r\n')
    expect(canShare).toHaveBeenCalledWith({ files: [file] })
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'cannot share this file',
      setUp: () => {
        define('canShare', () => false)
        define('share', vi.fn())
      },
    },
    { name: 'has no Web Share at all', setUp: () => {} },
  ])('downloads through a temporary link when the browser $name, and frees the URL afterwards', async ({ setUp }) => {
    setUp()
    vi.useFakeTimers()
    const { createObjectURL, revokeObjectURL, clicks } = spyDownload()

    await expect(shareOrDownload('money-tracker-2026-10-19.json', 'application/json', '{}\n')).resolves.toBe('downloaded')
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toBe('application/json')
    expect(await blob.text()).toBe('{}\n')
    expect(clicks).toEqual([{ href: 'blob:export', download: 'money-tracker-2026-10-19.json', inDocument: true }])
    expect(document.querySelector('a')).toBeNull() // the link is gone again
    // Not freed at once: some browsers read the URL only after the click has returned.
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.advanceTimersByTime(40_000)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export')
  })

  it.each(['AbortError', 'NotAllowedError'])('passes a refused share on to the caller (%s)', async (name) => {
    define('canShare', () => true)
    define('share', vi.fn(async () => Promise.reject(new DOMException('no', name))))
    const { clicks } = spyDownload()
    await expect(shareOrDownload('a.csv', 'text/csv', 'x')).rejects.toMatchObject({ name })
    expect(clicks).toEqual([]) // no download behind the user's back
  })
})
