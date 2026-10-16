import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useVisibilityTick } from './useVisibilityTick'

const turn = (state: DocumentVisibilityState) => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state)
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

afterEach(() => {
  vi.restoreAllMocks() // the visibilityState spies
})

describe('useVisibilityTick', () => {
  it('counts each return to the foreground: the page turning visible or the window regaining focus', () => {
    const { result } = renderHook(() => useVisibilityTick())
    expect(result.current).toBe(0)
    turn('visible')
    expect(result.current).toBe(1)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(result.current).toBe(2)
  })

  it('ignores the page going to the background', () => {
    const { result } = renderHook(() => useVisibilityTick())
    turn('hidden')
    expect(result.current).toBe(0)
  })
})
