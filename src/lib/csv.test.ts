import { createHash } from 'node:crypto'
import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import {
  applyMapping,
  distinctKindValues,
  guessColumns,
  guessMapping,
  importRowId,
  importRowIds,
  kindOfValue,
  ownId,
  parseAmount,
  parseCsv,
  parseDate,
  planCategories,
  slashDateOrderOf,
  toCsv,
  type ColumnMapping,
  type ImportRow,
  type KindValue,
} from './csv'
import { buildCsvExport } from './exporting'
import type { Category, Transaction } from './types'

const BOM = '\uFEFF'
/** The data rows of a CSV text: everything after its header. */
const dataOf = (text: string) => parseCsv(text).slice(1)
const NOTHING_SHORTENED = { notes: 0, names: 0 }

describe('parseCsv', () => {
  it('splits records on line ends and fields on commas', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
  })

  it('keeps commas, line breaks and doubled quotes inside quoted fields', () => {
    expect(parseCsv('note,amount\r\n"Milk, bread\r\nand ""eggs""",12\r\n')).toEqual([
      ['note', 'amount'],
      ['Milk, bread\r\nand "eggs"', '12'],
    ])
  })

  it('reads CRLF, LF and lone CR line ends, with or without a final one', () => {
    expect(parseCsv('a,b\r\n1,2\n3,4\r5,6')).toEqual([['a', 'b'], ['1', '2'], ['3', '4'], ['5', '6']])
  })

  it('ignores the final line end only: a blank line is a record with one empty field', () => {
    expect(parseCsv('a\n\nb\n')).toEqual([['a'], [''], ['b']])
    expect(parseCsv('a\n\n')).toEqual([['a'], ['']])
  })

  it('strips a UTF-8 byte order mark', () => {
    expect(parseCsv(`${BOM}date,amount\r\n2026-10-14,1\r\n`)).toEqual([['date', 'amount'], ['2026-10-14', '1']])
  })

  it('keeps empty fields, at the end of a record too', () => {
    expect(parseCsv('a,,c\n,b,\n')).toEqual([['a', '', 'c'], ['', 'b', '']])
  })

  it('has no records for an empty text', () => {
    expect(parseCsv('')).toEqual([])
    expect(parseCsv(BOM)).toEqual([])
  })

  it('is lenient with stray quotes: a quote inside an unquoted field is kept, text after a closing quote is appended', () => {
    expect(parseCsv('ab"c,d\n"x"y,z\n')).toEqual([['ab"c', 'd'], ['xy', 'z']])
  })

  it('reads an unterminated quoted field to the end of the text', () => {
    expect(parseCsv('a,"open, quote\n')).toEqual([['a', 'open, quote\n']])
  })

  describe('separator', () => {
    it('is ; when the header line has more ; than , (a European Excel export)', () => {
      expect(parseCsv('Date;Amount;Note\r\n14.10.2026;12,50;"a; b"\r\n')).toEqual([
        ['Date', 'Amount', 'Note'],
        ['14.10.2026', '12,50', 'a; b'],
      ])
    })

    it('stays , on a tie or when , wins', () => {
      expect(parseCsv('a;b,c\n1;2,3\n')).toEqual([['a;b', 'c'], ['1;2', '3']])
      expect(parseCsv('a,b,c;d\n')).toEqual([['a', 'b', 'c;d']])
    })

    it('counts only the separators outside quotes, in the header line only', () => {
      expect(parseCsv('"a;b;c",d\n1;2;3;4,5\n')).toEqual([['a;b;c', 'd'], ['1;2;3;4', '5']])
    })
  })
})

describe('toCsv', () => {
  it('starts with a BOM and ends every record with CRLF', () => {
    expect(toCsv([['a', 'b'], ['1', '2']])).toBe(`${BOM}a,b\r\n1,2\r\n`)
  })

  it('quotes a field with a comma, a semicolon, a quote, a line break or a space at either end, doubling its quotes', () => {
    expect(toCsv([['a,b', 'say "hi"', 'two\nlines', 'cr\rhere', ' lead', 'trail ', 'in side', '', 'semi;colon']])).toBe(
      `${BOM}"a,b","say ""hi""","two\nlines","cr\rhere"," lead","trail ",in side,,"semi;colon"\r\n`,
    )
  })

  it('reads back what it wrote, even when the first record has more semicolons than commas', () => {
    // Unquoted, "a;b;c" in the first line would make parseCsv take ";" for the separator.
    const rows = [['a;b;c', 'd'], ['1;2', '3']]
    expect(parseCsv(toCsv(rows))).toEqual(rows)
  })

  it('round-trips with parseCsv', () => {
    const rows = [
      ['id', 'note'],
      ['1', 'Milk, bread\nand "eggs"'],
      ['2', ' padded '],
      ['3', ''],
      ['4', 'zażółć gęślą jaźń 😀'],
      ['5', '"'],
    ]
    const text = toCsv(rows)
    expect(parseCsv(text)).toEqual(rows)
    expect(toCsv(parseCsv(text))).toBe(text)
  })
})

