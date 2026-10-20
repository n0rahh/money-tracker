import type { User } from 'firebase/auth'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { googleProvider } from './firebase'
import {
  hasPasswordProvider,
  linkShortcutPassword,
  reauthenticateOwner,
  resetShortcutPassword,
  sendShortcutVerificationEmail,
  shortcutAuthErrorText,
} from './shortcutAuth'

const sdk = vi.hoisted(() => ({
  EmailAuthProvider: { credential: vi.fn((email: string, password: string) => ({ providerId: 'password', email, password })) },
  linkWithCredential: vi.fn((..._args: unknown[]) => Promise.resolve({})),
  updatePassword: vi.fn((..._args: unknown[]) => Promise.resolve()),
  reauthenticateWithPopup: vi.fn((..._args: unknown[]) => Promise.resolve({})),
  sendEmailVerification: vi.fn((..._args: unknown[]) => Promise.resolve()),
}))
vi.mock('firebase/auth', () => sdk)
vi.mock('./firebase', () => ({ googleProvider: { providerId: 'google.com' } }))

const userWith = (...providerIds: string[]) => ({ email: 'vlad@example.com', providerData: providerIds.map((providerId) => ({ providerId })) }) as unknown as User
const USER = userWith('google.com')
const authError = (code: string) => Object.assign(new Error(`Firebase: Error (${code}).`), { code })
const RECENT_LOGIN = authError('auth/requires-recent-login')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('hasPasswordProvider', () => {
  it.each([
    [[], false],
    [['google.com'], false],
    [['google.com', 'password'], true],
    [['password'], true],
  ])('reads %j as %s', (providerIds, expected) => {
    expect(hasPasswordProvider(userWith(...providerIds))).toBe(expected)
  })
})

describe('linkShortcutPassword', () => {
  it("links an email/password credential for the user's own email", async () => {
    await expect(linkShortcutPassword(USER, 'pw-1')).resolves.toBeUndefined()
    expect(sdk.EmailAuthProvider.credential).toHaveBeenCalledExactlyOnceWith('vlad@example.com', 'pw-1')
    expect(sdk.linkWithCredential).toHaveBeenCalledExactlyOnceWith(USER, sdk.EmailAuthProvider.credential.mock.results[0].value)
  })

  it('refuses a user without an email, before asking Firebase', async () => {
    const noEmail = { email: null, providerData: [] } as unknown as User
    await expect(linkShortcutPassword(noEmail, 'pw-1')).rejects.toThrow('This account has no email address')
    expect(sdk.linkWithCredential).not.toHaveBeenCalled()
  })
})

describe('resetShortcutPassword', () => {
  it('sets the new password', async () => {
    await expect(resetShortcutPassword(USER, 'pw-2')).resolves.toBeUndefined()
    expect(sdk.updatePassword).toHaveBeenCalledExactlyOnceWith(USER, 'pw-2')
  })
})

describe('reauthenticateOwner', () => {
  it("opens the Google popup with the app's own provider", async () => {
    await expect(reauthenticateOwner(USER)).resolves.toBeUndefined()
    expect(sdk.reauthenticateWithPopup).toHaveBeenCalledTimes(1)
    expect(sdk.reauthenticateWithPopup.mock.calls[0][0]).toBe(USER)
    expect(sdk.reauthenticateWithPopup.mock.calls[0][1]).toBe(googleProvider)
  })

  it('passes a blocked or closed popup on', async () => {
    const blocked = authError('auth/popup-blocked')
    sdk.reauthenticateWithPopup.mockRejectedValueOnce(blocked)
    await expect(reauthenticateOwner(USER)).rejects.toBe(blocked)
  })
})

