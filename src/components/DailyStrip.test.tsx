import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { monthLabel } from '../lib/dates'
import { formatMoney } from '../lib/money'
import { DailyStrip } from './DailyStrip'

const eur = (minor: number) => formatMoney(minor, 'EUR', 'en')
// October 2026 (31 days) with spending on the 1st, the 16th and the 31st: €60.00 in total.
const october = Array.from({ length: 31 }, () => 0)
october[0] = 1250
october[15] = 4000
october[30] = 750

/** Clicks the strip at `clientX`. jsdom has no layout, so each test fakes the strip's box first. */
async function tapAt(strip: HTMLElement, clientX: number) {
  await userEvent.pointer({ keys: '[MouseLeft]', target: strip, coords: { clientX } })
}

describe('DailyStrip', () => {
  it('draws one column per day', () => {
    render(<DailyStrip values={october} month="2026-10" today="2026-10-17" onSelectDay={() => {}} formatValue={eur} />)
    expect(screen.getAllByTestId('day')).toHaveLength(31)
  })

  it('scales each day to the biggest one', () => {
    render(<DailyStrip values={october} month="2026-10" today="2026-10-17" onSelectDay={() => {}} formatValue={eur} />)
    const days = screen.getAllByTestId('day')
    expect(days[15].style.height).toBe('100%') // €40.00, the biggest day
    expect(days[0].style.height).toBe('31.25%') // €12.50
    expect(days[1].style.height).toBe('0%')
  })

  it('describes the month, its total and its length in a single image label', () => {
    render(<DailyStrip values={october} month="2026-10" today="2026-10-17" onSelectDay={() => {}} formatValue={eur} />)
    // Without a locale the month name comes out in the runtime's default locale.
    expect(screen.getByRole('img', { name: `Daily spending in ${monthLabel('2026-10')}: €60.00 over 31 days` })).toBeInTheDocument()
  })

  it('names the month in the given locale', () => {
    render(<DailyStrip values={october} month="2026-10" today="2026-10-17" locale="de" onSelectDay={() => {}} formatValue={eur} />)
    expect(screen.getByRole('img', { name: /^Daily spending in Oktober 2026: / })).toBeInTheDocument()
  })

  it('turns a tap into the date of the day under it', async () => {
    const onSelectDay = vi.fn()
    render(<DailyStrip values={october} month="2026-10" today="2026-10-17" onSelectDay={onSelectDay} formatValue={eur} />)
    const strip = screen.getByRole('img')
    vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 310 } as DOMRect)
    await tapAt(strip, 155) // 155 / 310 × 31 = 15.5 → the 16th column
    expect(onSelectDay.mock.calls).toEqual([['2026-10-16']])
  })

  it("keeps taps on the strip's edges inside the month", async () => {
    const onSelectDay = vi.fn()
    render(<DailyStrip values={october} month="2026-10" today="2026-10-17" onSelectDay={onSelectDay} formatValue={eur} />)
    const strip = screen.getByRole('img')
    // The box does not start at 0, so a tap only maps right when measured from its left edge.
    vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue({ left: 100.5, width: 310 } as DOMRect)
    await tapAt(strip, 100) // a whole-pixel tap left of a sub-pixel edge: day 0 before clamping
    await tapAt(strip, 410.5) // the right edge: day 32 before clamping
    expect(onSelectDay.mock.calls).toEqual([['2026-10-01'], ['2026-10-31']])
  })

  it('reads a tap on a strip without width as the first day, not as NaN', async () => {
    const onSelectDay = vi.fn()
    render(<DailyStrip values={october} month="2026-10" today="2026-10-17" onSelectDay={onSelectDay} formatValue={eur} />)
    const strip = screen.getByRole('img')
    vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 0 } as DOMRect) // not laid out
    await tapAt(strip, 0) // 0 / 0 would be NaN
    expect(onSelectDay.mock.calls).toEqual([['2026-10-01']])
  })

  it('highlights today and dims the days after it, in the current month only', () => {
    const strip = (month: string, today: string) => <DailyStrip values={october} month={month} today={today} onSelectDay={() => {}} formatValue={eur} />
    const { rerender } = render(strip('2026-10', '2026-10-17'))
    const days = screen.getAllByTestId('day')
    expect(days[15]).toHaveClass('bg-expense/70') // the 16th: past
    expect(days[16]).toHaveClass('bg-accent') // the 17th: today
    expect(days[17]).toHaveClass('bg-surface-2') // the 18th: still to come
    expect(days[30]).toHaveClass('bg-surface-2')
    // Any other month has no today and nothing still to come.
    for (const today of ['2026-11-17', '2026-09-17']) {
      rerender(strip('2026-10', today))
      for (const day of screen.getAllByTestId('day')) expect(day).toHaveClass('bg-expense/70')
    }
  })

  it.each([
    { month: '2026-02', length: 28 },
    { month: '2028-02', length: 29 },
    { month: '2026-09', length: 30 },
    { month: '2026-10', length: 31 },
  ])('follows a $length-day month in its label and its taps', async ({ month, length }) => {
    const onSelectDay = vi.fn()
    render(<DailyStrip values={Array.from({ length }, () => 0)} month={month} today="2026-12-01" onSelectDay={onSelectDay} formatValue={eur} />)
    const strip = screen.getByRole('img')
    expect(strip).toHaveAccessibleName(`Daily spending in ${monthLabel(month)}: €0.00 over ${length} days`)
    vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue({ left: 0, width: length * 10 } as DOMRect)
    await tapAt(strip, length * 10) // the right edge
    expect(onSelectDay.mock.calls).toEqual([[`${month}-${length}`]])
  })
})
