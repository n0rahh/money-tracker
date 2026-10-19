import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider, useDismissToastWhenOpened, useToast } from './ToastContext'

type ToastApi = ReturnType<typeof useToast>

let api: ToastApi
function Probe() {
  api = useToast()
  return null
}

const setup = () => render(<ToastProvider><Probe /></ToastProvider>)
/** Shows a toast as an event handler would: inside `act`, so the provider renders it at once. */
const show = (...args: Parameters<ToastApi['showToast']>) => act(() => api.showToast(...args))
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms))
const toast = () => screen.queryByRole('status')
/**
 * Whether a tap on the element reaches it or falls through to the page beneath. `pointer-events` is inherited, so the
 * nearest element that sets it decides, and an element that nothing sets it on takes taps (the CSS default is `auto`); there
 * is no CSS in tests, so its utility classes stand for it.
 */
const taps = (el: Element) => (el.closest('.pointer-events-auto, .pointer-events-none')?.classList.contains('pointer-events-none') ? 'through' : 'taken')
/** Something that opens over the page, as a sheet does. */
function Opener({ open }: { open: boolean }) {
  useDismissToastWhenOpened(open)
  return null
}
const withOpener = (open: boolean) => <ToastProvider><Probe /><Opener open={open} /></ToastProvider>

