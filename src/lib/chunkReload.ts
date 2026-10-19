/** Key of the time of the last reload this module made, in sessionStorage. */
const RELOADED_AT = 'chunk-reloaded-at'
/** A chunk that still fails this soon after a reload is really missing (offline, a broken deploy): show the error instead of looping. */
const LOOP_GUARD_MS = 10_000

type Env = { storage: Pick<Storage, 'getItem' | 'setItem'>; reload: () => void; now: () => number }
const browser = (): Env => ({
  // Read on use, inside the guard below: a browser that refuses storage throws on the access itself.
  get storage() {
    return window.sessionStorage
  },
  reload: () => window.location.reload(),
  now: Date.now,
})

/**
 * Vite's `vite:preloadError`: a lazy page's chunk could not be loaded. After a deploy the service worker drops the old
 * precache and Hosting no longer serves the old file names, so a tab left open across it asks for chunks that are gone;
 * a reload fetches the new index.html, which names the new chunks. Reloads once per `LOOP_GUARD_MS` (the page keeps its URL,
 * so the reload lands on the page that was asked for); any other failure goes on to the ErrorBoundary.
 */
export function reloadOnStaleChunk(event: Event, env: Env = browser()): void {
  try {
    if (env.now() - Number(env.storage.getItem(RELOADED_AT) ?? 0) < LOOP_GUARD_MS) return
    env.storage.setItem(RELOADED_AT, String(env.now()))
  } catch {
    return // no storage, so no way to tell a loop from a first failure: leave it to the ErrorBoundary
  }
  event.preventDefault() // the error is handled by the reload
  env.reload()
}
