import { act, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider, useToast } from './ToastContext'

type ShowToast = ReturnType<typeof useToast>['showToast']

let showToast: ShowToast
function Probe() {
  showToast = useToast().showToast
  return null
}

const setup = () => render(<ToastProvider><Probe /></ToastProvider>)
/** Shows a toast as an event handler would: inside `act`, so the provider renders it at once. */
const show = (...args: Parameters<ShowToast>) => act(() => showToast(...args))
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms))
const toast = () => screen.queryByRole('status')

describe('ToastProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
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
    // The row the toast sits in lets taps through to the page; a toast with a button must take them itself (no CSS in tests).
    expect(undo.closest('div')).toHaveClass('pointer-events-auto')
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
    show('Deleted', { actionLabel: 'Undo', onAction: () => showToast('Could not undo: offline') })
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
