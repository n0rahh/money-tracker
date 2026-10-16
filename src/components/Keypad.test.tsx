import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Keypad } from './Keypad'

describe('Keypad', () => {
  it('reports every key press', async () => {
    const onPress = vi.fn()
    render(<Keypad onPress={onPress} />)
    await userEvent.click(screen.getByRole('button', { name: '7' }))
    await userEvent.click(screen.getByRole('button', { name: 'Decimal point' }))
    await userEvent.click(screen.getByRole('button', { name: 'Plus' }))
    await userEvent.click(screen.getByRole('button', { name: 'Backspace' }))
    await userEvent.click(screen.getByRole('button', { name: 'Equals' }))
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onPress.mock.calls.map((c) => c[0])).toEqual(['7', '.', '+', 'back', 'equals', 'clear'])
  })
  it('renders 16 keys and can disable the decimal point', () => {
    render(<Keypad onPress={() => {}} disableDecimal />)
    expect(screen.getAllByRole('button')).toHaveLength(16)
    expect(screen.getByRole('button', { name: 'Decimal point' })).toBeDisabled()
  })
})
