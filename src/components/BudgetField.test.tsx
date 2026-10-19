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

  it('announces the hint as it appears, and only while the text is not an amount', async () => {
    const user = userEvent.setup()
    render(<BudgetField value={null} currency="PLN" locale="en" onChange={vi.fn()} />)
    await user.type(field(), '12')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument() // the read-back of a valid limit is not an alert
    await user.type(field(), 'x')
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a number like 500 or 499.99')
    await user.type(field(), '{Backspace}')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each(['0', '0.00', '0,0', '00'])('asks for an amount above 0 for "%s", or for No budget', async (text) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<BudgetField value={null} currency="PLN" locale="en" onChange={onChange} />)
    await user.type(field(), text)
    expect(onChange).toHaveBeenLastCalledWith(NaN)
    expect(field()).toHaveAccessibleDescription('Enter an amount above 0, or tap No budget')
  })

  it.each([
    ['JPY', 1500, '1500'],
    ['JPY', 50000, '50000'],
    ['KWD', 1500, '1.500'],
    ['KWD', 2000, '2'],
    ['CLF', 10000, '1'],
  ])('shows a stored %s limit of %i minor units as "%s"', (currency, minor, text) => {
    render(<BudgetField value={minor} currency={currency} locale="en" onChange={vi.fn()} />)
    expect(field()).toHaveValue(text)
  })

  it.each([
    ['JPY', 'Enter a whole number like 500'],
    ['PLN', 'Enter a number like 500 or 499.99'],
    ['KWD', 'Enter a number like 500 or 499.999'],
    ['CLF', 'Enter a number like 500 or 499.9999'],
  ])('hints the digits of %s', async (currency, hint) => {
    const user = userEvent.setup()
    render(<BudgetField value={null} currency={currency} locale="en" onChange={vi.fn()} />)
    await user.type(field(), 'x')
    expect(field()).toHaveAccessibleDescription(hint)
  })

  it('reads the limit back in the locale of the settings', async () => {
    const user = userEvent.setup()
    render(<BudgetField value={null} currency="PLN" locale="de" onChange={vi.fn()} />)
    await user.type(field(), '1500')
    expect(field()).toHaveAccessibleDescription(`1.500,00${NBSP}PLN a month`)
  })

  it('takes a field of spaces for no budget', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<BudgetField value={null} currency="PLN" locale="en" onChange={onChange} />)
    await user.type(field(), '  ')
    expect(onChange).toHaveBeenLastCalledWith(null)
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
