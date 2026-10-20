import type { User } from 'firebase/auth'
import { ChevronLeft } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../components/Button'
import { CopyField } from '../components/CopyField'
import { useAuth } from '../context/AuthContext'
import { ACTION_DURATION_MS, useToast } from '../context/ToastContext'
import { useCategories } from '../hooks/useCategories'
import { todayIso } from '../lib/dates'
import { firebaseApiKey, firebaseProjectId } from '../lib/firebase'
import { deleteTransaction } from '../lib/firestore'
import { readErrorText } from '../lib/readError'
import { categoryDictionary, DEFAULT_HOSTS, generateShortcutPassword, SHORTCUT_RECIPE, signInUrl, transactionsUrl, type RestHosts } from '../lib/shortcut'
import {
  hasPasswordProvider,
  linkShortcutPassword,
  reauthenticateOwner,
  resetShortcutPassword,
  sendShortcutVerificationEmail,
  shortcutAuthErrorText,
} from '../lib/shortcutAuth'
import { createTransactionViaRest, shortcutErrorText, signInWithPassword } from '../lib/shortcutRest'
import type { Category } from '../lib/types'

const INTRO = 'An Apple Shortcut adds expenses from Siri, the watch and the Action button. It signs in with a password that only the Shortcut knows.'
const RESET_NOTE = 'The old password stops working; other signed-in devices may need to sign in again.'
const REVERIFY_TEXT = 'Your email needs re-verifying for password sign-in.'
const SENT_TEXT = 'Verification email sent. Open the link, then test again.'
const TEST_NOTE = 'Makes the Shortcut\'s two calls with this password and adds a real entry of 0.01, "Shortcut test", to your first expense category. Undo removes it.'
const WATCH_NOTE =
  'In the Shortcut\'s details turn on "Show on Apple Watch". Say "Hey Siri, add expense" or add it to a watch face as a complication. For income, duplicate the Shortcut and change "expense" to "income" and the categories text.'
const RECIPE_URL = 'https://github.com/n0rahh/money-tracker/blob/main/docs/shortcut.md'
const ALERT = 'text-sm text-danger [overflow-wrap:anywhere]'

/**
 * Where the test sends the Shortcut's two calls: Google's hosts, or, on the dev server with VITE_USE_EMULATORS=1, the
 * local emulators (the Auth emulator answers only under its /identitytoolkit.googleapis.com prefix). The literal
 * `import.meta.env.DEV` folds to false in a build, which drops the emulator hosts from production (M1 ruling 12).
 */
function restHosts(): RestHosts {
  return import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === '1'
    ? { identity: 'http://127.0.0.1:9099/identitytoolkit.googleapis.com', firestore: 'http://127.0.0.1:8080' }
    : DEFAULT_HOSTS
}

/** A blocked Google popup: the one a change opens after its awaits, which a browser allows only straight from a tap. */
const isPopupBlocked = (e: unknown) => typeof e === 'object' && e !== null && 'code' in e && e.code === 'auth/popup-blocked'

/** Sends Firebase's verification email; resolves with whether it went out, and says why when it did not. */
function useSendVerification(user: User): () => Promise<boolean> {
  const { showToast } = useToast()
  return async () => {
    try {
      await sendShortcutVerificationEmail(user)
      return true
    } catch (e) {
      showToast(`Could not send the verification email: ${shortcutAuthErrorText(e)}`)
      return false
    }
  }
}

/** One of the page's four numbered parts, a region named by its heading. */
function Part({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="mt-4 rounded-card bg-surface p-4">
      <h2 id={headingId} className="text-[15px] font-semibold">
        {title}
      </h2>
      {children}
    </section>
  )
}

type Change = 'create' | 'reset'
/** A change that failed: what to say, and, after a blocked popup, the change to make again once Google is confirmed. */
type Failure = { text: string; retry: Change | null }

