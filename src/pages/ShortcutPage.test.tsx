import { readFileSync } from 'node:fs'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FirebaseError } from 'firebase/app'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../context/ToastContext'
import { DEFAULT_HOSTS, SHORTCUT_RECIPE } from '../lib/shortcut'
import { ShortcutRestError } from '../lib/shortcutRest'
import type { Category } from '../lib/types'
import { ShortcutPage } from './ShortcutPage'

const OWNER = 'vlad.herasymovychh@gmail.com'
const EMULATOR_HOSTS = { identity: 'http://127.0.0.1:9099/identitytoolkit.googleapis.com', firestore: 'http://127.0.0.1:8080' }

const {
  useAuth,
  useCategories,
  deleteTransaction,
  linkShortcutPassword,
  resetShortcutPassword,
  reauthenticateOwner,
  sendShortcutVerificationEmail,
  signInWithPassword,
  createTransactionViaRest,
} = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useCategories: vi.fn(),
  deleteTransaction: vi.fn(),
  linkShortcutPassword: vi.fn(),
  resetShortcutPassword: vi.fn(),
  reauthenticateOwner: vi.fn(),
  sendShortcutVerificationEmail: vi.fn(),
  signInWithPassword: vi.fn(),
  createTransactionViaRest: vi.fn(),
}))
vi.mock('../context/AuthContext', () => ({ useAuth }))
vi.mock('../hooks/useCategories', () => ({ useCategories }))
// The page's one write through the SDK: Undo of the test entry.
vi.mock('../lib/firestore', () => ({ deleteTransaction }))
vi.mock('../lib/firebase', () => ({ firebaseProjectId: 'money-tracker-vlad', firebaseApiKey: 'key', googleProvider: { providerId: 'google.com' } }))
// The account changes are replaced; whether a password exists and what a failure says stay real.
vi.mock('../lib/shortcutAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/shortcutAuth')>()),
  linkShortcutPassword,
  resetShortcutPassword,
  reauthenticateOwner,
  sendShortcutVerificationEmail,
}))
// The two HTTP calls are replaced; the error class and its sentences stay real (shortcutErrorText checks instanceof).
vi.mock('../lib/shortcutRest', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/shortcutRest')>()),
  signInWithPassword,
  createTransactionViaRest,
}))

/** Archived before anything else in the list: never the test's category, never in a dictionary. */
const GYM: Category = { id: 'gym', name: 'Gym', icon: 'Dumbbell', color: 'sky', kind: 'expense', order: 0, archived: true }
const SALARY: Category = { id: 'salary', name: 'Salary', icon: 'Banknote', color: 'emerald', kind: 'income', order: 0, archived: false }
const GROCERIES: Category = { id: 'groceries', name: 'Groceries', icon: 'ShoppingCart', color: 'emerald', kind: 'expense', order: 1, archived: false }
const COFFEE: Category = { id: 'coffee', name: 'Coffee', icon: 'Coffee', color: 'amber', kind: 'expense', order: 2, archived: false }
/** As the hook delivers them: by order, both kinds together, archived ones included. */
const CATEGORIES = [GYM, SALARY, GROCERIES, COFFEE]
const withCategories = (categories: Category[], state: { loading?: boolean; error?: Error } = {}) =>
  useCategories.mockReturnValue({ categories, byId: new Map(categories.map((c) => [c.id, c])), loading: state.loading ?? false, error: state.error ?? null })

