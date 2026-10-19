import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SearchBar } from './SearchBar'

const field = () => screen.getByRole('searchbox', { name: 'Search notes and categories' })
const clear = () => screen.queryByRole('button', { name: 'Clear search' })

describe('SearchBar', () => {
  it('is a 44 px search field for notes and categories that takes the focus as it appears', () => {
    render(<SearchBar value="" onChange={vi.fn()} kind="all" onKindChange={vi.fn()} />)
    expect(screen.getByRole('search')).toContainElement(field())
    expect(field()).toHaveAttribute('type', 'search')
    expect(field()).toHaveAttribute('placeholder', 'Search notes and categories')
    expect(field()).toHaveClass('h-11')
    expect(field()).toHaveFocus()
  })

  it('reports what is typed', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SearchBar value="oat" onChange={onChange} kind="all" onKindChange={vi.fn()} />)
    await user.type(field(), 's')
    expect(onChange.mock.calls).toEqual([['oats']])
  })

  it('offers a 44 px clear button while there is text, which empties the field and keeps the focus in it', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(<SearchBar value="" onChange={onChange} kind="all" onKindChange={vi.fn()} />)
    expect(clear()).not.toBeInTheDocument()

    rerender(<SearchBar value="latte" onChange={onChange} kind="all" onKindChange={vi.fn()} />)
    expect(clear()).toHaveClass('size-11')
    await user.click(clear() as HTMLElement)
    expect(onChange.mock.calls).toEqual([['']])
    expect(field()).toHaveFocus()
  })

  it('puts the keyboard away on the search key', async () => {
    const user = userEvent.setup()
    render(<SearchBar value="latte" onChange={vi.fn()} kind="all" onKindChange={vi.fn()} />)
    await user.keyboard('{Enter}')
    expect(field()).not.toHaveFocus()
  })

  it('narrows by kind: All, Expenses or Income', async () => {
    const user = userEvent.setup()
    const onKindChange = vi.fn()
    render(<SearchBar value="" onChange={vi.fn()} kind="expense" onKindChange={onKindChange} />)
    const kinds = within(screen.getByRole('radiogroup', { name: 'Kind' })).getAllByRole('radio')
    expect(kinds.map((k) => [k.textContent, k.getAttribute('aria-checked')])).toEqual([
      ['All', 'false'],
      ['Expenses', 'true'],
      ['Income', 'false'],
    ])
    await user.click(screen.getByRole('radio', { name: 'Income' }))
    await user.click(screen.getByRole('radio', { name: 'All' }))
    expect(onKindChange.mock.calls).toEqual([['income'], ['all']])
  })
})
