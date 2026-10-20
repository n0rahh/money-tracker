import type { User } from 'firebase/auth'
import { ChevronLeft } from 'lucide-react'
import { useEffect, useId, useState, type ReactNode } from 'react'
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
const NEW_PASSWORD_HINT =
  'Shown once. Paste it into the Shortcut now, or keep this page open until step 10; if the page reloads, tap Reset and paste the new one.'
const GATE_TEXT = 'Create the password in step 1 first.'
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

/** Firebase lets the sign-in methods change only about 5 minutes after a sign-in; 4 leaves the change time to arrive. */
const RECENT_SIGN_IN_MS = 4 * 60 * 1000

/**
 * Whether this session signed in with Google too long ago for Firebase to allow a change of the sign-in methods. The
 * cached token's authTime is the sign-in itself, not the token's last refresh; a token that does not say counts as too
 * old. Cached, not refreshed: a network request before the popup would make the browser more likely to block it.
 */
async function signInIsStale(user: User): Promise<boolean> {
  const signedInAt = Date.parse((await user.getIdTokenResult()).authTime)
  return Number.isNaN(signedInAt) || Date.now() - signedInAt > RECENT_SIGN_IN_MS
}

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
/** After a change left the email unverified: whether the verification email went out. */
type Reverify = 'sent' | 'unsent'

type PasswordPartProps = {
  user: User
  hasPassword: boolean
  /** A change went through: there is a password now. */
  onPasswordMade: () => void
  reverify: Reverify | null
  setReverify: (reverify: Reverify | null) => void
}

function PasswordPart({ user, hasPassword, onPasswordMade, reverify, setReverify }: PasswordPartProps) {
  const sendVerification = useSendVerification(user)
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)
  // The new password, until the page closes: shown this once and stored nowhere, so a lost one is replaced by a reset.
  const [password, setPassword] = useState<string | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)

  /** Each attempt starts afresh, one at a time: no line of an earlier one stays beside what this one finds. */
  function begin() {
    setBusy(true)
    setFailure(null)
    setReverify(null)
  }

  function fail(e: unknown, kind: Change) {
    setFailure({ text: shortcutAuthErrorText(e), retry: isPopupBlocked(e) ? kind : null })
    setBusy(false)
  }

  /**
   * Create or Reset from its button. After a long session Firebase would refuse the change with requires-recent-login,
   * and the popup that withRecentLogin opens then, after a network request, is the one browsers block; asked for first,
   * the Google sign-in opens as close to the tap as it can. withRecentLogin stays the safety net.
   */
  async function start(kind: Change) {
    begin()
    try {
      if (await signInIsStale(user)) await reauthenticateOwner(user)
    } catch (e) {
      fail(e, kind)
      return
    }
    await apply(kind)
  }

  async function apply(kind: Change) {
    const next = generateShortcutPassword()
    try {
      await (kind === 'create' ? linkShortcutPassword(user, next) : resetShortcutPassword(user, next))
    } catch (e) {
      fail(e, kind)
      return
    }
    onPasswordMade()
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

  // Nothing is awaited before reauthenticateOwner, so its popup opens within this tap; signed in just now, the change
  // itself follows without a second look at the sign-in's age.
  async function confirmWithGoogle(kind: Change) {
    begin()
    try {
      await reauthenticateOwner(user)
    } catch (e) {
      fail(e, kind)
      return
    }
    await apply(kind)
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
          <Button variant="ghost" className="mt-3" disabled={busy} onClick={() => void start('reset')}>
            Reset password
          </Button>
          <p className="mt-2 px-1 text-xs text-muted">{RESET_NOTE}</p>
        </>
      ) : (
        <Button className="mt-3" disabled={busy} onClick={() => void start('create')}>
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
          <CopyField label="New password" value={password} hint={NEW_PASSWORD_HINT} />
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

type TestPartProps = {
  user: User
  categoryId: string | undefined
  /** Without a password the sign-in can only fail, and its "Wrong password" would point at a Reset that is not there. */
  hasPassword: boolean
  /** The test's sign-in found the email verified: part 1's re-verify sentence is out of date. */
  onVerified: () => void
}

function TestPart({ user, categoryId, hasPassword, onVerified }: TestPartProps) {
  const { showToast } = useToast()
  const sendVerification = useSendVerification(user)
  const inputId = useId()
  const gateId = useId()
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
      onVerified()
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
        disabled={!hasPassword}
        aria-describedby={hasPassword ? undefined : gateId}
        onChange={(e) => setPassword(e.target.value)}
        className="min-h-11 w-full rounded-chip border border-border bg-surface-2 px-3 text-text disabled:opacity-40"
      />
      {hasPassword ? null : (
        <p id={gateId} className="mt-2 px-1 text-xs text-muted">
          {GATE_TEXT}
        </p>
      )}
      <Button
        className="mt-3 w-full"
        disabled={!hasPassword || running || password === '' || categoryId === undefined}
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
  // Whether the account has a password. The SDK changes the user object in place, which re-renders nothing, so the page
  // keeps what it learns: the providers it opened with, a password made on this visit, or one that the reload finds.
  const [hasPassword, setHasPassword] = useState(() => user !== null && hasPasswordProvider(user))
  // Part 1's re-verify sentence, here because part 3's test takes it away once its sign-in finds the email verified.
  const [reverify, setReverify] = useState<Reverify | null>(null)

  // A password made on another device since this one signed in shows in the providers only once the account is read
  // again from the server. Nothing waits for that, and when it fails (offline) the page keeps what it opened with.
  useEffect(() => {
    if (user === null) return
    let open = true
    void (async () => {
      await user.reload()
      if (open && hasPasswordProvider(user)) setHasPassword(true)
    })().catch(() => {})
    return () => {
      open = false
    }
  }, [user])

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
          <PasswordPart
            user={user}
            hasPassword={hasPassword}
            onPasswordMade={() => setHasPassword(true)}
            reverify={reverify}
            setReverify={setReverify}
          />
          <ValuesPart email={user.email ?? ''} categories={categories} loading={loading} error={error} />
          <TestPart user={user} categoryId={firstExpense?.id} hasPassword={hasPassword} onVerified={() => setReverify(null)} />
        </>
      ) : null}
      <RecipePart />
    </>
  )
}