const getIdTokenResult = vi.fn()
/** The signed-in owner as Firebase's User carries it, with one provider entry per sign-in method. */
const owner = (...providers: string[]) => ({
  uid: 'owner-uid',
  email: OWNER,
  emailVerified: true,
  displayName: 'Vlad',
  providerData: providers.map((providerId) => ({
    providerId,
    uid: providerId === 'password' ? OWNER : '104729',
    email: OWNER,
    displayName: providerId === 'password' ? null : 'Vlad',
    phoneNumber: null,
    photoURL: null,
  })),
  getIdTokenResult,
})
/** What getIdTokenResult(true) resolves with: a fresh token whose claims say whether the email is verified (or say nothing). */
const tokenResult = (emailVerified?: boolean) => ({
  token: 'fresh-id-token',
  authTime: '2026-10-20T16:00:00Z',
  issuedAtTime: '2026-10-20T17:00:00Z',
  expirationTime: '2026-10-20T18:00:00Z',
  signInProvider: 'google.com',
  signInSecondFactor: null,
  claims: emailVerified === undefined ? { email: OWNER } : { email: OWNER, email_verified: emailVerified },
})
const tooManyRequests = () => new FirebaseError('auth/too-many-requests', 'Firebase: Error (auth/too-many-requests).')
const COULD_NOT_SEND = 'Could not send the verification email: Firebase: Error (auth/too-many-requests).'
let signedIn = owner('google.com')

/** One path is a cold deep link; a list is the history that led to its last path. */
const tree = (path: string | string[]) => (
  <ToastProvider>
    <MemoryRouter initialEntries={typeof path === 'string' ? [path] : path} initialIndex={typeof path === 'string' ? 0 : path.length - 1}>
      <Routes>
        <Route path="shortcut" element={<ShortcutPage />} />
        <Route path="settings" element={<p>Settings stub</p>} />
      </Routes>
    </MemoryRouter>
  </ToastProvider>
)
const page = (path: string | string[] = '/shortcut') => render(tree(path))
/** One of the page's four numbered parts. */
const part = (name: string) => screen.getByRole('region', { name })
/** Lets the page's pending callbacks run to their end (every mock here settles at once). */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

