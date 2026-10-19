import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BudgetField } from './BudgetField'

const field = () => screen.getByRole('textbox', { name: 'Monthly budget' })
const noBudget = () => screen.getByRole('button', { name: 'No budget' })
/** Intl separates a currency code from the amount with a no-break space. */
const NBSP = '\u00a0'

describe('BudgetField', () => {
  it('reads a typed decimal in minor units of the currency', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<BudgetField value={null} currency="PLN" locale="en" onChange={onChange} />)
    expect(field()).toHaveAttribute('inputmode', 'decimal')
    await user.type(field(), '499.99')
    expect(onChange).toHaveBeenLastCalledWith(49999)
    expect(field()).toBeValid()
    expect(field()).toHaveAccessibleDescription(`PLN${NBSP}499.99 a month`) // how the limit will read
  })

  it('rejects text that is not an amount with a hint, as NaN', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<BudgetField value={null} currency="PLN" locale="en" onChange={onChange} />)
    await user.type(field(), 'abc')
    expect(onChange).toHaveBeenLastCalledWith(NaN)
    expect(screen.getByText('Enter a number like 500 or 499.99')).toBeInTheDocument()
    expect(field()).toBeInvalid()
    expect(field()).toHaveAccessibleDescription('Enter a number like 500 or 499.99')

    await user.clear(field())
    await user.type(field(), '500')
    expect(onChange).toHaveBeenLastCalledWith(50000)
    expect(screen.queryByText('Enter a number like 500 or 499.99')).not.toBeInTheDocument()
  })

  // Zero is no limit, three decimals do not exist in PLN, and 10^11 minor units is past what the rules accept.
  it.each(['0', '0.00', '4.999', '-5', '1e3', '12.5.1', '1000000000'])('rejects "%s"', async (text) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<BudgetField value={null} currency="PLN" locale="en" onChange={onChange} />)
    await user.type(field(), text)
    expect(onChange).toHaveBeenLastCalledWith(NaN)
    expect(field()).toBeInvalid()
  })

  it.each([
    ['999999999.99', 99_999_999_999], // the largest limit the rules accept
    [' 12.5 ', 1250],
    ['12,5', 1250], // the decimal keypad shows a comma in regions that write one
    ['.5', 50],
  ])('accepts "%s" as %i', async (text, minor) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<BudgetField value={null} currency="PLN" locale="en" onChange={onChange} />)
    await user.type(field(), text)
    expect(onChange).toHaveBeenLastCalledWith(minor)
    expect(field()).toBeValid()
  })

  it('takes whole numbers only in a currency without minor units', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<BudgetField value={null} currency="JPY" locale="en" onChange={onChange} />)
    await user.type(field(), '1500')
    expect(onChange).toHaveBeenLastCalledWith(1500)
    expect(field()).toHaveAccessibleDescription('¥1,500 a month')
    await user.clear(field())
    await user.type(field(), '499.99')
    expect(onChange).toHaveBeenLastCalledWith(NaN)
    expect(field()).toHaveAccessibleDescription('Enter a whole number like 500')
  })

  it('clears the limit with "No budget", which stays enabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<BudgetField value={50000} currency="PLN" locale="en" onChange={onChange} />)
    expect(field()).toHaveValue('500')
    await user.click(noBudget())
    expect(onChange.mock.calls).toEqual([[null]])
    expect(field()).toHaveValue('')
    expect(field()).not.toHaveAccessibleDescription()
    expect(noBudget()).toBeEnabled() // disabled, it would drop the keyboard focus out of the sheet (browsers do; jsdom does not)
  })

  it('clears invalid text with "No budget" too, and an emptied field means no budget', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<BudgetField value={null} currency="PLN" locale="en" onChange={onChange} />)
    await user.type(field(), 'abc')
    await user.click(noBudget())
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(field()).toBeValid()

    await user.type(field(), '7')
    await user.clear(field())
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('shows the stored limit, also one that arrives after it opened, until it is edited', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(<BudgetField value={null} currency="PLN" locale="en" onChange={onChange} />)
    expect(field()).toHaveValue('')
    rerender(<BudgetField value={49990} currency="PLN" locale="en" onChange={onChange} />)
    expect(field()).toHaveValue('499.90')
    expect(onChange).not.toHaveBeenCalled() // only typing reports a limit

    await user.clear(field())
    await user.type(field(), '650')
    rerender(<BudgetField value={70000} currency="PLN" locale="en" onChange={onChange} />)
    expect(field()).toHaveValue('650') // what was typed stays
    expect(onChange).toHaveBeenLastCalledWith(65000)
  })
})
