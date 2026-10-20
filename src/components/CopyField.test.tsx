import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../context/ToastContext'
import { CopyField } from './CopyField'

const KEY = 'AIzaSyD-example_key-0123456789abcdefghi'
const CATEGORIES = '{\n  "Groceries": "c1",\n  "Coffee": "c2"\n}'

const field = (props: Parameters<typeof CopyField>[0]) =>
  render(
    <ToastProvider>
      <CopyField {...props} />
    </ToastProvider>,
  )

afterEach(() => {
  vi.restoreAllMocks()
})

describe('CopyField', () => {
  it('shows a one-line value under its label, as code, with its hint', () => {
    field({ label: 'Web API key', value: KEY, hint: 'Public by design.' })
    const group = screen.getByRole('group', { name: 'Web API key' })
    expect(within(group).getByText(KEY).tagName).toBe('CODE')
    expect(within(group).getByText('Public by design.')).toBeInTheDocument()
  })

  it('shows text of several lines in a read-only text area with a row per line, eight at most', () => {
    const { unmount } = field({ label: 'Expense categories', value: CATEGORIES, multiline: true })
    const area = screen.getByRole('textbox', { name: 'Expense categories' })
    expect(area.tagName).toBe('TEXTAREA')
    expect(area).toHaveValue(CATEGORIES)
    expect(area).toHaveAttribute('readonly')
    // Four lines (three line breaks): four rows.
    expect(area).toHaveAttribute('rows', '4')
    unmount()

    const lines = (count: number) => Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n')
    for (const [value, rows] of [['{}', '1'], [lines(8), '8'], [lines(9), '8'], [lines(12), '8']]) {
      const { unmount: next } = field({ label: 'Expense categories', value, multiline: true })
      expect(screen.getByRole('textbox', { name: 'Expense categories' })).toHaveAttribute('rows', rows)
      next()
    }
  })

  it('has a Copy button of at least 44 px that names what it copies', () => {
    field({ label: 'Project id', value: 'money-tracker-vlad' })
    expect(screen.getByRole('button', { name: 'Copy Project id' })).toHaveClass('min-h-11')
  })

  it('writes the value to the clipboard within the tap and says so', async () => {
    userEvent.setup() // its in-memory clipboard stands in for the system's
    const writeText = vi.spyOn(navigator.clipboard, 'writeText')
    field({ label: 'Project id', value: 'money-tracker-vlad' })
    fireEvent.click(screen.getByRole('button', { name: 'Copy Project id' }))
    // Before anything is awaited: iOS lets a page write to the clipboard only from within a tap.
    expect(writeText).toHaveBeenCalledWith('money-tracker-vlad')
    expect(await screen.findByRole('status')).toHaveTextContent('Copied')
    expect(await navigator.clipboard.readText()).toBe('money-tracker-vlad')
  })

  it('selects the text for copying by hand when the clipboard refuses it', async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new DOMException('Write permission denied.', 'NotAllowedError'))
    field({ label: 'Expense categories', value: CATEGORIES, multiline: true })
    await user.click(screen.getByRole('button', { name: 'Copy Expense categories' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Select and copy the text')
    const area = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Expense categories' })
    expect(document.activeElement).toBe(area)
    expect([area.selectionStart, area.selectionEnd]).toEqual([0, CATEGORIES.length])
  })

  it('selects a one-line value when there is no clipboard at all', async () => {
    const user = userEvent.setup()
    // As outside a secure context, where browsers leave navigator.clipboard out.
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    field({ label: 'Web API key', value: KEY })
    await user.click(screen.getByRole('button', { name: 'Copy Web API key' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Select and copy the text')
    expect(document.activeElement).toBe(screen.getByText(KEY))
    expect(window.getSelection()?.toString()).toBe(KEY)
  })
})