describe('the CSV writer of scripts/mmbak-dump.mjs', () => {
  it('writes exactly what toCsv writes (the script is standalone, so it has a copy)', async () => {
    // A path in a variable: TypeScript does not look into the plain-JS script, Vitest loads it all the same.
    const script = '../../scripts/mmbak-dump.mjs'
    const { toCsv: scriptToCsv } = (await import(/* @vite-ignore */ script)) as { toCsv: (rows: string[][]) => string }
    const rows = [
      ['plain', 'a,b', 'say "hi"', 'two\nlines', 'cr\rhere', ' lead', 'trail ', '\ttab', 'in side', '', 'semi;colon', 'zażółć 😀'],
      [''],
      ['"', '""', ',', ' '],
    ]
    expect(scriptToCsv(rows)).toBe(toCsv(rows))
    expect(scriptToCsv([])).toBe(toCsv([]))
  })
})

describe('guessMapping', () => {
  const MONEY_MANAGER = ['Date', 'Account', 'Category', 'Subcategory', 'Note', 'PLN', 'Income/Expense', 'Description', 'Amount', 'Currency']

  it('maps a Money Manager export, preferring the column literally named Amount to a currency-code column', () => {
    expect(guessMapping(MONEY_MANAGER)).toEqual({ date: 0, amount: 8, kind: 6, category: 2, note: 4, id: null, signMeansExpense: false })
  })

  it('takes a column named after a currency code when there is no Amount column', () => {
    expect(guessMapping(MONEY_MANAGER.filter((h) => h !== 'Amount'))).toEqual({ date: 0, amount: 5, kind: 6, category: 2, note: 4, id: null, signMeansExpense: false })
  })

  it("maps the app's own CSV export, its id column included", () => {
    expect(guessMapping(['id', 'date', 'kind', 'amount', 'currency', 'category', 'note', 'source'])).toEqual({
      date: 1,
      amount: 3,
      kind: 2,
      category: 5,
      note: 6,
      id: 0,
      signMeansExpense: false,
    })
  })

  it('ignores case and the spaces around a header', () => {
    expect(guessMapping(['  DATUM ', 'Kategoria', ' Amount (PLN) ', 'MEMO', ' ID '])).toEqual({
      date: 0,
      amount: 2,
      kind: null,
      category: 1,
      note: 3,
      id: 4,
      signMeansExpense: true,
    })
  })

  it('reads the sign of the amount (negative = expense) when there is no kind column', () => {
    expect(guessMapping(['Date', 'Category', 'Amount'])).toEqual({ date: 0, amount: 2, kind: null, category: 1, note: null, id: null, signMeansExpense: true })
  })

  it.each([
    ['date', ['date', 'Data', 'DATUM']],
    ['amount', ['amount', 'Sum', 'value', 'PLN', 'eur', 'USD', 'JPY', 'amount (pln)', 'Amount (EUR)']],
    ['kind', ['kind', 'Type', 'Income/Expense', 'income / expense', 'InOut']],
    ['category', ['category', 'categorie', 'Kategoria', 'Category name']],
    ['note', ['note', 'notes', 'Description', 'memo', 'Title']],
  ] as const)('recognises every %s header', (field, names) => {
    const base = ['x0', 'x1', 'x2', 'x3']
    for (const name of names) {
      expect(guessColumns([...base, name])[field], name).toBe(4)
    }
  })

  it.each([
    ['amount', ['Kwota', 'amount [eur]', 'Amount USD']],
    ['note', ['Opis', 'Notatka', 'Comment']],
    ['date', ['Period', 'Transaction date', 'Booking date']],
    ['kind', ['Expense/Income', 'In/Out', 'Transaction type', 'Typ']],
    ['category', ['Categories']],
  ] as const)('recognises the %s headers beyond the brief', (field, names) => {
    for (const name of names) expect(guessColumns(['x0', 'x1', 'x2', 'x3', name])[field], name).toBe(4)
  })

  it('takes the first matching column, by synonym priority', () => {
    // "Note" is listed before "Description" among the note headers; "Amount" before any currency code.
    expect(guessColumns(['Description', 'Note', 'EUR', 'Amount', 'Date', 'Category'])).toEqual({ date: 4, amount: 3, kind: null, category: 5, note: 1, id: null })
  })

  it('does not take a three-letter header that is no currency for the amount', () => {
    expect(guessColumns(['Date', 'Category', 'Day', 'Tag', 'Fee']).amount).toBeNull()
  })

  it('is null without a date, an amount or a category column, while guessColumns keeps what it found', () => {
    expect(guessMapping(['Category', 'Amount'])).toBeNull()
    expect(guessMapping(['Date', 'Category'])).toBeNull()
    expect(guessMapping(['Date', 'Amount', 'Note'])).toBeNull()
    expect(guessColumns(['Date', 'Amount', 'Note'])).toEqual({ date: 0, amount: 1, kind: null, category: null, note: 2, id: null })
  })
})