function PasswordPart({ user }: { user: User }) {
  const sendVerification = useSendVerification(user)
  const { showToast } = useToast()
  // Kept here once a change succeeds: the SDK updates the user object in place, which re-renders nothing.
  const [hasPassword, setHasPassword] = useState(() => hasPasswordProvider(user))
  const [busy, setBusy] = useState(false)
  // The new password, until the page closes: shown this once and stored nowhere, so a lost one is replaced by a reset.
  const [password, setPassword] = useState<string | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  // When the change left the email unverified: whether the verification email went out.
  const [reverify, setReverify] = useState<'sent' | 'unsent' | null>(null)

  async function change(kind: Change) {
    setBusy(true)
    setFailure(null)
    setReverify(null)
    const next = generateShortcutPassword()
    try {
      await (kind === 'create' ? linkShortcutPassword(user, next) : resetShortcutPassword(user, next))
    } catch (e) {
      setFailure({ text: shortcutAuthErrorText(e), retry: isPopupBlocked(e) ? kind : null })
      setBusy(false)
      return
    }
    setHasPassword(true)
    setPassword(next)
    setBusy(false)
    await checkVerified()
  }

  /**
   * Linking a password may clear the account's verified flag (the Auth emulator does; production cannot be tried
   * locally), and then the rules refuse every token, the app's own too, from its next refresh. A token refreshed now
   * carries the claim the rules will read, so the fix, the verification email, goes out at once.
   */
  async function checkVerified() {
    let verified: boolean
    try {
      verified = (await user.getIdTokenResult(true)).claims.email_verified === true
    } catch {
      // Not known, which is not the same as unverified: the test below reads the same claim from the Shortcut's sign-in.
      return
    }
    if (!verified) setReverify((await sendVerification()) ? 'sent' : 'unsent')
  }

  // Nothing is awaited before reauthenticateOwner, so its popup opens within this tap.
  async function confirmWithGoogle(kind: Change) {
    setBusy(true)
    setFailure(null)
    try {
      await reauthenticateOwner(user)
    } catch (e) {
      setFailure({ text: shortcutAuthErrorText(e), retry: isPopupBlocked(e) ? kind : null })
      setBusy(false)
      return
    }
    await change(kind)
  }

  async function sendAgain() {
    if (!(await sendVerification())) return
    setReverify('sent')
    showToast(SENT_TEXT)
  }

  const retry = failure?.retry ?? null
  return (
    <Part title="1. Shortcut password">
      <p className="mt-1 text-sm text-muted">{hasPassword ? 'Password set' : 'No password yet'}</p>
      {hasPassword ? (
        <>
          <Button variant="ghost" className="mt-3" disabled={busy} onClick={() => void change('reset')}>
            Reset password
          </Button>
          <p className="mt-2 px-1 text-xs text-muted">{RESET_NOTE}</p>
        </>
      ) : (
        <Button className="mt-3" disabled={busy} onClick={() => void change('create')}>
          Create password
        </Button>
      )}
      {failure ? (
        <div className="mt-3">
          <p role="alert" className={ALERT}>
            {failure.text}
          </p>
          {retry ? (
            <Button variant="ghost" className="mt-2" disabled={busy} onClick={() => void confirmWithGoogle(retry)}>
              Confirm with Google
            </Button>
          ) : null}
        </div>
      ) : null}
      {password ? (
        <div className="mt-4">
          <CopyField label="New password" value={password} hint="Shown once. Paste it into the Shortcut now." />
        </div>
      ) : null}
      {reverify ? (
        <div className="mt-3">
          <p role="alert" className={ALERT}>
            {reverify === 'sent' ? `${REVERIFY_TEXT} We sent a verification email to ${user.email ?? ''}: open its link, then come back.` : REVERIFY_TEXT}
          </p>
          <Button variant="ghost" className="mt-2" onClick={() => void sendAgain()}>
            {reverify === 'sent' ? 'Send again' : 'Send verification email'}
          </Button>
        </div>
      ) : null}
    </Part>
  )
}

function ValuesPart({ email, categories, loading, error }: { email: string; categories: Category[]; loading: boolean; error: Error | null }) {
  let dictionaries: ReactNode
  // An empty list copied while the categories load would leave the Shortcut nothing to choose from.
  if (loading) dictionaries = <p className="text-sm text-muted">Loading…</p>
  else if (error) dictionaries = <p className="text-sm text-danger">{readErrorText(error)}</p>
  else {
    dictionaries = (
      <>
        <CopyField label="Expense categories" value={categoryDictionary(categories, 'expense')} multiline />
        <CopyField label="Income categories" value={categoryDictionary(categories, 'income')} multiline />
        <p className="px-1 text-xs text-muted">Copy again after you add or rename categories.</p>
      </>
    )
  }
  return (
    <Part title="2. Values for the Shortcut">
      <div className="mt-3 space-y-4">
        <CopyField label="Project id" value={firebaseProjectId} />
        <CopyField label="Web API key" value={firebaseApiKey} />
        <CopyField label="Email" value={email} />
        {/* Whole, so the owner pastes them into steps 10 and 14 rather than typing them around the key and the id. */}
        <CopyField label="Sign-in URL" value={signInUrl(firebaseApiKey)} />
        <CopyField label="Write URL" value={transactionsUrl(firebaseProjectId)} />
        {dictionaries}
      </div>
    </Part>
  )
}

/** What the last test found, when it added no entry. */
type Outcome = { kind: 'unverified' } | { kind: 'failed'; text: string }

