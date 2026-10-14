import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function RequireAuth() {
  const { user, loading, configured } = useAuth()
  if (!configured || (!loading && !user)) return <Navigate to="/login" replace />
  if (loading) {
    return <div className="flex min-h-dvh items-center justify-center bg-bg text-muted">Loading…</div>
  }
  return <Outlet />
}
