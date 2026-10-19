// node --test scripts/mmbak-dump.test.mjs (Node 24). Runs the script as the owner would, on throwaway files.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { cellText, toCsv } from './mmbak-dump.mjs'

const SCRIPT = fileURLToPath(new URL('./mmbak-dump.mjs', import.meta.url))
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })

let dir
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mmbak-dump-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** A small backup with the awkward cases: quotes, commas, line breaks, padding, NULL, a BLOB, a 64-bit integer, odd table names. */
function backup() {
  const file = join(dir, 'backup.mmbak')
  const db = new DatabaseSync(file)
  db.exec(`
    CREATE TABLE INOUTCOME (uid INTEGER PRIMARY KEY, ZDATE INTEGER, ZMONEY REAL, ZCONTENT TEXT, ZDATA BLOB, ZNULL TEXT);
    CREATE TABLE ZCATEGORY (uid INTEGER PRIMARY KEY AUTOINCREMENT, NAME TEXT);
    CREATE TABLE "odd/Name" (a TEXT);
    CREATE TABLE "Odd_name" (a TEXT);
    CREATE TABLE EMPTY (a TEXT);
  `)
  const insert = db.prepare('INSERT INTO INOUTCOME (ZDATE, ZMONEY, ZCONTENT, ZDATA, ZNULL) VALUES (?, ?, ?, ?, ?)')
  insert.run(9007199254740993n, 12.5, 'Milk, bread\nand "eggs"', new Uint8Array([1, 171, 255]), null)
  insert.run(1760400000000, -3, ' padded ', null, 'x')
  db.prepare('INSERT INTO ZCATEGORY (NAME) VALUES (?)').run('Jedzenie i picie')
  db.prepare('INSERT INTO "odd/Name" (a) VALUES (?)').run('slash')
  db.prepare('INSERT INTO "Odd_name" (a) VALUES (?)').run('same file name on macOS')
  db.close()
  return file
}

test('dumps every table to CSV with its header and prints the row counts', () => {
  const file = backup()
  const out = join(dir, 'out')
  const result = run(file, out)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(
    result.stdout,
    [
      'EMPTY: 0 rows → EMPTY.csv',
      'INOUTCOME: 2 rows → INOUTCOME.csv',
      'Odd_name: 1 row → Odd_name.csv',
      'ZCATEGORY: 1 row → ZCATEGORY.csv',
      'odd/Name: 1 row → odd_Name_2.csv',
      `5 tables written to ${out}`,
      '',
    ].join('\n'),
  )
  // SQLite's own sqlite_sequence (made by AUTOINCREMENT) is no data of the backup's.
  // "odd/Name" becomes odd_Name_2.csv: odd_Name.csv would overwrite Odd_name.csv on a case-insensitive disk (macOS).
  assert.deepEqual(readdirSync(out).sort(), ['EMPTY.csv', 'INOUTCOME.csv', 'Odd_name.csv', 'ZCATEGORY.csv', 'odd_Name_2.csv'])
  assert.equal(
    readFileSync(join(out, 'INOUTCOME.csv'), 'utf8'),
    '\uFEFFuid,ZDATE,ZMONEY,ZCONTENT,ZDATA,ZNULL\r\n' +
      '1,9007199254740993,12.5,"Milk, bread\nand ""eggs""",0x01abff,\r\n' +
      '2,1760400000000,-3," padded ",,x\r\n',
  )
  assert.equal(readFileSync(join(out, 'EMPTY.csv'), 'utf8'), '\uFEFFa\r\n')
  assert.equal(readFileSync(join(out, 'odd_Name_2.csv'), 'utf8'), '\uFEFFa\r\nslash\r\n')
  assert.equal(readFileSync(join(out, 'Odd_name.csv'), 'utf8'), '\uFEFFa\r\nsame file name on macOS\r\n')
})

test('opens the backup read-only: the file is byte for byte the same afterwards', () => {
  const file = backup()
  const before = readFileSync(file)
  assert.equal(run(file, join(dir, 'out')).status, 0)
  assert.deepEqual(readFileSync(file), before)
})

test('refuses a file that is not SQLite with a clear message and exit code 1, writing nothing', () => {
  const file = join(dir, 'export.mmbak')
  writeFileSync(file, 'Date,Amount\n2026-10-14,12.50\n')
  const out = join(dir, 'out')
  const result = run(file, out)
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, `${file} is not an SQLite database (it does not start with "SQLite format 3"), so it cannot be dumped this way. An encrypted backup looks the same.\n`)
  assert.throws(() => readdirSync(out), { code: 'ENOENT' })
})

test('says when the file is a ZIP archive', () => {
  const file = join(dir, 'backup.mmbak')
  writeFileSync(file, Buffer.from('PK\x03\x04rest of an archive', 'latin1'))
  const result = run(file, join(dir, 'out'))
  assert.equal(result.status, 1)
  assert.equal(result.stderr, `${file} is a ZIP archive, not an SQLite database: unzip it and run this script on the database inside.\n`)
})

test('refuses a file shorter than the SQLite header, and an empty one', () => {
  for (const content of ['SQLite', '']) {
    const file = join(dir, 'short.mmbak')
    writeFileSync(file, content)
    const result = run(file, join(dir, 'out'))
    assert.equal(result.status, 1)
    assert.match(result.stderr, /is not an SQLite database/)
  }
})

test('says so for a missing file', () => {
  const file = join(dir, 'nope.mmbak')
  const result = run(file, join(dir, 'out'))
  assert.equal(result.status, 1)
  assert.equal(result.stderr, `No such file: ${file}\n`)
})

test('reports a damaged database instead of crashing', () => {
  const file = join(dir, 'damaged.mmbak')
  writeFileSync(file, Buffer.concat([Buffer.from('SQLite format 3\0', 'latin1'), Buffer.alloc(200, 7)]))
  const result = run(file, join(dir, 'out'))
  assert.equal(result.status, 1)
  // Node may print its ExperimentalWarning for node:sqlite around the message.
  assert.ok(result.stderr.includes(`Could not read ${file}: `), result.stderr)
})

test('says so when the output folder cannot be written, not that the backup could not be read', () => {
  const file = backup()
  const notAFolder = join(dir, 'taken')
  writeFileSync(notAFolder, 'a file where the folder should go')
  const result = run(file, notAFolder)
  assert.equal(result.status, 1)
  assert.ok(result.stderr.includes(`Could not write to ${notAFolder}: `), result.stderr)
  assert.ok(!result.stderr.includes('Could not read'), result.stderr)
})

test('prints the usage and exits with 2 without two arguments', () => {
  for (const args of [[], ['only-one.mmbak'], ['a', 'b', 'c']]) {
    const result = run(...args)
    assert.equal(result.status, 2)
    assert.equal(result.stderr, 'Usage: node scripts/mmbak-dump.mjs <file.mmbak> <outDir>\n')
  }
})

test('writes cells as the CSV of the app: NULL empty, BLOB in hex, integers exactly', () => {
  assert.equal(cellText(null), '')
  assert.equal(cellText(new Uint8Array([0, 15, 255])), '0x000fff')
  assert.equal(cellText(9007199254740993n), '9007199254740993')
  assert.equal(cellText(12.5), '12.5')
  assert.equal(toCsv([['a,b', ' x', 'y;z'], ['', '"q"', 'z']]), '\uFEFF"a,b"," x","y;z"\r\n,"""q""",z\r\n')
})
