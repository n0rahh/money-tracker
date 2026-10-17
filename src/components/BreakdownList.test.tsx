import { render, screen } from '@testing-library/react'
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
})
