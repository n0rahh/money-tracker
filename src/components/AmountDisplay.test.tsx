import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AmountDisplay } from './AmountDisplay'

describe('AmountDisplay', () => {
  it('shows the expression and its evaluated value', () => {
    render(<AmountDisplay state={{ expr: '12.5+3' }} currency="EUR" locale="en" kind="expense" />)
    expect(screen.getByTestId('amount-expr')).toHaveTextContent('12.5+3')
    expect(screen.getByTestId('amount-total')).toHaveTextContent('= €15.50')
  })
  it('shows 0 for an empty expression without an equals sign', () => {
    render(<AmountDisplay state={{ expr: '' }} currency="EUR" locale="en" kind="expense" />)
    expect(screen.getByTestId('amount-expr')).toHaveTextContent('0')
    expect(screen.getByTestId('amount-total')).toHaveTextContent('€0.00')
    expect(screen.getByTestId('amount-total')).not.toHaveTextContent('=')
  })
  it("uses the currency's minor-unit digits", () => {
    const { rerender } = render(<AmountDisplay state={{ expr: '1500' }} currency="JPY" locale="en" kind="expense" />)
    expect(screen.getByTestId('amount-total')).toHaveTextContent(/^¥1,500$/)
    rerender(<AmountDisplay state={{ expr: '1.5' }} currency="KWD" locale="en" kind="expense" />)
    expect(screen.getByTestId('amount-total')).toHaveTextContent(/1\.500$/)
  })
  it('shows the minus sign as a true minus', () => {
    render(<AmountDisplay state={{ expr: '10-2.25' }} currency="EUR" locale="en" kind="expense" />)
    expect(screen.getByTestId('amount-expr')).toHaveTextContent('10−2.25')
    expect(screen.getByTestId('amount-total')).toHaveTextContent('= €7.75')
  })
  it('shrinks long expressions instead of clipping them', () => {
    const { rerender } = render(<AmountDisplay state={{ expr: '12' }} currency="EUR" locale="en" kind="expense" />)
    expect(screen.getByTestId('amount-expr')).toHaveAttribute('data-size', 'lg')
    rerender(<AmountDisplay state={{ expr: '123456789.12+1' }} currency="EUR" locale="en" kind="expense" />)
    expect(screen.getByTestId('amount-expr')).toHaveAttribute('data-size', 'md')
    rerender(<AmountDisplay state={{ expr: '123456789.12+123456789.12' }} currency="EUR" locale="en" kind="expense" />)
    expect(screen.getByTestId('amount-expr')).toHaveAttribute('data-size', 'sm')
  })
})
