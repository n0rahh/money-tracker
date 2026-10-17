import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { formatMoney } from '../lib/money'
import { BarChart } from './BarChart'

const eur = (minor: number) => formatMoney(minor, 'EUR', 'en')
const BARS = [
  { key: '2026-08', label: 'Aug', value: 4000, secondary: 1000 },
  { key: '2026-09', label: 'Sep', value: 8000, secondary: 0 },
  { key: '2026-10', label: 'Oct', value: 2000 },
]
const barOf = (name: RegExp) => within(screen.getByRole('button', { name })).getByTestId('bar')
const dotOf = (name: RegExp) => within(screen.getByRole('button', { name })).queryByTestId('dot')

describe('BarChart', () => {
  it('renders one button per bar, labelled with its value and, when given, its income', () => {
    render(<BarChart bars={BARS} formatValue={eur} ariaLabel="Spending by month" />)
    const group = screen.getByRole('group', { name: 'Spending by month' })
    expect(within(group).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Aug: €40.00, income €10.00',
      'Sep: €80.00, income €0.00',
      'Oct: €20.00',
    ])
  })

  it('scales every bar to the tallest one', () => {
    render(<BarChart bars={BARS} formatValue={eur} ariaLabel="Spending by month" />)
    expect(barOf(/^Sep/).style.height).toBe('100%')
    expect(barOf(/^Aug/).style.height).toBe('50%')
    expect(barOf(/^Oct/).style.height).toBe('25%')
  })

  it('puts income dots on the same scale as the bars', () => {
    render(
      <BarChart
        bars={[
          { key: '2026-01', label: 'Jan', value: 500, secondary: 1000 },
          { key: '2026-02', label: 'Feb', value: 250, secondary: 0 },
        ]}
        formatValue={eur}
        ariaLabel="Spending by month"
      />,
    )
    expect(barOf(/^Jan/).style.height).toBe('50%')
    expect(dotOf(/^Jan/)?.style.bottom).toBe('100%')
    expect(dotOf(/^Feb/)?.style.bottom).toBe('0%')
  })

  it('draws no income dot for a bar without income', () => {
    render(<BarChart bars={BARS} formatValue={eur} ariaLabel="Spending by month" />)
    expect(dotOf(/^Aug/)).not.toBeNull()
    expect(dotOf(/^Oct/)).toBeNull()
  })

  it('keeps bars and dots on the baseline for a range of zeros', () => {
    render(
      <BarChart
        bars={[
          { key: '2026-01', label: 'Jan', value: 0, secondary: 0 },
          { key: '2026-02', label: 'Feb', value: 0 },
        ]}
        formatValue={eur}
        ariaLabel="Spending by month"
      />,
    )
    expect(barOf(/^Jan/).style.height).toBe('0%')
    expect(barOf(/^Feb/).style.height).toBe('0%')
    expect(dotOf(/^Jan/)?.style.bottom).toBe('0%')
  })

  it('reports the key of the tapped bar', async () => {
    const onSelect = vi.fn()
    render(<BarChart bars={BARS} onSelect={onSelect} formatValue={eur} ariaLabel="Spending by month" />)
    await userEvent.click(screen.getByRole('button', { name: /^Sep/ }))
    expect(onSelect.mock.calls).toEqual([['2026-09']])
  })

  it('marks only the selected bar as pressed', () => {
    render(<BarChart bars={BARS} selectedKey="2026-09" formatValue={eur} ariaLabel="Spending by month" />)
    expect(screen.getAllByRole('button', { pressed: true }).map((b) => b.getAttribute('aria-label'))).toEqual(['Sep: €80.00, income €0.00'])
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(2)
  })

  it('shows a muted line instead of an empty chart', () => {
    render(<BarChart bars={[]} formatValue={eur} ariaLabel="Spending by month" />)
    expect(screen.getByText('No data for this range.')).toBeInTheDocument()
    expect(screen.queryByRole('group')).toBeNull()
  })
})
