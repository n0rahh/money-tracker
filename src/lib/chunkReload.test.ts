import { afterEach, describe, expect, it, vi } from 'vitest'
import { reloadOnStaleChunk } from './chunkReload'

/** What Vite's preload helper dispatches on `window` when a lazy page's chunk cannot be loaded. */
const failure = () => new Event('vite:preloadError', { cancelable: true })
/** A sessionStorage stand-in. */
const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial))
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}
const refuse = () => {
  throw new DOMException('The operation is insecure.', 'SecurityError')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('reloadOnStaleChunk', () => {
  it('reloads once, handling the error, and notes when', () => {
    const storage = memory()
    const reload = vi.fn()
    const event = failure()
    reloadOnStaleChunk(event, { storage, reload, now: () => 1_000_000 })
    expect(reload).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
    expect(storage.getItem('chunk-reloaded-at')).toBe('1000000')
  })

  it('does not reload again within 10 s: the error goes on to the ErrorBoundary', () => {
    const storage = memory({ 'chunk-reloaded-at': '1000000' })
    const reload = vi.fn()
    const event = failure()
    reloadOnStaleChunk(event, { storage, reload, now: () => 1_009_999 })
    expect(reload).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('reloads again after 10 s, for a later deploy in the same tab', () => {
    const storage = memory({ 'chunk-reloaded-at': '1000000' })
    const reload = vi.fn()
    const event = failure()
    reloadOnStaleChunk(event, { storage, reload, now: () => 1_010_000 })
    expect(reload).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('without working storage it does nothing, since a loop could not be told from a first failure', () => {
    const reload = vi.fn()
    const event = failure()
    reloadOnStaleChunk(event, { storage: { getItem: refuse, setItem: refuse }, reload, now: () => 1 })
    expect(reload).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('does nothing either, and does not throw, when the browser refuses sessionStorage itself', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(refuse)
    const event = failure()
    expect(() => reloadOnStaleChunk(event)).not.toThrow()
    expect(event.defaultPrevented).toBe(false)
  })
})
