import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ALLOWED_EMAIL, auth, googleProvider, isFirebaseConfigured } from '../lib/firebase'

type AuthContextValue = {
  user: User | null
  loading: boolean
  configured: boolean
  error: string | null
  signIn: () => Promise<void>
  logOut: () => Promise<void>
}
const AuthContext = createContext<AuthContextValue | null>(null)

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : 'Sign-in failed'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false)
      return
    }
    return onAuthStateChanged(auth, (u) => {
      if (u && u.email !== ALLOWED_EMAIL) {
        setError(`This app only accepts ${ALLOWED_EMAIL}`)
        void signOut(auth)
        setUser(null)
      } else {
        setUser(u)
      }
      setLoading(false)
    })
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      configured: isFirebaseConfigured,
      error,
      async signIn() {
        setError(null)
        try {
          await signInWithPopup(auth, googleProvider)
        } catch (e) {
          setError(describeError(e))
          throw e
        }
      },
      async logOut() {
        await signOut(auth)
      },
    }),
    [user, loading, error],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
