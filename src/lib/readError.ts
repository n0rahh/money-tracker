/**
 * What a failed read says on screen (spec §11): Firestore's codes for the failures a user can act on get a plain
 * sentence; anything else keeps its own message.
 */
export function readErrorText(e: unknown): string {
  const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined
  if (code === 'resource-exhausted') return 'Firebase quota reached, data will refresh after midnight PT'
  if (code === 'permission-denied') return "You don't have access to this data (signed in with the wrong account?)"
  if (code === 'unavailable') return "You're offline and this data isn't cached yet"
  return e instanceof Error ? e.message : 'Something went wrong'
}