function TestPart({ user, categoryId }: { user: User; categoryId: string | undefined }) {
  const { showToast } = useToast()
  const sendVerification = useSendVerification(user)
  const inputId = useId()
  // Held in this field's state while the page is open, and stored nowhere.
  const [password, setPassword] = useState('')
  const [running, setRunning] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  // The Shortcut's own two calls, so a pass proves the password, the provider switch, the verified email and the rules.
  async function sendTest(intoCategory: string) {
    setRunning(true)
    setOutcome(null)
    const hosts = restHosts()
    try {
      const { idToken, emailVerified } = await signInWithPassword(user.email ?? '', password, firebaseApiKey, hosts)
      // The rules would refuse the write: say why rather than send it.
      if (!emailVerified) {
        setOutcome({ kind: 'unverified' })
        return
      }
      // One instant for both, so the date and the time cannot fall on two sides of midnight.
      const now = new Date()
      const entry = { kind: 'expense' as const, amount: 1, categoryId: intoCategory, note: 'Shortcut test', date: todayIso(now), at: now }
      const { id } = await createTransactionViaRest(entry, firebaseProjectId, idToken, hosts)
      showToast('Test entry added', {
        actionLabel: 'Undo',
        durationMs: ACTION_DURATION_MS,
        onAction: () => {
          // As long as the Undo it answers: the test entry stays, so this one must not be missed.
          deleteTransaction(id).catch((e: unknown) =>
            showToast(e instanceof Error ? `Could not undo: ${readErrorText(e)}` : 'Could not undo', { durationMs: ACTION_DURATION_MS }),
          )
        },
      })
    } catch (e) {
      setOutcome({ kind: 'failed', text: shortcutErrorText(e) })
    } finally {
      setRunning(false)
    }
  }

  async function sendVerificationEmail() {
    if (await sendVerification()) showToast(SENT_TEXT)
  }

  return (
    <Part title="3. Test it here">
      <p className="mt-1 text-sm text-muted">{TEST_NOTE}</p>
      <label htmlFor={inputId} className="mt-3 mb-2 block px-1 text-xs font-semibold uppercase tracking-wider text-muted">
        Shortcut password
      </label>
      <input
        id={inputId}
        type="password"
        autoComplete="off"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="min-h-11 w-full rounded-chip border border-border bg-surface-2 px-3 text-text"
      />
      <Button
        className="mt-3 w-full"
        disabled={running || password === '' || categoryId === undefined}
        onClick={() => {
          if (categoryId !== undefined) void sendTest(categoryId)
        }}
      >
        {running ? 'Sending…' : 'Send a test entry'}
      </Button>
      {outcome?.kind === 'unverified' ? (
        <div className="mt-3">
          <p role="alert" className={ALERT}>
            Your email is not marked verified for password sign-in.
          </p>
          <Button variant="ghost" className="mt-2" onClick={() => void sendVerificationEmail()}>
            Send verification email
          </Button>
        </div>
      ) : outcome?.kind === 'failed' ? (
        <p role="alert" className={`mt-3 ${ALERT}`}>
          {outcome.text}
        </p>
      ) : null}
    </Part>
  )
}

function RecipePart() {
  return (
    <Part title="4. Build the Shortcut">
      <ol className="mt-3 list-decimal space-y-3 pl-6 marker:text-muted">
        {SHORTCUT_RECIPE.map(({ title, detail }) => (
          <li key={title}>
            <p className="text-[15px] font-semibold">{title}</p>
            <p className="mt-0.5 text-sm text-muted [overflow-wrap:anywhere]">{detail}</p>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-sm">{WATCH_NOTE}</p>
      <a href={RECIPE_URL} target="_blank" rel="noreferrer" className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-accent underline underline-offset-4">
        Full recipe and troubleshooting
      </a>
    </Part>
  )
}

/** Settings → Siri & Apple Watch: the Shortcut's password, the values it is built with, a test of its calls, and the recipe. */
export function ShortcutPage() {
  const { user } = useAuth()
  const { categories, loading, error } = useCategories()
  const location = useLocation()
  const navigate = useNavigate()
  // The test's category: the first of the Shortcut's own list, in the order categoryDictionary gives it.
  const firstExpense = categories.filter((c) => c.kind === 'expense' && !c.archived).sort((a, b) => a.order - b.order)[0]

  const backClass = 'flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text'
  // As on the Recurring page: opened from Settings, Back returns through history instead of stacking another Settings;
  // opened cold from a link, there is nothing in the app to return to, so it links to Settings.
  const back =
    location.key !== 'default' ? (
      <button type="button" aria-label="Back" onClick={() => navigate(-1)} className={backClass}>
        <ChevronLeft size={20} />
      </button>
    ) : (
      <Link to="/settings" aria-label="Back to Settings" className={backClass}>
        <ChevronLeft size={20} />
      </Link>
    )

  return (
    <>
      <header className="flex items-center gap-3 py-3">
        {back}
        <h1 className="text-lg font-semibold">Siri & Apple Watch</h1>
      </header>
      <p className="px-1 text-sm text-muted">{INTRO}</p>
      {/* Behind RequireAuth there is always a user; the check is for the type. */}
      {user ? (
        <>
          <PasswordPart user={user} />
          <ValuesPart email={user.email ?? ''} categories={categories} loading={loading} error={error} />
          <TestPart user={user} categoryId={firstExpense?.id} />
        </>
      ) : null}
      <RecipePart />
    </>
  )
}
