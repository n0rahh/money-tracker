// The Shortcut's password: an email/password credential linked to the owner's Google account (spec §5, §14). The app
// creates and resets it (a reset revokes every copy of the old one); it never stores it. There is no Remove: in the
// Auth emulator, unlinking the password provider also clears the account's email, which would lock the owner out of
// the rules. Whether a password exists is read from the user's providers.
import { EmailAuthProvider, linkWithCredential, reauthenticateWithPopup, sendEmailVerification, updatePassword, type User } from 'firebase/auth'
import { googleProvider } from './firebase'
import { PROVIDER_OFF_TEXT } from './shortcut'

/** EmailAuthProvider.PROVIDER_ID, written out so that this module reads the same under a mocked SDK. */
const PASSWORD_PROVIDER = 'password'

const authCode = (e: unknown): unknown => (typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined)

/** Whether the account has a Shortcut password: a password provider among its sign-in methods. */
export function hasPasswordProvider(user: User): boolean {
  return user.providerData.some((p) => p.providerId === PASSWORD_PROVIDER)
}

/**
 * Signs the owner in again with the Google popup, which renews the "recent login" that changing a password needs. The
 * page calls it at the start of Create and Reset when the session signed in more than a few minutes ago, and straight
 * from a tap ("Confirm with Google") when a popup opened after an await was blocked: browsers allow a popup only
 * inside a user's tap.
 */
export async function reauthenticateOwner(user: User): Promise<void> {
  await reauthenticateWithPopup(user, googleProvider)
}

/**
 * Runs a change to the account's sign-in methods. Firebase allows those only a few minutes after a sign-in and answers
 * `auth/requires-recent-login` later on; then one Google popup signs the owner in again and the change is tried once more.
 * A second refusal is passed on rather than asked again, so a popup can never come back in a loop.
 */
async function withRecentLogin(user: User, change: () => Promise<unknown>): Promise<void> {
  try {
    await change()
  } catch (e) {
    if (authCode(e) !== 'auth/requires-recent-login') throw e
    await reauthenticateOwner(user)
    await change()
  }
}

/** Adds the password to the Google account, for the account's own email (the one the rules allow). */
export function linkShortcutPassword(user: User, password: string): Promise<void> {
  const email = user.email
  // Every account the app lets in has the owner's email; without one the credential would be refused by Firebase anyway.
  if (!email) return Promise.reject(new Error('This account has no email address'))
  return withRecentLogin(user, () => linkWithCredential(user, EmailAuthProvider.credential(email, password)))
}

/** Replaces the password; a Shortcut that still holds the old one is refused from then on. */
export function resetShortcutPassword(user: User, password: string): Promise<void> {
  return withRecentLogin(user, () => updatePassword(user, password))
}

/** The fallback when a password sign-in's token says the email is not verified: Firebase's verification email. */
export function sendShortcutVerificationEmail(user: User): Promise<void> {
  return sendEmailVerification(user)
}

/** What the password step says when a change failed. */
export function shortcutAuthErrorText(e: unknown): string {
  switch (authCode(e)) {
    case 'auth/operation-not-allowed':
      return PROVIDER_OFF_TEXT
    // The SDK links a password through accounts:signUp, which the console's "Enable create (sign-up)" switch blocks too.
    case 'auth/admin-restricted-operation':
      return 'Sign-up is turned off in Firebase Console (Authentication → Settings → User actions). Turn it on, create the password, then turn it off again.'
    case 'auth/provider-already-linked':
    // What linking answers when another device made the password since this one read the account.
    case 'auth/email-already-in-use':
      return 'A Shortcut password already exists. Reset it instead.'
    // Only a second refusal gets here: withRecentLogin answers the first with the Google popup.
    case 'auth/requires-recent-login':
      return 'Sign in again, then try again.'
    // The Google sign-in picked another account than the one the change is for.
    case 'auth/user-mismatch':
      return "That was a different Google account. Sign in with the owner's account and try again."
    case 'auth/too-many-requests':
      return 'Too many attempts. Try again in a few minutes.'
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in was cancelled.'
    // The page's "Confirm with Google" opens the window from its own tap and then makes the change by itself.
    case 'auth/popup-blocked':
      return 'The sign-in window was blocked. Tap "Confirm with Google" to go on.'
    case 'auth/network-request-failed':
      return "You're offline."
    default:
      return e instanceof Error ? e.message : 'Something went wrong'
  }
}
