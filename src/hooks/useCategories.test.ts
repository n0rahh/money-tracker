import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Category } from '../lib/types'
import { useCategories } from './useCategories'

const COFFEE: Category = { id: 'c1', name: 'Coffee', icon: 'Coffee', color: 'amber', kind: 'expense', order: 0, archived: false }
const GYM: Category = { id: 'c2', name: 'Gym', icon: 'Dumbbell', color: 'sky', kind: 'expense', order: 1, archived: true }

const { subscribeCategories } = vi.hoisted(() => ({ subscribeCategories: vi.fn() }))
vi.mock('../lib/firestore', () => ({ subscribeCategories }))

/** Answers the subscription with a snapshot, or with an error. */
const deliver = (categories: Category[]) => act(() => subscribeCategories.mock.lastCall?.[0](categories))
const fail = (e: Error) => act(() => subscribeCategories.mock.lastCall?.[1](e))

beforeEach(() => {
  vi.clearAllMocks()
  subscribeCategories.mockReturnValue(() => {})
})

describe('useCategories', () => {
  it('loads until the first snapshot, then maps every category by id, archived ones included', () => {
    const { result } = renderHook(() => useCategories())
    expect(result.current.loading).toBe(true)

    deliver([COFFEE, GYM])
    expect(result.current.loading).toBe(false)
    expect(result.current.categories).toEqual([COFFEE, GYM])
    expect(result.current.byId.get(GYM.id)).toBe(GYM) // old transactions still need the archived name
    expect(result.current.byId.size).toBe(2)
    expect(result.current.error).toBeNull()
  })

  it('stops loading and reports the error when the subscription fails', () => {
    const { result } = renderHook(() => useCategories())
    const denied = new Error('Missing or insufficient permissions.')
    fail(denied)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe(denied)
    expect(result.current.categories).toEqual([])
  })

  it('unsubscribes on unmount', () => {
    const unsubscribe = vi.fn()
    subscribeCategories.mockReturnValue(unsubscribe)
    const { unmount } = renderHook(() => useCategories())
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
