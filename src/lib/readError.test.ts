import { FirebaseError } from 'firebase/app'
import { describe, expect, it } from 'vitest'
import { readErrorText } from './readError'

describe('readErrorText', () => {
  it.each([
    { code: 'resource-exhausted', text: 'Firebase quota reached, data will refresh after midnight PT' },
    { code: 'permission-denied', text: "You don't have access to this data (signed in with the wrong account?)" },
    { code: 'unavailable', text: "You're offline and this data isn't cached yet" },
  ])('explains a $code failure', ({ code, text }) => {
    expect(readErrorText(new FirebaseError(code, 'Raw message from the SDK.'))).toBe(text)
  })

  it('keeps the message of any other Firebase error and of a plain error', () => {
    expect(readErrorText(new FirebaseError('failed-precondition', 'The query requires an index.'))).toBe('The query requires an index.')
    expect(readErrorText(new Error('boom'))).toBe('boom')
  })

  it('reads a code on an error that is not a FirebaseError too', () => {
    expect(readErrorText(Object.assign(new Error('Quota exceeded.'), { code: 'resource-exhausted' }))).toBe('Firebase quota reached, data will refresh after midnight PT')
  })

  it.each([null, undefined, 'boom', 42, { message: 'not an Error' }])('falls back to a generic text for %j', (value) => {
    expect(readErrorText(value)).toBe('Something went wrong')
  })
})