describe('parseDate', () => {
  it.each([
    ['2026-10-14', '2026-10-14'],
    ['2026-1-4', '2026-01-04'],
    ['2026/10/14', '2026-10-14'],
    ['14.10.2026', '2026-10-14'],
    ['4.3.2026', '2026-03-04'],
    ['14-10-2026', '2026-10-14'],
    ['14/10/2026', '2026-10-14'],
    ['03/04/2026', '2026-04-03'],
    ['2026-10-14 13:22', '2026-10-14'],
    ['2026-10-14T13:22:05', '2026-10-14'],
    ['14.10.2026 08:00:00', '2026-10-14'],
    ['10/14/2026 9:05 PM', '2026-10-14'],
    ['  29.02.2028 ', '2028-02-29'],
  ])('reads %s as %s', (text, iso) => {
    expect(parseDate(text, text.startsWith('10/14') ? 'mdy' : 'dmy')).toBe(iso)
  })

  it.each(['2026-10-14T23:30:00Z', '2026-10-14T23:30:00+02:00', '2026-10-14T23:30:00.123-0500'])('reads the date of an ISO timestamp, its zone ignored: %s', (text) => {
    expect(parseDate(text, 'dmy')).toBe('2026-10-14')
  })

  it('reads a slash date month first when told to', () => {
    expect(parseDate('03/04/2026', 'mdy')).toBe('2026-03-04')
    expect(parseDate('03/04/2026', 'dmy')).toBe('2026-04-03')
    // Dots, dashes and year-first dates have one reading only.
    expect(parseDate('03.04.2026', 'mdy')).toBe('2026-04-03')
    expect(parseDate('2026/03/04', 'mdy')).toBe('2026-03-04')
  })

  it.each(['', 'yesterday', '2026-02-30', '31.04.2026', '29.02.2026', '13/13/2026', '2026-13-01', '2026-00-10', '14.10.26', '14/10', '20261014', '1.1.1', '2026-10/14', '14.10-2026'])(
    'refuses %j',
    (text) => {
      expect(parseDate(text, 'dmy')).toBeNull()
    },
  )
})

describe('parseAmount', () => {
  it.each([
    ['12,50', 1250],
    ['12.50', 1250],
    ['12.5', 1250],
    ['1 234,56', 123456],
    ['1\u00a0234,56', 123456],
    ['1\u202f234,56', 123456],
    ['1,234.56', 123456],
    ['1.234,56', 123456],
    ["1'234.56", 123456],
    ['1,234,567.89', 123456789],
    ['1234', 123400],
    ['0.05', 5],
    ['.5', 50],
    ['12.5000', 1250],
    ['€12.50', 1250],
    ['12,50 zł', 1250],
    ['PLN 12.50', 1250],
    ['+3', 300],
  ])('reads %s as %i minor units', (text, minor) => {
    expect(parseAmount(text, 2)).toEqual({ ok: true, minor, negative: false })
  })

  it.each([
    ['-12.50', 1250],
    ['\u221212,50', 1250],
    ['(12.50)', 1250],
    ['( 1 234,56 )', 123456],
    ['-€12.50', 1250],
    ['12.50-', 1250],
  ])('reads %s as negative, %i minor units', (text, minor) => {
    expect(parseAmount(text, 2)).toEqual({ ok: true, minor, negative: true })
  })

  it('reads one separator before exactly three digits as thousands, unless the column says otherwise', () => {
    expect(parseAmount('1,234', 2)).toEqual({ ok: true, minor: 123400, negative: false })
    expect(parseAmount('1.234', 2)).toEqual({ ok: true, minor: 123400, negative: false })
    // The column's other amounts show that "." is its decimal separator: three decimals are then too many.
    expect(parseAmount('1.234', 2, '.')).toEqual({ ok: false, reason: 'Amount "1.234" has more than 2 decimals' })
    expect(parseAmount('1,234', 2, '.')).toEqual({ ok: true, minor: 123400, negative: false })
    // A currency with three decimals reads them as decimals.
    expect(parseAmount('1,234', 3)).toEqual({ ok: true, minor: 1234, negative: false })
    // A leading zero is never a thousands group.
    expect(parseAmount('0,125', 2)).toEqual({ ok: false, reason: 'Amount "0,125" has more than 2 decimals' })
  })

  it('follows the currency scale', () => {
    expect(parseAmount('1,234', 0)).toEqual({ ok: true, minor: 1234, negative: false })
    expect(parseAmount('1 234', 0)).toEqual({ ok: true, minor: 1234, negative: false })
    expect(parseAmount('12.5', 0)).toEqual({ ok: false, reason: 'Amount "12.5" has decimals' })
    expect(parseAmount('1.5', 3)).toEqual({ ok: true, minor: 1500, negative: false })
  })

  it.each([
    ['', 'No amount'],
    ['abc', 'Unreadable amount "abc"'],
    ['12.3.4', 'Unreadable amount "12.3.4"'],
    ['1,23,456', 'Unreadable amount "1,23,456"'],
    ['12,50.3', 'Unreadable amount "12,50.3"'],
    ['--5', 'Unreadable amount "--5"'],
    ['1e5', 'Unreadable amount "1e5"'],
    ['12.5055', 'Amount "12.5055" has more than 2 decimals'],
    ['a very long piece of text that is certainly not an amount at all', 'Unreadable amount "a very long piece of text that is certai…"'],
  ])('refuses %j: %s', (text, reason) => {
    expect(parseAmount(text, 2)).toEqual({ ok: false, reason })
  })
})

describe('kindOfValue', () => {
  it.each(['Income', 'in', 'IN', 'earning', 'Earnings', 'revenue', ' Income '])('reads %j as income', (value) => {
    expect(kindOfValue(value)).toBe('income')
  })
  it.each(['Transfer-Out', 'Transfer-In', 'transfer'])('skips %j (a transfer between accounts is no income or expense)', (value) => {
    expect(kindOfValue(value)).toBe('skip')
  })
  it.each(['Expense', 'Exp.', 'out', '', 'anything'])('reads %j as an expense', (value) => {
    expect(kindOfValue(value)).toBe('expense')
  })
})

