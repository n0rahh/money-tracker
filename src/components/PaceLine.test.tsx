import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Pace } from '../lib/stats'
import { PaceLine } from './PaceLine'

const MINUS = '\u2212' // DeltaBadge's true minus sign, not the ASCII hyphen-minus

/** Renders the line and returns all of its text, the badge included. */
function lineFor(pace: Pace) {
  render(<PaceLine pace={pace} currency="EUR" locale="en" />)
  return screen.getByText(/ by day /).textContent
}

describe('PaceLine', () => {
  it('compares the spending so far with the same days of last month and badges a rise', () => {
    expect(lineFor({ spentToDate: 10700, previousToDate: 10000, dayOfMonth: 14, deltaPct: 7 })).toBe('€107.00 by day 14 · last month by day 14: €100.00 +7 %')
    expect(screen.getByText('+7 %')).toBeInTheDocument() // a badge of its own, not words in the sentence
  })

  it('badges a fall with a true minus', () => {
    // Spec §7's example.
    expect(lineFor({ spentToDate: 124000, previousToDate: 141000, dayOfMonth: 14, deltaPct: -12 })).toBe(
      `€1,240.00 by day 14 · last month by day 14: €1,410.00 ${MINUS}12 %`,
    )
    expect(screen.getByText(`${MINUS}12 %`)).toBeInTheDocument()
  })

  it('says "no data for last month" without a badge when last month had nothing by that day', () => {
    expect(lineFor({ spentToDate: 5000, previousToDate: 0, dayOfMonth: 3, deltaPct: null })).toBe('€50.00 by day 3 · no data for last month')
    expect(screen.queryByText('new')).not.toBeInTheDocument() // DeltaBadge's word for "nothing before" does not belong here
  })
})
