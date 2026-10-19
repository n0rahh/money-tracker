import { describe, expect, it } from 'vitest'
import { foldForSearch, matchesSearch, matchingCaption, searchNeedle } from './search'

const expense = (note: string) => ({ kind: 'expense' as const, note })
const income = (note: string) => ({ kind: 'income' as const, note })

describe('foldForSearch', () => {
  it.each([
    ['Żabka', 'zabka'],
    ['ŁÓDŹ', 'lodz'], // "ł" has no decomposition of its own
    ['Gdańsk', 'gdansk'],
    ['Zażółć gęślą jaźń', 'zazolc gesla jazn'],
    ['Müller', 'muller'],
    ['Bäckerei', 'backerei'],
    ['Öl & Äpfel', 'ol & apfel'],
    ['Flat White', 'flat white'],
  ])('folds "%s" to "%s"', (text, folded) => {
    expect(foldForSearch(text)).toBe(folded)
  })
})

describe('searchNeedle', () => {
  it('folds the query and drops the spaces around it, not those inside it', () => {
    expect(searchNeedle('  Weekly SHOP ')).toBe('weekly shop')
    expect(searchNeedle(' Łódź ')).toBe('lodz')
    expect(searchNeedle('   ')).toBe('')
  })
})

describe('matchesSearch', () => {
  it('keeps every entry of the kind while nothing is typed', () => {
    expect(matchesSearch(expense('anything'), 'Coffee', '', 'all')).toBe(true)
    expect(matchesSearch(expense('anything'), 'Coffee', '', 'expense')).toBe(true)
    expect(matchesSearch(expense('anything'), 'Coffee', '', 'income')).toBe(false)
  })

  it('finds the query anywhere in the note or in the category name', () => {
    expect(matchesSearch(expense('weekly shop'), 'Groceries', searchNeedle('kly sh'), 'all')).toBe(true)
    expect(matchesSearch(expense(''), 'Coffee', searchNeedle('ffee'), 'all')).toBe(true)
    expect(matchesSearch(expense('weekly shop'), 'Groceries', searchNeedle('latte'), 'all')).toBe(false)
  })

  it('needs both the kind and the text', () => {
    expect(matchesSearch(income('Redocly'), 'Salary', searchNeedle('salary'), 'expense')).toBe(false)
    expect(matchesSearch(income('Redocly'), 'Salary', searchNeedle('salary'), 'income')).toBe(true)
    expect(matchesSearch(income('Redocly'), 'Salary', searchNeedle('rent'), 'income')).toBe(false)
  })

  it('ignores case and accents on both sides', () => {
    expect(matchesSearch(expense('Żabka'), 'Groceries', searchNeedle('zabka'), 'all')).toBe(true)
    expect(matchesSearch(expense('zabka on the corner'), 'Groceries', searchNeedle('ŻABKA'), 'all')).toBe(true)
    expect(matchesSearch(expense('trip'), 'Łódź', searchNeedle('lodz'), 'all')).toBe(true)
    expect(matchesSearch(expense(''), 'Bäckerei', searchNeedle('backer'), 'all')).toBe(true)
    expect(matchesSearch(expense('Café Müller'), 'Coffee', searchNeedle('cafe muller'), 'all')).toBe(true)
  })
})

describe('matchingCaption', () => {
  const money = (minor: number) => `€${(minor / 100).toFixed(2)}`

  it('counts the matching entries and adds up their amounts', () => {
    expect(matchingCaption(1, { expense: 420, income: 0 }, money)).toBe('1 matching entry · €4.20')
    expect(matchingCaption(3, { expense: 5770, income: 0 }, money)).toBe('3 matching entries · €57.70')
    expect(matchingCaption(1, { expense: 0, income: 300000 }, money)).toBe('1 matching entry · €3000.00')
  })

  it('keeps the kinds apart when both match, as the day headers do, never netted and on one line together', () => {
    expect(matchingCaption(3, { expense: 770, income: 300000 }, money)).toBe('3 matching entries · −€7.70\u00a0+€3000.00')
  })
})