describe('distinctKindValues', () => {
  it('lists each value of the column once, as first written, with its count, blank included', () => {
    const rows = [['Expense', '1'], ['Income', '1'], ['expense', '1'], [' Expense ', '1'], ['', '1'], ['Transfer-Out', '1'], ['   ', '1']]
    expect(distinctKindValues(rows, 0)).toEqual([
      { key: 'expense', value: 'Expense', count: 3 },
      { key: 'income', value: 'Income', count: 1 },
      { key: '', value: '', count: 2 },
      { key: 'transfer-out', value: 'Transfer-Out', count: 1 },
    ])
  })

  it('leaves blank rows out', () => {
    expect(distinctKindValues([['Income', '1'], ['', ''], ['Income']], 0)).toEqual([{ key: 'income', value: 'Income', count: 2 }])
  })
})

describe('applyMapping', () => {
  const SIGNED: ColumnMapping = { date: 0, amount: 1, kind: null, category: 2, note: 3, signMeansExpense: true }

  it('imports a Money Manager-style file: quoted notes with commas and line breaks, decimal commas, negative amounts as expenses', () => {
    const text = [
      'Date,Amount,Category,Note',
      '14.10.2026,"-12,50",groceries,"Milk, bread',
      'and eggs"',
      '15.10.2026,"5 000,00",Salary,October pay',
    ].join('\r\n')
    expect(applyMapping(dataOf(text), SIGNED, 2)).toEqual({
      ok: [
        { kind: 'expense', amount: 1250, categoryName: 'groceries', date: '2026-10-14', note: 'Milk, bread and eggs' },
        { kind: 'income', amount: 500000, categoryName: 'Salary', date: '2026-10-15', note: 'October pay' },
      ],
      errors: [],
      shortened: NOTHING_SHORTENED,
    })
  })

  it('reads the same file exported with ; separators', () => {
    const text = 'Date;Amount;Category;Note\r\n14.10.2026;-12,50;groceries;"Milk, bread\r\nand eggs"\r\n'
    expect(applyMapping(dataOf(text), SIGNED, 2).ok).toEqual([
      { kind: 'expense', amount: 1250, categoryName: 'groceries', date: '2026-10-14', note: 'Milk, bread and eggs' },
    ])
  })

  it('takes the kind from the kind column and stores the amount without its sign', () => {
    const mapping: ColumnMapping = { date: 0, amount: 1, kind: 2, category: 3, note: null, signMeansExpense: true }
    const rows = [
      ['2026-10-01', '12.50', 'Expense', 'Food'],
      ['2026-10-02', '-3.00', 'Expense', 'Food'],
      ['2026-10-03', '100', 'Income', 'Salary'],
      ['2026-10-04', '-7', 'income', 'Refund'],
      ['2026-10-05', '1', '', 'Food'],
    ]
    expect(applyMapping(rows, mapping, 2).ok.map((r) => [r.kind, r.amount])).toEqual([
      ['expense', 1250],
      ['expense', 300],
      ['income', 10000],
      ['income', 700],
      ['expense', 100],
    ])
  })

  it('imports every row as an expense when there is no kind column and the sign means nothing', () => {
    const rows = [['2026-10-01', '-12.50', 'Food'], ['2026-10-02', '3', 'Food']]
    const mapping: ColumnMapping = { date: 0, amount: 1, kind: null, category: 2, note: null, signMeansExpense: false }
    expect(applyMapping(rows, mapping, 2).ok.map((r) => [r.kind, r.amount])).toEqual([
      ['expense', 1250],
      ['expense', 300],
    ])
  })

  it('skips the kind values the mapping says to skip (transfers by default) and follows its overrides', () => {
    const rows = [
      ['2026-10-01', '10', 'Дохід', 'Зарплата'],
      ['2026-10-02', '5', 'Витрата', 'Їжа'],
      ['2026-10-03', '7', 'Transfer-Out', 'Bank'],
      ['2026-10-04', '9', 'Expense', 'Food'],
    ]
    const mapping: ColumnMapping = { date: 0, amount: 1, kind: 2, category: 3, note: null, signMeansExpense: false }
    expect(applyMapping(rows, mapping, 2)).toEqual({
      ok: [
        { kind: 'expense', amount: 1000, categoryName: 'Зарплата', date: '2026-10-01', note: '' },
        { kind: 'expense', amount: 500, categoryName: 'Їжа', date: '2026-10-02', note: '' },
        { kind: 'expense', amount: 900, categoryName: 'Food', date: '2026-10-04', note: '' },
      ],
      errors: [{ line: 4, reason: 'Skipped: kind "Transfer-Out"' }],
      shortened: NOTHING_SHORTENED,
    })
    const kindValues = new Map<string, KindValue>([
      ['дохід', 'income'],
      ['expense', 'skip'],
    ])
    const overridden = applyMapping(rows, { ...mapping, kindValues }, 2)
    expect(overridden.ok.map((r) => [r.categoryName, r.kind])).toEqual([
      ['Зарплата', 'income'],
      ['Їжа', 'expense'],
    ])
    expect(overridden.errors).toEqual([
      { line: 4, reason: 'Skipped: kind "Transfer-Out"' },
      { line: 5, reason: 'Skipped: kind "Expense"' },
    ])
  })

  it('reads a kind value named like an object member as any other word', () => {
    const rows = [['2026-10-01', '1', 'constructor', 'Food'], ['2026-10-02', '1', '__proto__', 'Food'], ['2026-10-03', '1', 'toString', 'Food']]
    const mapping: ColumnMapping = { date: 0, amount: 1, kind: 2, category: 3, note: null, signMeansExpense: false, kindValues: new Map() }
    expect(applyMapping(rows, mapping, 2).ok.map((r) => r.kind)).toEqual(['expense', 'expense', 'expense'])
  })

  it('reports zero, unreadable and oversized amounts and unreadable dates with their line, the header being line 1', () => {
    const rows = [
      ['2026-10-01', '0,00', 'Food', ''],
      ['2026-10-02', 'abc', 'Food', ''],
      ['2026-02-30', '12', 'Food', ''],
      ['', '', '', ''],
      ['yesterday', '12', 'Food', ''],
      ['2026-10-03', '12', 'Food', 'fine'],
      ['2026-10-04', '1000000000', 'Food', ''],
      ['2026-10-05'],
    ]
    expect(applyMapping(rows, SIGNED, 2)).toEqual({
      ok: [{ kind: 'income', amount: 1200, categoryName: 'Food', date: '2026-10-03', note: 'fine' }],
      errors: [
        { line: 2, reason: 'Amount is zero' },
        { line: 3, reason: 'Unreadable amount "abc"' },
        { line: 4, reason: 'Unreadable date "2026-02-30"' },
        // line 5 is blank: skipped without a word
        { line: 6, reason: 'Unreadable date "yesterday"' },
        { line: 8, reason: 'Amount "1000000000" is too large' },
        { line: 9, reason: 'No amount' },
      ],
      shortened: NOTHING_SHORTENED,
    })
  })

  it('reports a row without a date, spaces only included', () => {
    expect(applyMapping([['', '12', 'Food'], ['   ', '12', 'Food']], SIGNED, 2).errors).toEqual([
      { line: 2, reason: 'No date' },
      { line: 3, reason: 'No date' },
    ])
  })

  it('reads every cell trimmed: reasons quote the text without its padding, and a padded kind value meets its override', () => {
    expect(applyMapping([['2026-10-01', '  abc  ', 'Food'], ['  31.04.2026 ', '1', 'Food']], SIGNED, 2).errors).toEqual([
      { line: 2, reason: 'Unreadable amount "abc"' },
      { line: 3, reason: 'Unreadable date "31.04.2026"' },
    ])
    const mapping: ColumnMapping = { date: 0, amount: 1, kind: 2, category: 3, note: null, signMeansExpense: false, kindValues: new Map([['wpływ', 'income']]) }
    expect(applyMapping([['2026-10-01', '5', '  Wpływ ', 'Bonus']], mapping, 2).ok.map((r) => r.kind)).toEqual(['income'])
  })

  it('decides day/month order for the whole column: month first only when some date can only be read that way', () => {
    const rows = (dates: string[]) => dates.map((d) => [d, '1', 'Food'])
    // 14 cannot be a month: the file writes month first, so 03/04 is the 4th of March as well.
    expect(applyMapping(rows(['10/14/2026', '03/04/2026']), SIGNED, 2).ok.map((r) => r.date)).toEqual(['2026-10-14', '2026-03-04'])
    // Nothing says so: day first.
    expect(applyMapping(rows(['03/04/2026', '12/11/2026']), SIGNED, 2).ok.map((r) => r.date)).toEqual(['2026-04-03', '2026-11-12'])
    // Both orders appear: day first, and the dates only readable month first are reported.
    expect(applyMapping(rows(['25/12/2026', '12/25/2026']), SIGNED, 2)).toEqual({
      ok: [{ kind: 'income', amount: 100, categoryName: 'Food', date: '2026-12-25', note: '' }],
      errors: [{ line: 3, reason: 'Unreadable date "12/25/2026"' }],
      shortened: NOTHING_SHORTENED,
    })
  })

  it('takes a 12 for a day or a month alike: only a number above 12 proves the order (the boundary)', () => {
    const rows = (dates: string[]) => dates.map((d) => [d, '1', 'Food'])
    // 05/12/2026: the 12 can be a month, so nothing proves month first: the 5th of December.
    expect(applyMapping(rows(['01/12/2026', '05/12/2026']), SIGNED, 2).ok.map((r) => r.date)).toEqual(['2026-12-01', '2026-12-05'])
    // 12/25/2026: the 12 can be a day too, but 25 cannot be a month: month first.
    expect(applyMapping(rows(['12/25/2026']), SIGNED, 2).ok.map((r) => r.date)).toEqual(['2026-12-25'])
  })

  it('reads slash dates in the order the mapping sets, whatever the file proves', () => {
    const rows = [['03/04/2026', '1', 'Food'], ['10/14/2026', '1', 'Food']]
    // The file proves month first (14 is no month); set to day first, 10/14 cannot be read.
    expect(applyMapping(rows, { ...SIGNED, dateOrder: 'dmy' }, 2)).toMatchObject({
      ok: [{ date: '2026-04-03' }],
      errors: [{ line: 3, reason: 'Unreadable date "10/14/2026"' }],
    })
    expect(applyMapping([['03/04/2026', '1', 'Food']], { ...SIGNED, dateOrder: 'mdy' }, 2).ok.map((r) => r.date)).toEqual(['2026-03-04'])
  })

  it("decides the decimal separator for the whole column from its unambiguous amounts", () => {
    const rows = (amounts: string[]) => amounts.map((a) => ['2026-10-01', a, 'Food'])
    // "1.50" shows that "." is the decimal separator, so "12.345" has three decimals, not thousands.
    expect(applyMapping(rows(['1.50', '12.345']), SIGNED, 2).errors).toEqual([{ line: 3, reason: 'Amount "12.345" has more than 2 decimals' }])
    // "12,50" shows a decimal comma, so "1.234" is a thousand.
    expect(applyMapping(rows(['12,50', '1.234']), SIGNED, 2).ok.map((r) => r.amount)).toEqual([1250, 123400])
    // Three digits after a lone separator could be either, so they decide nothing: whole thousands stay thousands.
    expect(applyMapping(rows(['1.234', '2.500']), SIGNED, 2).ok.map((r) => r.amount)).toEqual([123400, 250000])
  })

  it('cleans the category and the note to what the app stores', () => {
    const long = 'x'.repeat(45)
    const emoji = `a${'😀'.repeat(100)}` // 201 UTF-16 code units: the 200th is the first half of the last emoji
    const rows = [
      ['2026-10-01', '1', '  Food  ', '  spaced  '],
      ['2026-10-02', '1', '', ''],
      ['2026-10-03', '1', long, 'n'.repeat(250)],
      ['2026-10-04', '1', 'Food', emoji],
      ['2026-10-05', '1', 'Food', 'one\r\ntwo \n three'],
    ]
    const ok = applyMapping(rows, SIGNED, 2).ok
    expect(ok.map((r) => r.categoryName)).toEqual(['Food', 'Other', 'x'.repeat(40), 'Food', 'Food'])
    expect(ok[0].note).toBe('spaced')
    expect(ok[1].note).toBe('')
    expect(ok[2].note).toBe('n'.repeat(200))
    // Cut to at most 200 code units without leaving half of the last emoji behind.
    expect(ok[3].note).toBe(`a${'😀'.repeat(99)}`)
    expect(ok[4].note).toBe('one two three')
    // Said, not silent: the 45-character name, and the 250-character and 201-unit notes.
    expect(applyMapping(rows, SIGNED, 2).shortened).toEqual({ notes: 2, names: 1 })
  })

  it('counts only the cuts of rows it imports, and nothing at exactly the limits', () => {
    const rows = [
      ['2026-10-01', '1', 'x'.repeat(40), 'n'.repeat(200)],
      ['yesterday', '1', 'y'.repeat(41), 'n'.repeat(201)],
      ['2026-10-02', '1', ` ${'z'.repeat(40)} `, `  ${'n'.repeat(200)}  `],
    ]
    expect(applyMapping(rows, SIGNED, 2).shortened).toEqual(NOTHING_SHORTENED)
  })

  it('leaves the note empty without a note column, and blank rows out', () => {
    const mapping: ColumnMapping = { date: 0, amount: 1, kind: null, category: 2, note: null, signMeansExpense: true }
    expect(applyMapping([['2026-10-01', '-1', 'Food', 'ignored'], [], ['', ' ', '']], mapping, 2)).toEqual({
      ok: [{ kind: 'expense', amount: 100, categoryName: 'Food', date: '2026-10-01', note: '' }],
      errors: [],
      shortened: NOTHING_SHORTENED,
    })
  })
})

