import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AmountDisplay } from './AmountDisplay'

describe('AmountDisplay', () => {
  it('shows the expression and its evaluated value', () => {
    render(<AmountDisplay state={{ expr: '12.5+3' }} currency="EUR" locale="en" kind="expense" />)
    expect(screen.getByTestId('amount-expr')).toHaveTextContent('12.5 + 3')
    expect(screen.getByTestId('amount-total')).toHaveTextContent('= €15.50')
  })
  it('shows 0 for an empty expression without an equals sign', () => {
    render(<AmountDisplay state={{ expr: '' }} currency="EUR" locale="en" kind="expense" />)
    expect(screen.getByTestId('amount-expr')).toHaveTextContent('0')
    expect(screen.getByTestId('amount-total')).toHaveTextContent('€0.00')
    expect(screen.getByTestId('amount-total')).not.toHaveTextContent('=')
  })
})
