import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MonthPickerSheet } from './MonthPickerSheet'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function setup(month = '2026-10', locale: string | null = 'en') {
  const onSelect = vi.fn()
  const onClose = vi.fn()
  const view = render(<MonthPickerSheet open month={month} locale={locale} onSelect={onSelect} onClose={onClose} />)
  return { onSelect, onClose, ...view }
}
/** The month buttons, as the group named by the year on show holds them. */
const monthsOf = (year: string) => within(screen.getByRole('group', { name: year })).getAllByRole('button')
const pressed = (buttons: HTMLElement[]) => buttons.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)

describe('MonthPickerSheet', () => {
  it("opens on the shown month's year: its twelve months as 44 px buttons, the shown one pressed", () => {
    setup('2026-10')
    expect(screen.getByRole('dialog', { name: 'Choose month' })).toBeInTheDocument()
    const months = monthsOf('2026')
    expect(months.map((b) => b.textContent)).toEqual(MONTHS)
    expect(months.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'false', 'true', 'false', 'false'])
    for (const b of months) expect(b).toHaveClass('min-h-11')
  })

  it('picks a month: reports it and closes', async () => {
    const user = userEvent.setup()
    const { onSelect, onClose } = setup('2026-10')
    await user.click(screen.getByRole('button', { name: 'July' }))
    expect(onSelect.mock.calls).toEqual([['2026-07']])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('browses the years with 44 px arrows that pick nothing; a month is picked in the year on show', async () => {
    const user = userEvent.setup()
    const { onSelect, onClose } = setup('2026-01')
    const previous = screen.getByRole('button', { name: 'Previous year' })
    expect(previous).toHaveClass('size-11')
    expect(screen.getByRole('button', { name: 'Next year' })).toHaveClass('size-11')

    await user.click(previous)
    expect(pressed(monthsOf('2025'))).toEqual([]) // January 2025 is not the month on Home
    expect(screen.getByText('2025')).toHaveAttribute('aria-live', 'polite') // the arrow keeps the focus: the new year is read out
    expect(onSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'December' }))
    expect(onSelect.mock.calls).toEqual([['2025-12']])
  })

  it('reaches the years ahead, whose months can be picked too, and comes back to the shown one', async () => {
    const user = userEvent.setup()
    const { onSelect } = setup('2026-10')
    await user.click(screen.getByRole('button', { name: 'Next year' }))
    await user.click(screen.getByRole('button', { name: 'Next year' }))
    expect(pressed(monthsOf('2028'))).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Previous year' }))
    await user.click(screen.getByRole('button', { name: 'Previous year' }))
    expect(pressed(monthsOf('2026'))).toEqual(['October'])

    await user.click(screen.getByRole('button', { name: 'Next year' }))
    const march = screen.getByRole('button', { name: 'March' })
    expect(march).toBeEnabled()
    await user.click(march)
    expect(onSelect.mock.calls).toEqual([['2027-03']])
  })

  it("starts again from the shown month's year each time it opens", async () => {
    const user = userEvent.setup()
    const props = { locale: 'en', onSelect: vi.fn(), onClose: vi.fn() }
    const { rerender } = render(<MonthPickerSheet open month="2026-10" {...props} />)
    await user.click(screen.getByRole('button', { name: 'Previous year' }))
    expect(monthsOf('2025')).toHaveLength(12)

    rerender(<MonthPickerSheet open={false} month="2026-10" {...props} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    rerender(<MonthPickerSheet open month="2024-03" {...props} />)
    expect(pressed(monthsOf('2024'))).toEqual(['March'])
  })

  it('names the months in the language of the settings', () => {
    setup('2026-10', 'de')
    expect(monthsOf('2026').map((b) => b.textContent)).toEqual([
      'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
    ])
  })
})
