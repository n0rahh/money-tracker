import type { KindTotals } from './stats'
import type { Kind, Transaction } from './types'

/** The entries a search keeps by kind: both kinds, or one of them. */
export type KindFilter = 'all' | Kind

/**
 * Text as a search compares it: lower-case and without accents, so "zabka" finds "Żabka" and "muller" finds "Müller". NFD
 * splits each letter from its marks, which are dropped; "ł" has no decomposition, hence a replacement of its own.
 */
export function foldForSearch(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l')
}

/** The query as the entries are compared with it: folded, without the spaces around it. An empty needle keeps every entry. */
export function searchNeedle(query: string): string {
  return foldForSearch(query.trim())
}

/**
 * Whether a search keeps an entry: its kind fits, and the needle is part of its note or of its category's name (the name as
 * the list shows it), anywhere in either, both folded like the needle.
 */
export function matchesSearch(entry: Pick<Transaction, 'kind' | 'note'>, categoryName: string, needle: string, kind: KindFilter): boolean {
  if (kind !== 'all' && entry.kind !== kind) return false
  return needle === '' || foldForSearch(entry.note).includes(needle) || foldForSearch(categoryName).includes(needle)
}

/**
 * The caption over one or more matching entries: how many, and what they add up to ("3 matching entries · €120.00").
 * Entries of both kinds keep their totals apart, as the day headers do ("−€7.70 +€3,000.00"), there is no net; the two
 * stay on one line (a no-break space), so a caption too long for a phone breaks after the count instead.
 */
export function matchingCaption(count: number, totals: Pick<KindTotals, 'expense' | 'income'>, money: (minor: number) => string): string {
  const entries = `${count} matching ${count === 1 ? 'entry' : 'entries'}`
  const sum = totals.expense > 0 && totals.income > 0 ? `−${money(totals.expense)}\u00a0+${money(totals.income)}` : money(totals.expense + totals.income)
  return `${entries} · ${sum}`
}
