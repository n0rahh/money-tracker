import { act, renderHook } from '@testing-library/react'
import { Timestamp } from 'firebase/firestore'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Transaction } from '../lib/types'
import { useTransactions } from './useTransactions'

const { subscribeTransactionsInRange } = vi.hoisted(() => ({ subscribeTransactionsInRange: vi.fn() }))
vi.mock('../lib/firestore', () => ({ subscribeTransactionsInRange }))

type OnData = (t: Transaction[], pending: boolean, fromCache: boolean) => void
const ROW: Transaction = { id: 't1', kind: 'expense', amount: 100, categoryId: 'c1', note: '', date: '2026-05-10', at: Timestamp.fromDate(new Date(2026, 4, 10, 9)), source: 'app' }

describe('useTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    subscribeTransactionsInRange.mockImplementation((_from: string, _to: string, onData: OnData) => {
      onData([ROW], false, false) // answers at once, inside the effect, confirmed by the server
      return vi.fn()
    })
  })

  it.each([
    { change: 'its start', next: { from: '2025-11-01', to: '2026-10-31' } },
    { change: 'its end', next: { from: '2026-05-01', to: '2026-09-30' } },
  ])('never hands out the rows of one range as the rows of another, not even for a single render ($change moves)', ({ next }) => {
    const renders: { range: string; loading: boolean; rows: number; fromCache: boolean }[] = []
    const { rerender } = renderHook(
      ({ from, to }) => {
        const r = useTransactions(from, to)
        renders.push({ range: `${from}..${to}`, loading: r.loading, rows: r.transactions.length, fromCache: r.fromCache })
        return r
      },
      { initialProps: { from: '2026-05-01', to: '2026-10-31' } },
    )
    expect(renders.at(-1)).toEqual({ range: '2026-05-01..2026-10-31', loading: false, rows: 1, fromCache: false })
    renders.length = 0
    subscribeTransactionsInRange.mockImplementation(() => vi.fn()) // the new range's answer is still on its way
    rerender(next)
    const newRange = renders.filter((r) => r.range === `${next.from}..${next.to}`)
    expect(newRange.length).toBeGreaterThan(0)
    // Every render made for the new range, before its answer, is loading, holds no rows and claims no server confirmation.
    expect(newRange.filter((r) => !r.loading || r.rows > 0 || !r.fromCache)).toEqual([])
  })

  it('tells whether the rows come from the cache only, following each snapshot, and starts over for a new range', () => {
    let emit: OnData = () => {}
    subscribeTransactionsInRange.mockImplementation((_from: string, _to: string, onData: OnData) => {
      emit = onData
      return vi.fn()
    })
    const { result, rerender } = renderHook(({ from, to }) => useTransactions(from, to), { initialProps: { from: '2026-05-01', to: '2026-05-31' } })
    expect(result.current).toMatchObject({ loading: true, fromCache: true })

    act(() => emit([ROW], false, true)) // served from the cache first
    expect(result.current).toMatchObject({ loading: false, fromCache: true, transactions: [ROW] })
    act(() => emit([ROW], false, false)) // the server confirmed the range
    expect(result.current.fromCache).toBe(false)
    act(() => emit([ROW], false, true)) // the connection dropped
    expect(result.current.fromCache).toBe(true)
    act(() => emit([ROW], false, false))

    rerender({ from: '2026-06-01', to: '2026-06-30' })
    expect(result.current).toMatchObject({ loading: true, fromCache: true })
    act(() => emit([], false, false))
    expect(result.current).toMatchObject({ loading: false, fromCache: false, transactions: [] })
  })
})