describe('importRowId', () => {
  const ROW: ImportRow = { kind: 'expense', amount: 1250, categoryName: 'Groceries', date: '2026-10-14', note: 'Milk' }
  const sha = (text: string) => createHash('sha256').update(text).digest('hex')

  it('is imp_ and the first 24 hex digits of the SHA-256 of kind|amount|category in lower case|date|note: 28 characters', async () => {
    const id = await importRowId(ROW)
    expect(id).toBe(`imp_${sha('expense|1250|groceries|2026-10-14|Milk').slice(0, 24)}`)
    expect(id).toHaveLength(28)
    expect(id).toMatch(/^imp_[0-9a-f]{24}$/)
  })

  it('is stable, and the same whatever the case of the category name', async () => {
    expect(await importRowId(ROW)).toBe(await importRowId({ ...ROW }))
    expect(await importRowId({ ...ROW, categoryName: 'GROCERIES' })).toBe(await importRowId(ROW))
  })

  it('changes with every other field', async () => {
    const ids = await Promise.all(
      [
        ROW,
        { ...ROW, kind: 'income' as const },
        { ...ROW, amount: 1251 },
        { ...ROW, categoryName: 'Food' },
        { ...ROW, date: '2026-10-15' },
        { ...ROW, note: 'milk' },
      ].map((r) => importRowId(r)),
    )
    expect(new Set(ids).size).toBe(6)
  })

  it('gives repeated identical rows ids of their own, the same ones on every import of the file', async () => {
    const other = { ...ROW, note: 'Bread' }
    const ids = await importRowIds([ROW, ROW, other, { ...ROW, categoryName: 'groceries' }])
    expect(new Set(ids).size).toBe(4)
    // The first of them keeps the plain id; the repeats hash their count in front.
    expect(ids[0]).toBe(await importRowId(ROW))
    expect(ids[1]).toBe(`imp_${sha('1#expense|1250|groceries|2026-10-14|Milk').slice(0, 24)}`)
    expect(ids[1]).toBe(await importRowId(ROW, 1))
    expect(ids[3]).toBe(await importRowId(ROW, 2))
    expect(ids[2]).toBe(await importRowId(other))
    expect(await importRowIds([ROW, ROW, other, { ...ROW, categoryName: 'groceries' }])).toEqual(ids)
  })
})

