import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBudgets } from './useBudgets'

const { subscribeBudgets } = vi.hoisted(() => ({ subscribeBudgets: vi.fn() }))
vi.mock('../lib/firestore', () => ({ subscribeBudgets }))

/** Answers the subscription with a snapshot, or with an error. */
const deliver = (budgets: Map<string, number>) => act(() => subscribeBudgets.mock.lastCall?.[0](budgets))
const fail = (e: Error) => act(() => subscribeBudgets.mock.lastCall?.[1](e))

beforeEach(() => {
  vi.clearAllMocks()
  subscribeBudgets.mockReturnValue(() => {})
})

describe('useBudgets', () => {
  it('loads with no budgets until the first snapshot, then follows every snapshot', () => {
    const { result } = renderHook(() => useBudgets())
    expect(result.current.loading).toBe(true)
    expect(result.current.budgets.size).toBe(0)
    expect(result.current.error).toBeNull()

    const first = new Map([['c1', 50000], ['c2', 12000]])
    deliver(first)
    expect(result.current.loading).toBe(false)
    expect(result.current.budgets).toBe(first)
    expect(result.current.budgets.get('c2')).toBe(12000)
    expect(result.current.error).toBeNull()

    deliver(new Map([['c1', 60000]])) // a later snapshot replaces the earlier one
    expect([...result.current.budgets]).toEqual([['c1', 60000]])
  })

  it('stops loading and reports the error when the subscription fails', () => {
    const { result } = renderHook(() => useBudgets())
    const denied = new Error('Missing or insufficient permissions.')
    fail(denied)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe(denied)
    expect(result.current.budgets.size).toBe(0)
  })

  it('subscribes once, however often it renders, and unsubscribes on unmount', () => {
    const unsubscribe = vi.fn()
    subscribeBudgets.mockReturnValue(unsubscribe)
    const { rerender, unmount } = renderHook(() => useBudgets())
    rerender()
    rerender()
    expect(subscribeBudgets).toHaveBeenCalledTimes(1)
    expect(unsubscribe).not.toHaveBeenCalled()
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
