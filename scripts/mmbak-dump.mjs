#!/usr/bin/env node
// Dumps every table of a Money Manager (Realbyte) `.mmbak` backup, which is an SQLite database, to one CSV file per
// table, and prints how many rows each has: enough to see whether the data can go through Settings → Import CSV (spec
// §15.6). Schema-agnostic and read-only: nothing is converted, nothing is written to Firestore.
//
//   node scripts/mmbak-dump.mjs <file.mmbak> <outDir>
//
// Node 24 (node:sqlite, no flag; Node still prints an ExperimentalWarning for it). Exit code 0 when done, 1 when the file
// is not an SQLite database or cannot be read, 2 for wrong arguments. Standalone on purpose: it imports nothing from src.
import { closeSync, mkdirSync, openSync, readSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The CSV of src/lib/csv.ts's toCsv, line for line (a BOM, CRLF after every record, RFC 4180 quoting of a field with a
 * comma, a semicolon, a quote, a line break or a space at either end). Copied rather than imported: a test keeps the two
 * identical.
 */
export function toCsv(rows) {
  return `\uFEFF${rows.map((row) => `${row.map(csvField).join(',')}\r\n`).join('')}`
}

function csvField(value) {
  return /[",;\r\n]|^\s|\s$/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

/** A cell as CSV text: NULL as an empty field, integers exactly (they are read as BigInt), a BLOB as 0x and its bytes in hex. */
export function cellText(value) {
  if (value === null || value === undefined) return ''
  if (value instanceof Uint8Array) return `0x${Buffer.from(value).toString('hex')}`
  return String(value)
}

/** A failure the user can act on, printed as it is. */
class DumpError extends Error {}

/** The first bytes of the file, to tell an SQLite database from anything else before opening it. */
function startOf(file, length) {
  let fd
  try {
    fd = openSync(file, 'r')
  } catch (e) {
    if (e.code === 'ENOENT') throw new DumpError(`No such file: ${file}`)
    throw e
  }
  try {
    const buffer = Buffer.alloc(length)
    return buffer.subarray(0, readSync(fd, buffer, 0, length, 0))
  } finally {
    closeSync(fd)
  }
}

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1')
const ZIP_HEADER = Buffer.from('PK\x03\x04', 'latin1')

/** A file name for a table: unsafe characters become `_`, and a name already used (in any case, for macOS) gets a number. */
function fileNameFor(table, used) {
  const base = String(table).replace(/[^\w.-]+/g, '_').replace(/^\.+/, '_') || 'table'
  let name = base
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}_${n}`
  used.add(name.toLowerCase())
  return `${name}.csv`
}

/** The output folder, made when missing; a path that cannot be one (a file, say) is reported as such, not as a read error. */
function makeFolder(outDir) {
  try {
    mkdirSync(outDir, { recursive: true })
  } catch (e) {
    throw new DumpError(`Could not write to ${outDir}: ${e.message}`)
  }
}

async function writeTo(outDir, fileName, content) {
  try {
    await writeFile(join(outDir, fileName), content)
  } catch (e) {
    throw new DumpError(`Could not write to ${outDir}: ${e.message}`)
  }
}

/** Writes `<outDir>/<table>.csv` for every table but SQLite's own; returns each table with its row count and file. */
export async function dump(file, outDir) {
  const start = startOf(file, SQLITE_HEADER.length)
  if (start.subarray(0, ZIP_HEADER.length).equals(ZIP_HEADER)) {
    throw new DumpError(`${file} is a ZIP archive, not an SQLite database: unzip it and run this script on the database inside.`)
  }
  if (!start.equals(SQLITE_HEADER)) {
    throw new DumpError(`${file} is not an SQLite database (it does not start with "SQLite format 3"), so it cannot be dumped this way. An encrypted backup looks the same.`)
  }
  // Loaded only now: a test can import toCsv without loading SQLite.
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(file, { readOnly: true, readBigInts: true })
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name").all()
    makeFolder(outDir)
    const used = new Set()
    const written = []
    for (const { name } of tables) {
      const statement = db.prepare(`SELECT * FROM "${String(name).replaceAll('"', '""')}"`)
      statement.setReturnArrays(true)
      const columns = statement.columns().map((c) => c.name)
      const rows = statement.all().map((row) => row.map(cellText))
      const fileName = fileNameFor(name, used)
      await writeTo(outDir, fileName, toCsv([columns, ...rows]))
      written.push({ table: String(name), rows: rows.length, file: fileName })
    }
    return written
  } finally {
    db.close()
  }
}

async function main(args) {
  if (args.length !== 2) {
    console.error('Usage: node scripts/mmbak-dump.mjs <file.mmbak> <outDir>')
    return 2
  }
  const [file, outDir] = args
  try {
    const written = await dump(file, outDir)
    for (const { table, rows, file: name } of written) console.log(`${table}: ${rows} ${rows === 1 ? 'row' : 'rows'} → ${name}`)
    console.log(`${written.length} ${written.length === 1 ? 'table' : 'tables'} written to ${outDir}`)
    return 0
  } catch (e) {
    console.error(e instanceof DumpError ? e.message : `Could not read ${file}: ${e instanceof Error ? e.message : e}`)
    return 1
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2))
