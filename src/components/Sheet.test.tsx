import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Sheet } from './Sheet'

/** The scrim is rendered immediately before the dialog inside the overlay. */
const scrimOf = (dialog: HTMLElement) => dialog.previousElementSibling as HTMLElement

describe('Sheet', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<Sheet open={false} title="Title" onClose={() => {}}>Body</Sheet>)
    expect(container).toBeEmptyDOMElement()
  })

  it('is a dialog labelled by its title and takes focus on mount', () => {
    render(<Sheet open title="Choose currency" onClose={() => {}}>Body</Sheet>)
    const dialog = screen.getByRole('dialog', { name: 'Choose currency' })
    const heading = screen.getByRole('heading', { name: 'Choose currency' })
    expect(dialog).toHaveAttribute('aria-labelledby', heading.id)
    expect(dialog).not.toHaveAttribute('aria-label')
    expect(document.activeElement).toBe(dialog)
  })

  it('applies bodyClassName to the scroll container', () => {
    render(<Sheet open title="Title" onClose={() => {}} bodyClassName="scroll-pt-44">Body</Sheet>)
    expect(screen.getByText('Body')).toHaveClass('scroll-pt-44')
  })

  describe('dismissible (default)', () => {
    it('the Close button calls onClose', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      render(<Sheet open title="Title" onClose={onClose}>Body</Sheet>)
      await user.click(screen.getByRole('button', { name: 'Close' }))
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('Escape calls onClose', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      render(<Sheet open title="Title" onClose={onClose}>Body</Sheet>)
      await user.keyboard('{Escape}')
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('clicking the scrim calls onClose', async () => {
      const user = userEvent.setup()
      const onClose = vi.fn()
      render(<Sheet open title="Title" onClose={onClose}>Body</Sheet>)
      await user.click(scrimOf(screen.getByRole('dialog')))
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('with dismissible={false} there is no Close button or Dismiss control, and Escape and the scrim do nothing', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Sheet open title="Title" onClose={onClose} dismissible={false}>Body</Sheet>)
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    expect(document.querySelector('[aria-label="Dismiss"]')).toBeNull()
    await user.keyboard('{Escape}')
    await user.click(scrimOf(screen.getByRole('dialog')))
    expect(onClose).not.toHaveBeenCalled()
  })

  describe('focus handling', () => {
    const twoButtons = (
      <>
        <button type="button">One</button>
        <button type="button">Two</button>
      </>
    )
    /** Page buttons on both sides mean Tab visibly escapes the sheet whenever the trap is missing or wrong. */
    function SheetAmongPageButtons({ dismissible = true, children }: { dismissible?: boolean; children: ReactNode }) {
      return (
        <>
          <button type="button">Before</button>
          <Sheet open title="Title" onClose={() => {}} dismissible={dismissible}>{children}</Sheet>
          <button type="button">After</button>
        </>
      )
    }

    it('Tab from the last focusable wraps to the first', async () => {
      const user = userEvent.setup()
      render(<SheetAmongPageButtons>{twoButtons}</SheetAmongPageButtons>)
      screen.getByRole('button', { name: 'Two' }).focus()
      await user.tab()
      expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    })

    it('Shift+Tab from the first focusable wraps to the last', async () => {
      const user = userEvent.setup()
      render(<SheetAmongPageButtons>{twoButtons}</SheetAmongPageButtons>)
      screen.getByRole('button', { name: 'Close' }).focus()
      await user.tab({ shift: true })
      expect(screen.getByRole('button', { name: 'Two' })).toHaveFocus()
    })

    it('Shift+Tab straight after opening (focus on the dialog itself) wraps to the last focusable', async () => {
      const user = userEvent.setup()
      render(<SheetAmongPageButtons>{twoButtons}</SheetAmongPageButtons>)
      expect(screen.getByRole('dialog')).toHaveFocus()
      await user.tab({ shift: true })
      expect(screen.getByRole('button', { name: 'Two' })).toHaveFocus()
    })

    it('Tab keeps focus on the dialog when it has nothing focusable inside', async () => {
      const user = userEvent.setup()
      render(<SheetAmongPageButtons dismissible={false}>Just text</SheetAmongPageButtons>)
      const dialog = screen.getByRole('dialog')
      await user.tab()
      expect(dialog).toHaveFocus()
      await user.tab({ shift: true })
      expect(dialog).toHaveFocus()
    })

    it('pulls focus back into the dialog when it has left it', async () => {
      const user = userEvent.setup()
      render(<SheetAmongPageButtons dismissible={false}>{twoButtons}</SheetAmongPageButtons>)
      const scrim = scrimOf(screen.getByRole('dialog'))
      await user.click(scrim) // not focusable, so focus falls to <body>
      expect(document.body).toHaveFocus()
      await user.tab()
      expect(screen.getByRole('button', { name: 'One' })).toHaveFocus()
      await user.click(scrim)
      await user.tab({ shift: true })
      expect(screen.getByRole('button', { name: 'Two' })).toHaveFocus()
    })

    it('restores focus to the element that opened it once it closes', async () => {
      function Harness() {
        const [open, setOpen] = useState(false)
        return (
          <>
            <button type="button" onClick={() => setOpen(true)}>Open</button>
            <Sheet open={open} title="Title" onClose={() => setOpen(false)}>Body</Sheet>
          </>
        )
      }
      const user = userEvent.setup()
      render(<Harness />)
      const opener = screen.getByRole('button', { name: 'Open' })
      await user.click(opener)
      expect(screen.getByRole('dialog')).toHaveFocus()
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(opener).toHaveFocus()
    })

    it('does not pull focus off a field being typed in when the parent re-renders with a new onClose', async () => {
      function Form() {
        const [text, setText] = useState('')
        // A fresh onClose function on every render, as the currency picker passes.
        return (
          <Sheet open title="Title" onClose={() => {}}>
            <input aria-label="Search" value={text} onChange={(e) => setText(e.target.value)} />
          </Sheet>
        )
      }
      const user = userEvent.setup()
      render(<Form />)
      const input = screen.getByRole('textbox', { name: 'Search' })
      await user.type(input, 'abc')
      expect(input).toHaveValue('abc')
      expect(input).toHaveFocus()
    })
  })
})
