import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { CategoryDelta, CategoryTotal } from '../lib/stats'
import type { Category } from '../lib/types'
import { BreakdownList } from './BreakdownList'

const COFFEE: Category = { id: 'c1', name: 'Coffee', icon: 'Coffee', color: 'amber', kind: 'expense', order: 0, archived: false }
const byId = new Map([[COFFEE.id, COFFEE]])
const rows: CategoryTotal[] = [{ categoryId: COFFEE.id, total: 770, count: 2, share: 1 }]
/** Coffee and a category removed by hand in the console, which has no page to open. */
const withRemoved: CategoryTotal[] = [
  { categoryId: 'removed-in-console', total: 1200, count: 1, share: 0.61 },
  { categoryId: COFFEE.id, total: 770, count: 2, share: 0.39 },
]
const deltas = new Map<string, CategoryDelta>([[COFFEE.id, { categoryId: COFFEE.id, current: 770, previous: 1500, delta: -730, deltaPct: -49 }]])

describe('BreakdownList', () => {
  it('explains the badges with "vs previous month" only when it shows changes', () => {
    const { rerender } = render(<BreakdownList rows={rows} byId={byId} currency="EUR" locale="en" />)
    expect(screen.queryByText('vs previous month')).not.toBeInTheDocument()

    rerender(<BreakdownList rows={rows} byId={byId} currency="EUR" locale="en" deltas={deltas} />)
    expect(screen.getByText('vs previous month')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(/^By category$/) // the legend is not part of the heading

    rerender(<BreakdownList rows={rows} byId={byId} currency="EUR" locale="en" deltas={deltas} legend="vs last month to date" />)
    expect(screen.getByText('vs last month to date')).toBeInTheDocument()
    expect(screen.queryByText('vs previous month')).not.toBeInTheDocument()
  })

  it('makes the rows buttons only when it is given onSelect, which receives the category id', async () => {
    const onSelect = vi.fn()
    const { rerender } = render(<BreakdownList rows={rows} byId={byId} currency="EUR" locale="en" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    rerender(<BreakdownList rows={rows} byId={byId} currency="EUR" locale="en" onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: /^Coffee/ }))
    expect(onSelect.mock.calls).toEqual([[COFFEE.id]])
  })

  it('leaves the row of a removed category plain: it has no page to open', async () => {
    const onSelect = vi.fn()
    render(<BreakdownList rows={withRemoved} byId={byId} currency="EUR" locale="en" onSelect={onSelect} />)
    expect(screen.getAllByRole('listitem').map((row) => row.textContent)).toEqual([expect.stringMatching(/^Uncategorized€12\.00/), expect.stringMatching(/^Coffee€7\.70/)])
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([expect.stringMatching(/^Coffee/)])
    await userEvent.click(screen.getByText('Uncategorized'))
    expect(onSelect).not.toHaveBeenCalled()
  })

  describe('with budgets', () => {
    const GROCERIES: Category = { id: 'c2', name: 'Groceries', icon: 'ShoppingCart', color: 'emerald', kind: 'expense', order: 1, archived: false }
    const TAXI: Category = { id: 'c3', name: 'Taxi', icon: 'Car', color: 'yellow', kind: 'expense', order: 2, archived: false }
    const all = new Map([COFFEE, GROCERIES, TAXI].map((c) => [c.id, c]))
    /** Coffee may spend PLN 500.00 a month. */
    const budgets = new Map([[COFFEE.id, 50000]])
    const coffeeAt = (total: number): CategoryTotal[] => [{ categoryId: COFFEE.id, total, count: total > 0 ? 1 : 0, share: total > 0 ? 1 : 0 }]
    const rowOf = (name: string) => screen.getAllByRole('listitem').find((row) => row.textContent?.startsWith(name)) as HTMLElement
    const barOf = (name: string) => within(rowOf(name)).getByTestId('bar')
    /** A row's text with the no-break space Intl puts after a currency code read as a plain space. */
    const textOf = (row: HTMLElement) => row.textContent?.replaceAll('\u00a0', ' ')

    // Spec §9: progress is the month total over the limit; from 100 % on the bar is full and expense-coloured.
    it.each([
      { pct: '50 %', total: 25000, width: '50%', expense: false },
      { pct: '100 %', total: 50000, width: '100%', expense: true },
      { pct: '150 %', total: 75000, width: '100%', expense: true },
      { pct: '0 %', total: 0, width: '0%', expense: false },
    ])('fills the bar to the budget at $pct, in the expense colour only from 100 %', ({ total, width, expense }) => {
      render(<BreakdownList rows={coffeeAt(total)} byId={byId} currency="PLN" locale="en" budgets={budgets} />)
      const bar = barOf('Coffee')
      expect(bar.style.width).toBe(width)
      expect(bar.classList.contains('bg-expense')).toBe(expense)
      expect(bar.style.background).toBe(expense ? '' : 'rgb(251, 191, 36)') // else Coffee's own amber
    })

    it('reads "<spent> of <budget>" in place of the share', () => {
      render(<BreakdownList rows={coffeeAt(32000)} byId={byId} currency="PLN" locale="en" budgets={budgets} />)
      const text = screen.getByText('PLN 320.00 of PLN 500.00')
      expect(text).toHaveClass('tnum', 'text-xs', 'text-muted')
      expect(textOf(rowOf('Coffee'))).toBe('CoffeePLN 320.00PLN 320.00 of PLN 500.00') // the amount stays, the share goes
      expect(barOf('Coffee').style.width).toBe('64%')
    })

    it('shows a budget with nothing spent yet as an empty bar', () => {
      render(<BreakdownList rows={coffeeAt(0)} byId={byId} currency="PLN" locale="en" budgets={budgets} />)
      expect(screen.getByText('PLN 0.00 of PLN 500.00')).toBeInTheDocument()
      expect(barOf('Coffee').style.width).toBe('0%')
    })

    it('keeps the share and the scale of the largest row for rows without a budget', () => {
      const rows: CategoryTotal[] = [
        { categoryId: GROCERIES.id, total: 80000, count: 4, share: 0.606 },
        { categoryId: COFFEE.id, total: 32000, count: 9, share: 0.242 },
        { categoryId: TAXI.id, total: 20000, count: 2, share: 0.152 },
      ]
      render(<BreakdownList rows={rows} byId={all} currency="PLN" locale="en" budgets={budgets} />)
      expect(screen.getAllByRole('listitem').map(textOf)).toEqual([
        'GroceriesPLN 800.0061%',
        'CoffeePLN 320.00PLN 320.00 of PLN 500.00',
        'TaxiPLN 200.0015%',
      ])
      expect(barOf('Groceries').style.width).toBe('100%')
      expect(barOf('Coffee').style.width).toBe('64%') // against its budget, not against Groceries
      expect(barOf('Taxi').style.width).toBe('25%')
      expect(barOf('Taxi').style.background).toBe('rgb(250, 204, 21)') // yellow
    })

    it('puts the budget text before the badge of a row that has one', () => {
      render(<BreakdownList rows={coffeeAt(32000)} byId={byId} currency="PLN" locale="en" budgets={budgets} deltas={deltas} />)
      expect(textOf(rowOf('Coffee'))).toBe('CoffeePLN 320.00PLN 320.00 of PLN 500.00−49 %')
    })
  })
})
