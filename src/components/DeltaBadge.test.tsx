import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DeltaBadge } from './DeltaBadge'

const MINUS = '\u2212' // a true minus sign, not the ASCII hyphen-minus

describe('DeltaBadge', () => {
  it.each([
    { name: '"new" when there was nothing before', deltaPct: null, previous: 0, text: 'new' },
    { name: 'a vanished amount as minus 100 %', deltaPct: -100, previous: 2500, text: `${MINUS}100 %` },
    { name: 'an increase with a plus', deltaPct: 12, previous: 2500, text: '+12 %' },
    { name: 'a decrease with a true minus', deltaPct: -5, previous: 2500, text: `${MINUS}5 %` },
    { name: 'no change without a sign', deltaPct: 0, previous: 2500, text: '0 %' },
  ])('shows $name', ({ deltaPct, previous, text }) => {
    render(<DeltaBadge deltaPct={deltaPct} previous={previous} />)
    // Exact match: a substring check would also accept "+0 %" where "0 %" is expected.
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('shows nothing when a percentage is missing although there was a previous amount', () => {
    const { container } = render(<DeltaBadge deltaPct={null} previous={2500} />)
    expect(container).toBeEmptyDOMElement()
  })
})
