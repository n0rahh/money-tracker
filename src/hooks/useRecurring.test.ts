import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecurringTemplate } from '../lib/types'
import { useRecurring } from './useRecurring'

const RENT: RecurringTemplate = {
  id: 'r1', kind: 'expense', amount: 120000, categoryId: 'rent', note: 'Flat', dayOfMonth: 1, startMonth: '2026-01', endMonth: null, lastAppliedMonth: '2026-09',
}
const PAY: RecurringTemplate = {
  id: 'r2', kind: 'income', amount: 500000, categoryId: 'salary', note: '', dayOfMonth: 25, startMonth: '2026-03', endMonth: '2026-12', lastAppliedMonth: null,
}

const { subscribeRecurring } = vi.hoisted(() => ({ subscribeRecurring: vi.fn() }))
vi.mock('../lib/firestore', () => ({ subscribeRecurring }))

/** Answers the subscription with a snapshot (by default one the server has confirmed), or with an error. */
const deliver = (templates: RecurringTemplate[], fromCache = false) => act(() => subscribeRecurring.mock.lastCall?.[0](templates, fromCache))
const fail = (e: Error) => act(() => subscribeRecurring.mock.lastCall?.[1](e))

beforeEach(() => {
  vi.clearAllMocks()
  subscribeRecurring.mockReturnValue(() => {})
})

describe('useRecurring', () => {
  it('loads with no templates until the first snapshot, then follows every snapshot', () => {
    const { result } = renderHook(() => useRecurring())
    expect(result.current.loading).toBe(true)
    expect(result.current.templates).toEqual([])
    expect(result.current.error).toBeNull()

    deliver([RENT, PAY])
    expect(result.current.loading).toBe(false)
    expect(result.current.templates).toEqual([RENT, PAY])
    expect(result.current.error).toBeNull()

    deliver([PAY]) // a template was deleted
    expect(result.current.templates).toEqual([PAY])
  })

  it('says whether the list comes from the cache only, until the server confirms it', () => {
    const { result } = renderHook(() => useRecurring())
    expect(result.current.fromCache).toBe(true) // nothing is confirmed before the first snapshot
    deliver([RENT], true) // the cached list of an offline launch
    expect(result.current.loading).toBe(false)
    expect(result.current.templates).toEqual([RENT])
    expect(result.current.fromCache).toBe(true)
    deliver([RENT, PAY], false) // the server's answer
    expect(result.current.templates).toEqual([RENT, PAY])
    expect(result.current.fromCache).toBe(false)
  })

  it('stops loading and reports the error when the subscription fails', () => {
    const { result } = renderHook(() => useRecurring())
    const denied = new Error('Missing or insufficient permissions.')
    fail(denied)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe(denied)
    expect(result.current.templates).toEqual([])
  })

  it('subscribes once, however often it renders, and unsubscribes on unmount', () => {
    const unsubscribe = vi.fn()
    subscribeRecurring.mockReturnValue(unsubscribe)
    const { rerender, unmount } = renderHook(() => useRecurring())
    rerender()
    rerender()
    expect(subscribeRecurring).toHaveBeenCalledTimes(1)
    expect(unsubscribe).not.toHaveBeenCalled()
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
