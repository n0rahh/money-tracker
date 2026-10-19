import { act, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider, useToast } from './ToastContext'

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
 * nearest element that sets it decides; there is no CSS in tests, so its utility classes stand for it.
 */
const taps = (el: Element) => (el.closest('.pointer-events-auto, .pointer-events-none')?.classList.contains('pointer-events-auto') ? 'taken' : 'through')

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
    const region = document.querySelector('[aria-live="polite"]')
    expect(region).toBeInTheDocument()
    expect(region).toBeEmptyDOMElement()
    expect(container).toBeEmptyDOMElement() // none of it in the markup of what the provider wraps
    show('Saved')
    expect(region).toContainElement(toast())
    wait(3000)
    expect(document.querySelector('[aria-live="polite"]')).toBe(region)
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

  it('dismissToast takes the toast away at once, and its action with it', () => {
    const onAction = vi.fn()
    setup()
    show('Deleted', { actionLabel: 'Undo', onAction })
    act(() => api.dismissToast())
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