beforeEach(() => {
  vi.resetAllMocks()
  signedIn = owner('google.com')
  useAuth.mockImplementation(() => ({ user: signedIn, loading: false, configured: true, error: null, signIn: vi.fn(), logOut: vi.fn() }))
  withCategories(CATEGORIES)
  getIdTokenResult.mockResolvedValue(tokenResult(true))
  linkShortcutPassword.mockResolvedValue(undefined)
  resetShortcutPassword.mockResolvedValue(undefined)
  reauthenticateOwner.mockResolvedValue(undefined)
  sendShortcutVerificationEmail.mockResolvedValue(undefined)
  signInWithPassword.mockResolvedValue({ idToken: 't', emailVerified: true })
  createTransactionViaRest.mockResolvedValue({ id: 'x1' })
  deleteTransaction.mockResolvedValue(undefined)
  // Google's hosts unless a test turns the emulators on, whatever .env.local says.
  vi.stubEnv('VITE_USE_EMULATORS', '0')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('ShortcutPage', () => {
  it('says what the page is for, and opened cold from a link, its Back link goes to Settings', () => {
    page()
    expect(screen.getByRole('heading', { level: 1, name: 'Siri & Apple Watch' })).toBeInTheDocument()
    expect(
      screen.getByText('An Apple Shortcut adds expenses from Siri, the watch and the Action button. It signs in with a password that only the Shortcut knows.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Settings' })).toHaveAttribute('href', '/settings')
  })

  it('opened from Settings, Back returns through history instead of stacking another Settings', async () => {
    const user = userEvent.setup()
    page(['/settings', '/shortcut'])
    expect(screen.queryByRole('link', { name: 'Back to Settings' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Settings stub')).toBeInTheDocument()
  })

  describe('1. Shortcut password', () => {
    it('creates a password, shows it once with its hint, and offers Reset from then on', async () => {
      const user = userEvent.setup()
      page()
      const password = part('1. Shortcut password')
      expect(within(password).getByText('No password yet')).toBeInTheDocument()
      expect(within(password).queryByRole('button', { name: 'Reset password' })).not.toBeInTheDocument()
      await user.click(within(password).getByRole('button', { name: 'Create password' }))

      const shown = await within(password).findByRole('group', { name: 'New password' })
      expect(linkShortcutPassword).toHaveBeenCalledTimes(1)
      const [account, created] = linkShortcutPassword.mock.calls[0] as [unknown, string]
      expect(account).toBe(signedIn)
      expect(created).toMatch(/^[A-Za-z0-9]{24}$/)
      expect(within(shown).getByText(created)).toBeInTheDocument()
      expect(within(shown).getByText('Shown once. Paste it into the Shortcut now.')).toBeInTheDocument()
      // The SDK changes the user object in place, which re-renders nothing: the page keeps what it did itself.
      expect(within(password).getByText('Password set')).toBeInTheDocument()
      expect(within(password).queryByRole('button', { name: 'Create password' })).not.toBeInTheDocument()
      expect(within(password).getByRole('button', { name: 'Reset password' })).toBeEnabled()
      expect(within(password).getByText('The old password stops working; other signed-in devices may need to sign in again.')).toBeInTheDocument()
      // Never stored: it lives in the page's state only.
      expect(localStorage.length + sessionStorage.length).toBe(0)

      // Its fresh token is read, and says verified: nothing more to do.
      await settle()
      expect(getIdTokenResult).toHaveBeenCalledWith(true)
      expect(sendShortcutVerificationEmail).not.toHaveBeenCalled()
      expect(within(password).queryByRole('alert')).not.toBeInTheDocument()
    })

    it('takes one change at a time', async () => {
      linkShortcutPassword.mockReturnValue(new Promise<void>(() => {}))
      const user = userEvent.setup()
      page()
      const create = within(part('1. Shortcut password')).getByRole('button', { name: 'Create password' })
      await user.click(create)
      expect(create).toBeDisabled()
      await user.click(create)
      expect(linkShortcutPassword).toHaveBeenCalledTimes(1)
    })

    it('resets an existing password and shows the new one', async () => {
      signedIn = owner('google.com', 'password')
      const user = userEvent.setup()
      page()
      const password = part('1. Shortcut password')
      expect(within(password).getByText('Password set')).toBeInTheDocument()
      expect(within(password).queryByRole('button', { name: 'Create password' })).not.toBeInTheDocument()
      expect(within(password).getByText('The old password stops working; other signed-in devices may need to sign in again.')).toBeInTheDocument()
      await user.click(within(password).getByRole('button', { name: 'Reset password' }))

      const shown = await within(password).findByRole('group', { name: 'New password' })
      expect(linkShortcutPassword).not.toHaveBeenCalled()
      expect(resetShortcutPassword).toHaveBeenCalledWith(signedIn, expect.stringMatching(/^[A-Za-z0-9]{24}$/))
      const [, reset] = resetShortcutPassword.mock.calls[0] as [unknown, string]
      expect(within(shown).getByText(reset)).toBeInTheDocument()
    })

    it('forgets the new password once the page closes', async () => {
      const user = userEvent.setup()
      const { unmount } = page()
      await user.click(within(part('1. Shortcut password')).getByRole('button', { name: 'Create password' }))
      await within(part('1. Shortcut password')).findByRole('group', { name: 'New password' })
      unmount()
      page()
      expect(screen.queryByRole('group', { name: 'New password' })).not.toBeInTheDocument()
    })

    it('says why a change failed, and changes nothing', async () => {
      linkShortcutPassword.mockRejectedValue({ code: 'auth/operation-not-allowed' })
      const user = userEvent.setup()
      page()
      const password = part('1. Shortcut password')
      await user.click(within(password).getByRole('button', { name: 'Create password' }))
      expect(await within(password).findByRole('alert')).toHaveTextContent(
        'Email/password sign-in is off. Turn it on in Firebase Console → Authentication → Sign-in method.',
      )
      expect(within(password).getByText('No password yet')).toBeInTheDocument()
      expect(within(password).queryByRole('group', { name: 'New password' })).not.toBeInTheDocument()
      expect(within(password).getByRole('button', { name: 'Create password' })).toBeEnabled()
      // Only a blocked sign-in window asks for the confirmation tap.
      expect(within(password).queryByRole('button', { name: 'Confirm with Google' })).not.toBeInTheDocument()
      expect(getIdTokenResult).not.toHaveBeenCalled()
    })

    it('opens the blocked Google sign-in from a tap of its own, then makes the same change', async () => {
      signedIn = owner('google.com', 'password')
      resetShortcutPassword.mockRejectedValueOnce({ code: 'auth/popup-blocked' }).mockResolvedValueOnce(undefined)
      const user = userEvent.setup()
      page()
      const password = part('1. Shortcut password')
      await user.click(within(password).getByRole('button', { name: 'Reset password' }))
      expect(await within(password).findByRole('alert')).toHaveTextContent('The sign-in window was blocked. Tap "Confirm with Google", then try again.')

      fireEvent.click(within(password).getByRole('button', { name: 'Confirm with Google' }))
      // Before anything is awaited: a browser opens a popup only from within the tap.
      expect(reauthenticateOwner).toHaveBeenCalledWith(signedIn)

      const shown = await within(password).findByRole('group', { name: 'New password' })
      expect(resetShortcutPassword).toHaveBeenCalledTimes(2)
      expect(reauthenticateOwner.mock.invocationCallOrder[0]).toBeLessThan(resetShortcutPassword.mock.invocationCallOrder[1])
      const [, reset] = resetShortcutPassword.mock.calls[1] as [unknown, string]
      expect(within(shown).getByText(reset)).toBeInTheDocument()
      expect(linkShortcutPassword).not.toHaveBeenCalled()
      expect(within(password).queryByRole('alert')).not.toBeInTheDocument()
    })

    it('makes no change when the Google confirmation is cancelled, and says so', async () => {
      linkShortcutPassword.mockRejectedValueOnce({ code: 'auth/popup-blocked' })
      reauthenticateOwner.mockRejectedValue({ code: 'auth/popup-closed-by-user' })
      const user = userEvent.setup()
      page()
      const password = part('1. Shortcut password')
      await user.click(within(password).getByRole('button', { name: 'Create password' }))
      await user.click(await within(password).findByRole('button', { name: 'Confirm with Google' }))
      expect(await within(password).findByText('Sign-in was cancelled.')).toHaveAttribute('role', 'alert')
      expect(linkShortcutPassword).toHaveBeenCalledTimes(1)
      expect(within(password).getByText('No password yet')).toBeInTheDocument()
    })

    it.each([
      { claim: 'false', verified: false },
      // The rules want the claim true: a token without one is refused as well.
      { claim: 'missing', verified: undefined },
    ])('sends a verification email at once when the new password left the email unverified (claim $claim)', async ({ verified }) => {
      getIdTokenResult.mockResolvedValue(tokenResult(verified))
      const user = userEvent.setup()
      page()
      const password = part('1. Shortcut password')
      await user.click(within(password).getByRole('button', { name: 'Create password' }))
      expect(await within(password).findByRole('alert')).toHaveTextContent(
        `Your email needs re-verifying for password sign-in. We sent a verification email to ${OWNER}: open its link, then come back.`,
      )
      expect(getIdTokenResult).toHaveBeenCalledWith(true)
      expect(sendShortcutVerificationEmail).toHaveBeenCalledTimes(1)
      expect(sendShortcutVerificationEmail).toHaveBeenCalledWith(signedIn)
      // The password itself was made: it shows all the same.
      expect(within(password).getByRole('group', { name: 'New password' })).toBeInTheDocument()

      await user.click(within(password).getByRole('button', { name: 'Send again' }))
      expect(await screen.findByRole('status')).toHaveTextContent('Verification email sent. Open the link, then test again.')
      expect(sendShortcutVerificationEmail).toHaveBeenCalledTimes(2)
    })

    it('never claims an email went out that could not be sent', async () => {
      getIdTokenResult.mockResolvedValue(tokenResult(false))
      sendShortcutVerificationEmail.mockRejectedValueOnce(tooManyRequests()).mockRejectedValueOnce(tooManyRequests()).mockResolvedValueOnce(undefined)
      const user = userEvent.setup()
      page()
      const password = part('1. Shortcut password')
      const unsent = /^Your email needs re-verifying for password sign-in\.$/
      await user.click(within(password).getByRole('button', { name: 'Create password' }))
      expect(await screen.findByRole('status')).toHaveTextContent(COULD_NOT_SEND)
      expect(within(password).getByRole('alert')).toHaveTextContent(unsent)

      // Failing again, it still says it failed; once one goes out, it says where to.
      await user.click(within(password).getByRole('button', { name: 'Send verification email' }))
      await waitFor(() => expect(sendShortcutVerificationEmail).toHaveBeenCalledTimes(2))
      await settle()
      expect(screen.getByRole('status')).toHaveTextContent(COULD_NOT_SEND)
      expect(within(password).getByRole('alert')).toHaveTextContent(unsent)
      await user.click(within(password).getByRole('button', { name: 'Send verification email' }))
      expect(await screen.findByText('Verification email sent. Open the link, then test again.')).toBeInTheDocument()
      expect(within(password).getByRole('alert')).toHaveTextContent(`We sent a verification email to ${OWNER}: open its link, then come back.`)
      expect(within(password).getByRole('button', { name: 'Send again' })).toBeInTheDocument()
    })

    it('says nothing when the fresh token cannot be read: the test reads the same claim from the Shortcut sign-in', async () => {
      getIdTokenResult.mockRejectedValue(new FirebaseError('auth/network-request-failed', 'Firebase: Error (auth/network-request-failed).'))
      const user = userEvent.setup()
      page()
      const password = part('1. Shortcut password')
      await user.click(within(password).getByRole('button', { name: 'Create password' }))
      await within(password).findByRole('group', { name: 'New password' })
      await settle()
      expect(getIdTokenResult).toHaveBeenCalledWith(true)
      expect(sendShortcutVerificationEmail).not.toHaveBeenCalled()
      expect(within(password).queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('2. Values for the Shortcut', () => {
    it('offers every value the Shortcut is built with, the dictionaries of active categories only', () => {
      page()
      const values = part('2. Values for the Shortcut')
      const value = (label: string) => within(within(values).getByRole('group', { name: label }))
      expect(value('Project id').getByText('money-tracker-vlad')).toBeInTheDocument()
      expect(value('Web API key').getByText('key')).toBeInTheDocument()
      expect(value('Email').getByText(OWNER)).toBeInTheDocument()
      expect(value('Sign-in URL').getByText('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=key')).toBeInTheDocument()
      expect(value('Write URL').getByText('https://firestore.googleapis.com/v1/projects/money-tracker-vlad/databases/(default)/documents/transactions')).toBeInTheDocument()
      // In category order, without the archived Gym or the other kind.
      expect(within(values).getByRole('textbox', { name: 'Expense categories' })).toHaveValue('{\n  "Groceries": "groceries",\n  "Coffee": "coffee"\n}')
      expect(within(values).getByRole('textbox', { name: 'Income categories' })).toHaveValue('{\n  "Salary": "salary"\n}')
      expect(within(values).getByText('Copy again after you add or rename categories.')).toBeInTheDocument()
      expect(within(values).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
        'Copy Project id',
        'Copy Web API key',
        'Copy Email',
        'Copy Sign-in URL',
        'Copy Write URL',
        'Copy Expense categories',
        'Copy Income categories',
      ])
    })

    it('offers no dictionary to copy until the categories are in', () => {
      withCategories([], { loading: true })
      const { unmount } = page()
      expect(within(part('2. Values for the Shortcut')).getByText('Loading…')).toBeInTheDocument()
      expect(screen.queryByRole('textbox', { name: 'Expense categories' })).not.toBeInTheDocument()
      unmount()

      withCategories(CATEGORIES, { error: new FirebaseError('permission-denied', 'Missing or insufficient permissions.') })
      page()
      expect(within(part('2. Values for the Shortcut')).getByText("You don't have access to this data (signed in with the wrong account?)")).toBeInTheDocument()
      expect(screen.queryByRole('textbox', { name: 'Income categories' })).not.toBeInTheDocument()
    })
  })

  describe('3. Test it here', () => {
    const send = () => within(part('3. Test it here')).getByRole('button', { name: 'Send a test entry' })
    const typePassword = async (user: ReturnType<typeof userEvent.setup>, password = 'Pa55word') =>
      user.type(within(part('3. Test it here')).getByLabelText('Shortcut password'), password)

    it("makes the Shortcut's two calls and offers Undo for the entry they wrote", async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(2026, 9, 20, 19, 5))
      const user = userEvent.setup()
      page()
      const field = within(part('3. Test it here')).getByLabelText('Shortcut password')
      expect(field).toHaveAttribute('type', 'password')
      expect(field).toHaveAttribute('autocomplete', 'off')
      await typePassword(user)
      await user.click(send())

      const toast = await screen.findByRole('status')
      expect(toast).toHaveTextContent('Test entry added')
      expect(signInWithPassword).toHaveBeenCalledWith(OWNER, 'Pa55word', 'key', DEFAULT_HOSTS)
      // One minor unit in the first active expense category (not the archived Gym before it), dated and timed now.
      expect(createTransactionViaRest).toHaveBeenCalledWith(
        { kind: 'expense', amount: 1, categoryId: 'groceries', note: 'Shortcut test', date: '2026-10-20', at: new Date(2026, 9, 20, 19, 5) },
        'money-tracker-vlad',
        't',
        DEFAULT_HOSTS,
      )
      await user.click(within(toast).getByRole('button', { name: 'Undo' }))
      expect(deleteTransaction).toHaveBeenCalledWith('x1')
    })

    it('says so when the Undo fails', async () => {
      deleteTransaction.mockRejectedValue(new FirebaseError('permission-denied', 'Missing or insufficient permissions.'))
      const user = userEvent.setup()
      page()
      await typePassword(user)
      await user.click(send())
      await user.click(within(await screen.findByRole('status')).getByRole('button', { name: 'Undo' }))
      expect(await screen.findByText("Could not undo: You don't have access to this data (signed in with the wrong account?)")).toBeInTheDocument()
    })

    it('explains an unverified email instead of writing, and sends the verification email', async () => {
      signInWithPassword.mockResolvedValue({ idToken: 't', emailVerified: false })
      const user = userEvent.setup()
      page()
      const test = part('3. Test it here')
      await typePassword(user)
      await user.click(send())
      expect(await within(test).findByRole('alert')).toHaveTextContent('Your email is not marked verified for password sign-in.')
      // The rules would refuse the write: none is sent.
      expect(createTransactionViaRest).not.toHaveBeenCalled()
      await user.click(within(test).getByRole('button', { name: 'Send verification email' }))
      expect(sendShortcutVerificationEmail).toHaveBeenCalledWith(signedIn)
      expect(await screen.findByRole('status')).toHaveTextContent('Verification email sent. Open the link, then test again.')
    })

    it('says why the verification email could not be sent', async () => {
      signInWithPassword.mockResolvedValue({ idToken: 't', emailVerified: false })
      sendShortcutVerificationEmail.mockRejectedValue(tooManyRequests())
      const user = userEvent.setup()
      page()
      const test = part('3. Test it here')
      await typePassword(user)
      await user.click(send())
      await user.click(await within(test).findByRole('button', { name: 'Send verification email' }))
      expect(await screen.findByRole('status')).toHaveTextContent(COULD_NOT_SEND)
      await settle()
      expect(screen.getByRole('status')).toHaveTextContent(COULD_NOT_SEND)
    })

    it.each([
      {
        name: 'a refused write',
        failing: createTransactionViaRest,
        error: new ShortcutRestError('write', 403, 'PERMISSION_DENIED'),
        shown: "Firestore refused the entry. The email must be the owner's and verified (see step 3).",
      },
      {
        name: 'a wrong password',
        failing: signInWithPassword,
        error: new ShortcutRestError('sign-in', 400, 'INVALID_LOGIN_CREDENTIALS'),
        shown: 'Wrong password. Reset it in step 1 and paste the new one.',
      },
    ])('says what to do about $name, and is ready again', async ({ failing, error, shown }) => {
      failing.mockRejectedValue(error)
      const user = userEvent.setup()
      page()
      await typePassword(user)
      await user.click(send())
      expect(await within(part('3. Test it here')).findByRole('alert')).toHaveTextContent(shown)
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(send()).toBeEnabled()
    })

    it('takes one test at a time', async () => {
      signInWithPassword.mockReturnValue(new Promise(() => {}))
      const user = userEvent.setup()
      page()
      await typePassword(user)
      await user.click(send())
      const busy = within(part('3. Test it here')).getByRole('button', { name: 'Sending…' })
      expect(busy).toBeDisabled()
      await user.click(busy)
      expect(signInWithPassword).toHaveBeenCalledTimes(1)
    })

    it('waits for a password, and for an active expense category to write to', async () => {
      const user = userEvent.setup()
      const { unmount } = page()
      expect(send()).toBeDisabled()
      await typePassword(user)
      expect(send()).toBeEnabled()
      unmount()

      withCategories([GYM, SALARY])
      page()
      await typePassword(user)
      expect(send()).toBeDisabled()
    })

    it('sends the test to the local emulators on the dev server with VITE_USE_EMULATORS=1, and only there', async () => {
      vi.stubEnv('VITE_USE_EMULATORS', '1')
      const user = userEvent.setup()
      const { unmount } = page()
      await typePassword(user)
      await user.click(send())
      await screen.findByRole('status')
      expect(signInWithPassword).toHaveBeenCalledWith(OWNER, 'Pa55word', 'key', EMULATOR_HOSTS)
      expect(createTransactionViaRest).toHaveBeenCalledWith(expect.objectContaining({ note: 'Shortcut test' }), 'money-tracker-vlad', 't', EMULATOR_HOSTS)
      unmount()

      // A build is never DEV: the switch alone changes nothing there.
      vi.stubEnv('DEV', false)
      page()
      await typePassword(user)
      await user.click(send())
      await screen.findByRole('status')
      expect(signInWithPassword).toHaveBeenLastCalledWith(OWNER, 'Pa55word', 'key', DEFAULT_HOSTS)
    })
  })

  describe('4. Build the Shortcut', () => {
    it('lists the recipe step by step, then the watch, Siri and income notes and the full recipe', () => {
      page()
      const recipe = part('4. Build the Shortcut')
      const steps = within(recipe).getAllByRole('listitem')
      expect(steps.map((s) => s.firstElementChild?.textContent)).toEqual(SHORTCUT_RECIPE.map((s) => s.title))
      SHORTCUT_RECIPE.forEach(({ detail }, i) => expect(steps[i]).toHaveTextContent(detail))
      expect(
        within(recipe).getByText(
          'In the Shortcut\'s details turn on "Show on Apple Watch". Say "Hey Siri, add expense" or add it to a watch face as a complication. For income, duplicate the Shortcut and change "expense" to "income" and the categories text.',
        ),
      ).toBeInTheDocument()
      expect(within(recipe).getByRole('link', { name: 'Full recipe and troubleshooting' })).toHaveAttribute(
        'href',
        'https://github.com/n0rahh/money-tracker/blob/main/docs/shortcut.md',
      )
    })

    it('names and numbers every step as docs/shortcut.md does', () => {
      // From the project root, where the tests run, as the rules tests read firestore.rules.
      const docs = readFileSync('docs/shortcut.md', 'utf8')
      SHORTCUT_RECIPE.forEach(({ title }, i) => expect(docs).toContain(`\n### ${i + 1}. ${title}\n`))
    })
  })
})