describe('slashDateOrderOf', () => {
  it.each([
    { cells: ['03/04/2026'], expected: { proven: null, ambiguous: '03/04/2026' } },
    { cells: ['03/04/2026', '10/14/2026'], expected: { proven: 'mdy', ambiguous: '03/04/2026' } },
    { cells: ['25/12/2026', '03/04/2026 13:22'], expected: { proven: 'dmy', ambiguous: '03/04/2026' } },
    { cells: ['25/12/2026', '12/25/2026'], expected: { proven: null, ambiguous: null } },
    // The same either way: no question to ask.
    { cells: ['05/05/2026', '12/12/2026'], expected: { proven: null, ambiguous: null } },
    { cells: ['2026-10-14', '14.10.2026', ''], expected: { proven: null, ambiguous: null } },
  ])('$cells', ({ cells, expected }) => {
    expect(slashDateOrderOf(cells)).toEqual(expected)
  })
})

describe("the id column of the app's own export", () => {
  const cat = (id: string, name: string, kind: Category['kind']): Category => ({ id, name, kind, order: 0, archived: false, icon: 'Gift', color: 'red' })
  const BY_ID = new Map([cat('c1', 'Groceries', 'expense'), cat('c2', 'Salary', 'income'), cat('c3', 'Books', 'expense')].map((c) => [c.id, c]))
  const at = (day: number) => Timestamp.fromDate(new Date(2026, 9, day, 12))
  /** What the sheet does with a file: the guessed mapping, then the rows and their document ids. */
  const read = async (text: string) => {
    const [header, ...rows] = parseCsv(text)
    const mapping = guessMapping(header)
    if (!mapping) throw new Error('no mapping')
    const { ok, errors } = applyMapping(rows, mapping, 2)
    return { ok, errors, ids: await importRowIds(ok) }
  }

  it('gives every entry of the export its own id back: imported twins, app, recurring and Shortcut entries', async () => {
    const twin: ImportRow = { kind: 'expense', amount: 1250, categoryName: 'groceries', date: '2026-10-14', note: 'Milk' }
    const milk = { kind: 'expense' as const, amount: 1250, categoryId: 'c1', note: 'Milk', date: '2026-10-14', at: at(14), source: 'import' as const }
    const docs: Transaction[] = [
      { id: await importRowId(twin), ...milk },
      { id: await importRowId(twin, 1), ...milk },
      { id: 'Zp3kQ9aTn1xYb7VdLm2R', kind: 'expense', amount: 999, categoryId: 'c3', note: 'Dune', date: '2026-10-11', at: at(11), source: 'app' },
      {
        id: 'rec_Tmpl0123456789abcdef_2026-10', kind: 'expense', amount: 120_000, categoryId: 'c1', note: 'Flat', date: '2026-10-01', at: at(1), source: 'app',
        recurringId: 'Tmpl0123456789abcdef',
      },
      { id: 'Qw8eRt5yUi0oPa3sDf6g', kind: 'income', amount: 450, categoryId: 'c2', note: '', date: '2026-10-10', at: at(10), source: 'shortcut' },
    ]
    const { ok, errors, ids } = await read(buildCsvExport(docs, BY_ID, 'PLN'))
    expect(errors).toEqual([])
    // Every row carries its own id, and that is its document id: nothing is added again.
    expect(ok.map((r) => r.id)).toEqual(ids)
    expect([...ids].sort()).toEqual(docs.map((d) => d.id).sort())
  })

  it("takes no id from a column that is not this app's: numbers, references, reserved and path-like ids, UUIDs", async () => {
    const text = [
      'id,date,amount,category',
      '1,2026-10-01,-5,Food',
      'TRX/2024/001,2026-10-02,-5,Food',
      '__x__,2026-10-03,-5,Food',
      '..,2026-10-04,-5,Food',
      ',2026-10-05,-5,Food',
      '123e4567-e89b-12d3-a456-426614174000,2026-10-06,-5,Food',
    ].join('\n')
    const { ok, ids } = await read(text)
    expect(ok.every((r) => r.id === undefined)).toBe(true)
    expect(ids.every((i) => /^imp_[0-9a-f]{24}$/.test(i))).toBe(true)
    expect(new Set(ids).size).toBe(6)
  })

  it('writes an id repeated in one file once: the repeat gets a content id', async () => {
    const text = ['id,date,amount,category', 'Zp3kQ9aTn1xYb7VdLm2R,2026-10-01,-5,Food', 'Zp3kQ9aTn1xYb7VdLm2R,2026-10-02,-6,Food'].join('\n')
    const { ids } = await read(text)
    expect(ids[0]).toBe('Zp3kQ9aTn1xYb7VdLm2R')
    expect(ids[1]).toMatch(/^imp_[0-9a-f]{24}$/)
  })

  it('gives a copied row of an exported import an id of its own, not the id its original keeps', async () => {
    // The export of an imported entry carries its content id: a copy of the row with the id cleared (or repeated) would
    // hash to that same id and land on the original.
    const row: ImportRow = { kind: 'expense', amount: 500, categoryName: 'Food', date: '2026-10-01', note: '' }
    const original = await importRowId(row)
    const text = ['id,date,kind,amount,category,note', `${original},2026-10-01,expense,5.00,Food,`, ',2026-10-01,expense,5.00,Food,', `${original},2026-10-01,expense,5.00,Food,`].join('\n')
    const { ids } = await read(text)
    expect(ids[0]).toBe(original)
    // The copy and the repeat take the next counts of their content, whichever gets which, and the same ones every time.
    expect(ids.slice(1).sort()).toEqual([await importRowId(row, 1), await importRowId(row, 2)].sort())
    expect((await read(text)).ids).toEqual(ids)
  })

  it('takes exactly the shapes the app writes', () => {
    for (const id of ['Zp3kQ9aTn1xYb7VdLm2R', 'imp_0123456789abcdef01234567', 'rec_Tmpl0123456789abcdef_2026-10']) expect(ownId(id), id).toBe(id)
    expect(ownId(' Zp3kQ9aTn1xYb7VdLm2R ')).toBe('Zp3kQ9aTn1xYb7VdLm2R')
    for (const bad of ['', '1', '__x__', '..', '.', 'a/b', 'imp_XYZ', 'imp_0123456789ABCDEF01234567', 'rec_x_2026-13', 'Zp3kQ9aTn1xYb7VdLm2', 'Zp3kQ9aTn1xYb7VdLm2R1']) {
      expect(ownId(bad), bad).toBeUndefined()
    }
  })

  it('reads ids from the mapped column only', () => {
    const rows = [['2026-10-01', '-1', 'Food', 'Zp3kQ9aTn1xYb7VdLm2R']]
    const mapping: ColumnMapping = { date: 0, amount: 1, kind: null, category: 2, note: null, signMeansExpense: true }
    expect(applyMapping(rows, mapping, 2).ok[0].id).toBeUndefined()
    expect(applyMapping(rows, { ...mapping, id: null }, 2).ok[0].id).toBeUndefined()
    expect(applyMapping(rows, { ...mapping, id: 3 }, 2).ok[0].id).toBe('Zp3kQ9aTn1xYb7VdLm2R')
  })
})

