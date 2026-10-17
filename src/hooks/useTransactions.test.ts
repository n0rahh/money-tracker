import { renderHook } from '@testing-library/react'
import { Timestamp } from 'firebase/firestore'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Transaction } from '../lib/types'
import { useTransactions } from './useTransactions'

const { subscribeTransactionsInRange } = vi.hoisted(() => ({ subscribeTransactionsInRange: vi.fn() }))
vi.mock('../lib/firestore', () => ({ subscribeTransactionsInRange }))

const ROW: Transaction = { id: 't1', kind: 'expense', amount: 100, categoryId: 'c1', note: '', date: '2026-05-10', at: Timestamp.fromDate(new Date(2026, 4, 10, 9)), source: 'app' }

describe('useTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    subscribeTransactionsInRange.mockImplementation((_from: string, _to: string, onData: (t: Transaction[], pending: boolean) => void) => {
      onData([ROW], false) // answers at once, inside the effect
      return vi.fn()
    })
  })

  it.each([
    { change: 'its start', next: { from: '2025-11-01', to: '2026-10-31' } },
    { change: 'its end', next: { from: '2026-05-01', to: '2026-09-30' } },
  ])('never hands out the rows of one range as the rows of another, not even for a single render ($change moves)', ({ next }) => {
    const renders: { range: string; loading: boolean; rows: number }[] = []
    const { rerender } = renderHook(
      ({ from, to }) => {
        const r = useTransactions(from, to)
        renders.push({ range: `${from}..${to}`, loading: r.loading, rows: r.transactions.length })
        return r
      },
      { initialProps: { from: '2026-05-01', to: '2026-10-31' } },
    )
    expect(renders.at(-1)).toEqual({ range: '2026-05-01..2026-10-31', loading: false, rows: 1 })
    renders.length = 0
    subscribeTransactionsInRange.mockImplementation(() => vi.fn()) // the new range's answer is still on its way
    rerender(next)
    const newRange = renders.filter((r) => r.range === `${next.from}..${next.to}`)
    expect(newRange.length).toBeGreaterThan(0)
    // Every render made for the new range, before its answer, is loading and holds no rows.
    expect(newRange.filter((r) => !r.loading || r.rows > 0)).toEqual([])
  })
})
