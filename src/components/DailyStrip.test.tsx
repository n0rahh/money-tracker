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
    // There is no locale prop, so the month name comes out in the runtime's default locale.
    expect(screen.getByRole('img', { name: `Daily spending in ${monthLabel('2026-10')}: €60.00 over 31 days` })).toBeInTheDocument()
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
})