describe('planCategories', () => {
  const cat = (id: string, name: string, kind: Category['kind'], order: number, archived = false): Category => ({
    id, name, kind, order, archived, icon: 'Gift', color: 'red',
  })
  const GROCERIES = cat('groceries', 'Groceries', 'expense', 0)
  const HOBBY = cat('hobby', 'Old hobby', 'expense', 9, true)
  const GIFTS = cat('gifts', 'Gifts', 'expense', 4)
  const SALARY = cat('salary', 'Salary', 'income', 2)
  const row = (kind: ImportRow['kind'], categoryName: string): ImportRow => ({ kind, amount: 100, categoryName, date: '2026-10-01', note: '' })

  it('matches existing categories by name whatever the case, archived ones included, within the kind of the row', () => {
    const plan = planCategories([row('expense', 'groceries'), row('expense', 'OLD HOBBY'), row('income', 'salary')], [GROCERIES, HOBBY, GIFTS, SALARY])
    expect(plan.create).toEqual([])
    expect([...plan.matched]).toEqual([
      ['expense|groceries', 'groceries'],
      ['expense|old hobby', 'hobby'],
      ['income|salary', 'salary'],
    ])
  })

  it('creates each missing name once per kind, at the next orders of its kind (archived ones counted), as CircleEllipsis on slate', () => {
    const plan = planCategories(
      [row('expense', 'Books'), row('expense', 'books'), row('income', 'Gifts'), row('expense', 'Pets'), row('expense', 'Gifts'), row('income', 'Bonus')],
      [GROCERIES, HOBBY, GIFTS, SALARY],
    )
    expect(plan.create).toEqual([
      { key: 'expense|books', input: { name: 'Books', icon: 'CircleEllipsis', color: 'slate', kind: 'expense', order: 10, archived: false } },
      // The expense "Gifts" does not serve income rows: categories come in separate sets per kind.
      { key: 'income|gifts', input: { name: 'Gifts', icon: 'CircleEllipsis', color: 'slate', kind: 'income', order: 3, archived: false } },
      { key: 'expense|pets', input: { name: 'Pets', icon: 'CircleEllipsis', color: 'slate', kind: 'expense', order: 11, archived: false } },
      { key: 'income|bonus', input: { name: 'Bonus', icon: 'CircleEllipsis', color: 'slate', kind: 'income', order: 4, archived: false } },
    ])
    expect([...plan.matched]).toEqual([['expense|gifts', 'gifts']])
  })

  it('prefers an active category to an archived one of the same name, and starts at order 0 for a kind with none', () => {
    const archivedFood = cat('food-old', 'Food', 'expense', 1, true)
    const activeFood = cat('food', 'food', 'expense', 5)
    const plan = planCategories([row('expense', 'FOOD'), row('income', 'Salary')], [archivedFood, activeFood])
    expect([...plan.matched]).toEqual([['expense|food', 'food']])
    expect(plan.create).toEqual([{ key: 'income|salary', input: { name: 'Salary', icon: 'CircleEllipsis', color: 'slate', kind: 'income', order: 0, archived: false } }])
  })
})