describe('ToastProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps its live region in the page between toasts, so assistive technology announces the first one too', () => {
    // A live region that is inserted together with its text is often not announced.
    const { container } = setup()
    const region = screen.getByTestId('toast-region')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toBeEmptyDOMElement()
    expect(container).toBeEmptyDOMElement() // none of it in the markup of what the provider wraps
    show('Saved')
    expect(region).toContainElement(toast())
    wait(3000)
    expect(screen.getByTestId('toast-region')).toBe(region)
    expect(region).toBeEmptyDOMElement()
  })

  it('lets taps through a plain toast to the page beneath', () => {
    setup()
    show('Saved')
    expect(taps(screen.getByText('Saved'))).toBe('through')
  })

  it('shows no button for a label without an action, and stays the plain 3 s', () => {
    setup()
    show('Saved', { actionLabel: 'Undo' })
    expect(within(screen.getByRole('status')).queryByRole('button')).not.toBeInTheDocument()
    expect(taps(screen.getByText('Saved'))).toBe('through')
    wait(2999)
    expect(toast()).toBeInTheDocument()
    wait(1)
    expect(toast()).not.toBeInTheDocument()
  })

  describe('useDismissToastWhenOpened', () => {
    it('takes a toast with an action away at once as it opens, and its action with it', () => {
      const onAction = vi.fn()
      const { rerender } = render(withOpener(false))
      show('Deleted', { actionLabel: 'Undo', onAction })
      rerender(withOpener(true))
      expect(toast()).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
      // A toast shown afterwards keeps its own timer, untouched by the one taken away.
      wait(1000)
      show('Saved')
      wait(2999)
      expect(toast()).toHaveTextContent('Saved')
      wait(1)
      expect(toast()).not.toBeInTheDocument()
      expect(onAction).not.toHaveBeenCalled()
    })

    it('leaves a plain toast up for its 3 s: it lets taps through, and it may say what failed', () => {
      const { rerender } = render(withOpener(false))
      show('Could not save: offline')
      rerender(withOpener(true))
      expect(toast()).toHaveTextContent('Could not save: offline')
      wait(2999)
      expect(toast()).toBeInTheDocument()
      wait(1)
      expect(toast()).not.toBeInTheDocument()
    })

    it('acts as it opens only, not again while it stays open', () => {
      const { rerender } = render(withOpener(true))
      show('Deleted', { actionLabel: 'Undo', onAction: vi.fn() })
      rerender(withOpener(true))
      expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    })

    it('does nothing outside a ToastProvider', () => {
      expect(() => render(<Opener open />)).not.toThrow()
    })
  })

  it('shows a message for 3 s, without a button', () => {
    setup()
    show('Saved')
    expect(toast()).toHaveTextContent('Saved')
    expect(within(screen.getByRole('status')).queryByRole('button')).not.toBeInTheDocument()
    wait(2999)
    expect(toast()).toBeInTheDocument()
    wait(1)
    expect(toast()).not.toBeInTheDocument()
  })

  it('offers an action as a 44 px button that takes taps, runs it once and dismisses the toast', () => {
    const onAction = vi.fn()
    setup()
    show('Deleted', { actionLabel: 'Undo', onAction })
    expect(toast()).toHaveTextContent('Deleted')
    const undo = within(screen.getByRole('status')).getByRole('button', { name: 'Undo' })
    expect(undo).toHaveClass('min-h-11')
    // The row the toast sits in lets taps through to the page; a toast with a button takes them itself, its text included.
    expect(taps(undo)).toBe('taken')
    expect(taps(screen.getByText('Deleted'))).toBe('taken')
    // Two taps before the toast renders again: the second is a no-op, whether or not the button is still there.
    act(() => {
      undo.click()
      undo.click()
    })
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(toast()).not.toBeInTheDocument()
  })

  it('keeps up a toast that the action shows itself', () => {
    setup()
    show('Deleted', { actionLabel: 'Undo', onAction: () => api.showToast('Could not undo: offline') })
    act(() => screen.getByRole('button', { name: 'Undo' }).click())
    expect(toast()).toHaveTextContent('Could not undo: offline')
    wait(2999)
    expect(toast()).toBeInTheDocument()
    wait(1)
    expect(toast()).not.toBeInTheDocument()
  })

  it('stays 6 s when it carries an action, which never runs by itself', () => {
    const onAction = vi.fn()
    setup()
    show('Deleted', { actionLabel: 'Undo', onAction })
    wait(5999)
    expect(toast()).toBeInTheDocument()
    wait(1)
    expect(toast()).not.toBeInTheDocument()
    expect(onAction).not.toHaveBeenCalled()
  })

  it('stays as long as durationMs says', () => {
    setup()
    show('Exported 12 entries', { durationMs: 10_000 })
    wait(9999)
    expect(toast()).toBeInTheDocument()
    wait(1)
    expect(toast()).not.toBeInTheDocument()
  })

  it('replaces the toast on screen, together with its action and its timer', () => {
    const onAction = vi.fn()
    setup()
    show('Deleted', { actionLabel: 'Undo', onAction })
    wait(4000)
    expect(toast()).toHaveTextContent('Deleted') // still up, with 2 s to go
    show('Could not delete: denied')
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(toast()).toHaveTextContent('Could not delete: denied')
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    // The first toast would have ended at 6 s; the second keeps its own 3 s, counted from 4 s.
    wait(2999)
    expect(toast()).toHaveTextContent('Could not delete: denied')
    wait(1)
    expect(toast()).not.toBeInTheDocument()
    expect(onAction).not.toHaveBeenCalled()
  })

  describe('a toast with an action waits while it is in use, so its button can still be reached (WCAG 2.2.1)', () => {
    const undoButton = () => screen.getByRole('button', { name: 'Undo' })
    const pointerOver = () => fireEvent.pointerEnter(toast() as HTMLElement)
    const pointerAway = () => fireEvent.pointerLeave(toast() as HTMLElement)
    /** Shows a toast with an action, as a delete does. */
    const deleted = (message = 'Deleted') => show(message, { actionLabel: 'Undo', onAction: vi.fn() })

    it('waits while the pointer is over it, and goes after the time it had left once the pointer leaves', () => {
      const onAction = vi.fn()
      setup()
      show('Deleted', { actionLabel: 'Undo', onAction })
      wait(4000)
      pointerOver()
      wait(60_000)
      expect(toast()).toHaveTextContent('Deleted')
      pointerAway()
      wait(1999)
      expect(toast()).toBeInTheDocument()
      wait(1)
      expect(toast()).not.toBeInTheDocument()
      expect(onAction).not.toHaveBeenCalled()
    })

    it('waits while the keyboard focus is on its button, and goes after the time it had left once the focus moves on', () => {
      setup()
      deleted()
      wait(1000)
      act(() => undoButton().focus())
      wait(60_000)
      expect(toast()).toHaveTextContent('Deleted')
      act(() => undoButton().blur())
      wait(4999)
      expect(toast()).toBeInTheDocument()
      wait(1)
      expect(toast()).not.toBeInTheDocument()
    })

    it('keeps waiting while either still holds it: the focus after the pointer has left, the pointer after the focus has', () => {
      setup()
      deleted()
      pointerOver()
      act(() => undoButton().focus())
      pointerAway()
      wait(60_000)
      expect(toast()).toBeInTheDocument()
      pointerOver()
      act(() => undoButton().blur())
      wait(60_000)
      expect(toast()).toBeInTheDocument()
      pointerAway()
      wait(5999)
      expect(toast()).toBeInTheDocument()
      wait(1)
      expect(toast()).not.toBeInTheDocument()
    })

    it('gives a toast that takes the place of a held one its own time, counted from when it is let go', () => {
      setup()
      deleted()
      pointerOver()
      wait(5000)
      deleted('Template deleted') // drawn in the same place, still under the pointer
      wait(60_000)
      expect(toast()).toHaveTextContent('Template deleted')
      pointerAway()
      wait(5999)
      expect(toast()).toBeInTheDocument()
      wait(1)
      expect(toast()).not.toBeInTheDocument()
    })

    it('leaves a plain toast its 3 s, also one that takes the place of a held toast, and holds nothing over for the next', () => {
      setup()
      deleted()
      pointerOver()
      show('Could not delete: offline')
      pointerOver() // a plain toast lets taps through: nothing over it holds it
      wait(1000)
      deleted('Deleted again')
      wait(5999)
      expect(toast()).toHaveTextContent('Deleted again')
      wait(1)
      expect(toast()).not.toBeInTheDocument()
      show('Saved')
      pointerOver()
      wait(2999)
      expect(toast()).toHaveTextContent('Saved')
      wait(1)
      expect(toast()).not.toBeInTheDocument()
    })

    it('holds nothing over once a held toast has been taken away', () => {
      setup()
      deleted()
      pointerOver()
      act(() => undoButton().focus())
      act(() => api.dismissActionToast()) // a sheet opened
      expect(toast()).not.toBeInTheDocument()
      deleted('Deleted again')
      wait(5999)
      expect(toast()).toBeInTheDocument()
      wait(1)
      expect(toast()).not.toBeInTheDocument()
    })
  })

  it('a second "Deleted" in a row offers Undo for the second entry only, for a fresh 6 s', () => {
    const undoFirst = vi.fn()
    const undoSecond = vi.fn()
    setup()
    show('Deleted', { actionLabel: 'Undo', onAction: undoFirst })
    wait(5000)
    show('Deleted', { actionLabel: 'Undo', onAction: undoSecond })
    wait(5999)
    act(() => screen.getByRole('button', { name: 'Undo' }).click())
    expect(undoSecond).toHaveBeenCalledTimes(1)
    expect(undoFirst).not.toHaveBeenCalled()
  })
})
