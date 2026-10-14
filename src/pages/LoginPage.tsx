import { useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Button } from '../components/Button'
import { useAuth } from '../context/AuthContext'
import { ALLOWED_EMAIL } from '../lib/firebase'

function Centered({ children }: { children: ReactNode }) {
  return <div className="safe-pt safe-pb flex min-h-dvh items-center justify-center bg-bg px-6 text-center">{children}</div>
}

export function LoginPage() {
  const { user, loading, configured, error, signIn } = useAuth()
  const [busy, setBusy] = useState(false)

  if (!configured) {
    return (
      <Centered>
        <div className="max-w-md space-y-3">
          <h1 className="text-2xl font-semibold text-accent">Firebase not configured</h1>
          <p className="text-sm text-muted">
            Copy <code className="text-text">.env.example</code> to <code className="text-text">.env.local</code>, fill in the web app keys, then restart the dev server.
          </p>
        </div>
      </Centered>
    )
  }
  if (loading) return <Centered><p className="text-muted">Loading…</p></Centered>
  if (user) return <Navigate to="/" replace />

  async function handleSignIn() {
    setBusy(true)
    try {
      await signIn()
    } catch {
      // the message is already in `error`
    } finally {
      setBusy(false)
    }
  }

  return (
    <Centered>
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-2">
          <p className="text-4xl font-semibold tracking-tight text-accent">Money</p>
          <p className="text-sm text-muted">Fast, dark, yours.</p>
        </div>
        <Button className="w-full" onClick={() => void handleSignIn()} disabled={busy}>
          {busy ? 'Opening Google…' : 'Continue with Google'}
        </Button>
        <p className="text-xs text-muted">Only {ALLOWED_EMAIL} can sign in.</p>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>
    </Centered>
  )
}
