import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from './AuthContext'

export function RequireAuth({
  children,
  requireAdmin = false,
  requireFullAdmin = false,
}: {
  children: ReactNode
  requireAdmin?: boolean
  requireFullAdmin?: boolean
}) {
  const { session, loading, adminChecking, isAdmin, isFullAdmin, signOut } = useAuth()
  const location = useLocation()

  if (loading || (requireAdmin && adminChecking)) {
    return <div className="admin-loading">Loading…</div>
  }
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  if (requireFullAdmin && !isFullAdmin) {
    return (
      <main className="admin-auth">
        <div className="admin-auth-form">
          <h1>Λ H I M S Λ</h1>
          <p className="admin-subtitle">Not authorized</p>
          <p className="admin-error">This area is restricted to full admins.</p>
          <button className="admin-button" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </main>
    )
  }
  if (requireAdmin && !isAdmin) {
    return (
      <main className="admin-auth">
        <div className="admin-auth-form">
          <h1>Λ H I M S Λ</h1>
          <p className="admin-subtitle">Not authorized</p>
          <p className="admin-error">This area is restricted to admins.</p>
          <button className="admin-button" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </main>
    )
  }
  return <>{children}</>
}