describe('after a long session (auth/requires-recent-login)', () => {
  const MUTATIONS = [
    { name: 'linkShortcutPassword', run: () => linkShortcutPassword(USER, 'pw-1'), sdkCall: sdk.linkWithCredential },
    { name: 'resetShortcutPassword', run: () => resetShortcutPassword(USER, 'pw-2'), sdkCall: sdk.updatePassword },
  ]

  it.each(MUTATIONS)('$name signs in again with the Google popup once, then retries', async ({ run, sdkCall }) => {
    sdkCall.mockRejectedValueOnce(RECENT_LOGIN)
    await expect(run()).resolves.toBeUndefined()
    expect(sdk.reauthenticateWithPopup).toHaveBeenCalledTimes(1)
    // The app's own provider object, with its login_hint, not merely an equal one.
    expect(sdk.reauthenticateWithPopup.mock.calls[0][0]).toBe(USER)
    expect(sdk.reauthenticateWithPopup.mock.calls[0][1]).toBe(googleProvider)
    expect(sdkCall).toHaveBeenCalledTimes(2)
    expect(sdk.reauthenticateWithPopup.mock.invocationCallOrder[0]).toBeGreaterThan(sdkCall.mock.invocationCallOrder[0])
    expect(sdk.reauthenticateWithPopup.mock.invocationCallOrder[0]).toBeLessThan(sdkCall.mock.invocationCallOrder[1])
  })

  it.each(MUTATIONS)('$name passes a second refusal on instead of asking again', async ({ run, sdkCall }) => {
    sdkCall.mockRejectedValueOnce(RECENT_LOGIN).mockRejectedValueOnce(RECENT_LOGIN)
    await expect(run()).rejects.toBe(RECENT_LOGIN)
    expect(sdk.reauthenticateWithPopup).toHaveBeenCalledTimes(1)
    expect(sdkCall).toHaveBeenCalledTimes(2)
  })

  it('does not retry when the popup is closed', async () => {
    const closed = authError('auth/popup-closed-by-user')
    sdk.updatePassword.mockRejectedValueOnce(RECENT_LOGIN)
    sdk.reauthenticateWithPopup.mockRejectedValueOnce(closed)
    await expect(resetShortcutPassword(USER, 'pw-2')).rejects.toBe(closed)
    expect(sdk.updatePassword).toHaveBeenCalledTimes(1)
  })

  it('opens no popup for any other failure', async () => {
    const offline = authError('auth/network-request-failed')
    sdk.updatePassword.mockRejectedValueOnce(offline)
    await expect(resetShortcutPassword(USER, 'pw-2')).rejects.toBe(offline)
    expect(sdk.reauthenticateWithPopup).not.toHaveBeenCalled()
    expect(sdk.updatePassword).toHaveBeenCalledTimes(1)
  })
})

describe('sendShortcutVerificationEmail', () => {
  it('sends the verification email, with no popup in front', async () => {
    await expect(sendShortcutVerificationEmail(USER)).resolves.toBeUndefined()
    expect(sdk.sendEmailVerification).toHaveBeenCalledExactlyOnceWith(USER)
    expect(sdk.reauthenticateWithPopup).not.toHaveBeenCalled()
  })
})

describe('shortcutAuthErrorText', () => {
  it.each([
    ['auth/operation-not-allowed', 'Email/password sign-in is off. Turn it on in Firebase Console → Authentication → Sign-in method.'],
    ['auth/admin-restricted-operation', 'Sign-up is turned off in Firebase Console (Authentication → Settings → User actions). Turn it on, create the password, then turn it off again.'],
    ['auth/provider-already-linked', 'A Shortcut password already exists. Reset it instead.'],
    ['auth/popup-closed-by-user', 'Sign-in was cancelled.'],
    ['auth/cancelled-popup-request', 'Sign-in was cancelled.'],
    ['auth/popup-blocked', 'The sign-in window was blocked. Tap "Confirm with Google" to go on.'],
    ['auth/network-request-failed', "You're offline."],
  ])('explains %s', (code, text) => {
    expect(shortcutAuthErrorText(authError(code))).toBe(text)
  })

  it('keeps the message of any other error', () => {
    expect(shortcutAuthErrorText(authError('auth/email-already-in-use'))).toBe('Firebase: Error (auth/email-already-in-use).')
    expect(shortcutAuthErrorText(new Error('boom'))).toBe('boom')
  })

  it.each([null, undefined, 'boom', { message: 'not an Error' }])('falls back to a generic text for %j', (value) => {
    expect(shortcutAuthErrorText(value)).toBe('Something went wrong')
  })
})
