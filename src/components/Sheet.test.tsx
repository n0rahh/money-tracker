import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ToastProvider, useToast } from '../context/ToastContext'
import { Sheet } from './Sheet'

/** The scrim is rendered immediately before the dialog inside the overlay. */
const scrimOf = (dialog: HTMLElement) => dialog.previousElementSibling as HTMLElement

// Rendered bare unless a test says otherwise: a sheet needs no ToastProvider.
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

  describe('opened under a toast', () => {
    /** A page that shows a toast, with an Undo or without, and opens a sheet whose field re-renders the page as it is typed in. */
    function PageWithToasts() {
      const { showToast } = useToast()
      const [open, setOpen] = useState(false)
      const [note, setNote] = useState('')
      return (
        <>
          <button type="button" onClick={() => showToast('Deleted', { actionLabel: 'Undo', onAction: () => {} })}>Delete</button>
          <button type="button" onClick={() => showToast('Could not save: offline')}>Fail</button>
          <button type="button" onClick={() => setOpen(true)}>Open</button>
          <Sheet open={open} title="Title" onClose={() => setOpen(false)}>
            <input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Sheet>
        </>
      )
    }
    const setup = () => {
      render(<ToastProvider><PageWithToasts /></ToastProvider>)
      return userEvent.setup()
    }

    it('takes a pending Undo toast away: drawn over the sheet, its button would take the taps meant for the sheet', async () => {
      const user = setup()
      await user.click(screen.getByRole('button', { name: 'Delete' }))
      expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Open' }))
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    })

    it('leaves a plain toast up: it lets taps through, and it may say what failed', async () => {
      const user = setup()
      await user.click(screen.getByRole('button', { name: 'Fail' }))
      await user.click(screen.getByRole('button', { name: 'Open' }))
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('Could not save: offline')
    })

    it('does so as it opens only: an Undo toast that comes while it is open stays as the sheet is used, until the next opening', async () => {
      const user = setup()
      await user.click(screen.getByRole('button', { name: 'Open' }))
      await user.click(screen.getByRole('button', { name: 'Delete' }))
      await user.type(screen.getByRole('textbox', { name: 'Note' }), 'abc')
      expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Open' }))
      expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    })
  })
})
